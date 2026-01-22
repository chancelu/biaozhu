import express from "express";
import cors from "cors";
import { z } from "zod";
import { createDb } from "./db/db";
import { env } from "./env";
import { randomId, nowIso } from "./lib/ids";
import { runCrawlJob, type CrawlJobConfig } from "./jobs/crawl";
import { createContext, scrapeModelPage, scrapeModelPageInContext } from "./crawler/makerworld";
import { runLabelJob, type LabelJobConfig } from "./jobs/label";

const db = createDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/env-status", async (_req, res) => {
  res.json({
    hasArkKey: Boolean(env.ARK_API_KEY && env.ARK_API_KEY.trim()),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim()),
    arkBaseUrl: env.ARK_BASE_URL,
    arkModel: env.ARK_MODEL,
  });
});

app.post("/api/db/migrate", async (_req, res) => {
  res.status(400).json({ error: "use npm run db:migrate" });
});

app.post("/api/crawl-jobs", async (req, res) => {
  const schema = z.object({
    startUrl: z.string().default("https://makerworld.com/zh/3d-models"),
    limitModels: z.number().int().min(1).max(50000).default(200),
    maxScrolls: z.number().int().min(1).max(5000).default(60),
    concurrency: z.number().int().min(1).max(5).default(1),
    delayMs: z.number().int().min(0).max(5000).default(1200),
    cookieHeader: z.string().optional(),
    clearHistory: z.boolean().default(true),
  });

  const input = schema.parse(req.body ?? {});

  if (input.clearHistory) {
    const now = nowIso();
    await db
      .updateTable("crawl_jobs")
      .set({ status: "failed", finished_at: now, last_error: "CLEARED_BY_NEW_CRAWL" })
      .where("finished_at", "is", null)
      .execute();
    await db
      .updateTable("label_jobs")
      .set({ status: "failed", finished_at: now, last_error: "CLEARED_BY_NEW_CRAWL" })
      .where("finished_at", "is", null)
      .execute();
    await db.deleteFrom("model_labels").execute();
    await db.deleteFrom("model_images").execute();
    await db.deleteFrom("models").execute();
  }

  const id = randomId("crawl");
  const config: CrawlJobConfig = {
    startUrl: input.startUrl,
    limitModels: input.limitModels,
    maxScrolls: input.maxScrolls,
    concurrency: input.concurrency,
    delayMs: input.delayMs,
    cookieHeader: input.cookieHeader,
  };

  await db
    .insertInto("crawl_jobs")
    .values({
      id,
      status: "queued",
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
      config_json: JSON.stringify(config),
      discovered_count: 0,
      processed_count: 0,
      failed_count: 0,
      last_error: null,
    })
    .execute();

  setTimeout(() => {
    runCrawlJob(db, id).catch(() => {});
  }, 50);

  res.json({ id });
});

app.post("/api/import-models", async (req, res) => {
  const schema = z.object({
    urls: z.array(z.string().min(1)).min(1).max(50),
    cookieHeader: z.string().optional(),
    clearHistory: z.boolean().default(true),
  });
  const input = schema.parse(req.body ?? {});

  if (input.clearHistory) {
    const now = nowIso();
    await db
      .updateTable("crawl_jobs")
      .set({ status: "failed", finished_at: now, last_error: "CLEARED_BY_IMPORT" })
      .where("finished_at", "is", null)
      .execute();
    await db
      .updateTable("label_jobs")
      .set({ status: "failed", finished_at: now, last_error: "CLEARED_BY_IMPORT" })
      .where("finished_at", "is", null)
      .execute();
    await db.deleteFrom("model_labels").execute();
    await db.deleteFrom("model_images").execute();
    await db.deleteFrom("models").execute();
  }

  const { browser, context } = await createContext({ cookieHeader: input.cookieHeader });
  try {
    const ids: string[] = [];
    for (const url of input.urls) {
      const scraped = await scrapeModelPageInContext(context, { url });
      ids.push(scraped.id);

      const cover = scraped.imageUrls[0] ?? null;
      const now = nowIso();
      await db
        .insertInto("models")
        .values({
          id: scraped.id,
          url: scraped.url,
          title: scraped.title,
          author_name: scraped.authorName,
          download_count: scraped.downloadCount,
          cover_image_url: cover,
          description: scraped.description,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            url: scraped.url,
            title: scraped.title,
            author_name: scraped.authorName,
            download_count: scraped.downloadCount,
            cover_image_url: cover,
            description: scraped.description,
            updated_at: now,
          }),
        )
        .execute();

      await db.deleteFrom("model_images").where("model_id", "=", scraped.id).execute();
      if (scraped.imageUrls.length > 0) {
        await db
          .insertInto("model_images")
          .values(
            scraped.imageUrls.map((u, idx) => ({
              id: `${scraped.id}_${idx}`,
              model_id: scraped.id,
              idx,
              url: u,
            })),
          )
          .execute();
      }
    }
    res.json({ ids });
  } finally {
    await context.close();
    await browser.close();
  }
});

app.get("/api/crawl-jobs/:id", async (req, res) => {
  const id = z.string().parse(req.params.id);
  const job = await db.selectFrom("crawl_jobs").selectAll().where("id", "=", id).executeTakeFirst();
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.get("/api/crawl-jobs-latest", async (_req, res) => {
  const job = await db.selectFrom("crawl_jobs").selectAll().orderBy("created_at", "desc").limit(1).executeTakeFirst();
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.post("/api/crawl-jobs/:id/pause", async (req, res) => {
  const id = z.string().parse(req.params.id);
  await db.updateTable("crawl_jobs").set({ status: "paused" }).where("id", "=", id).execute();
  res.json({ ok: true });
});

app.post("/api/crawl-jobs/:id/resume", async (req, res) => {
  const id = z.string().parse(req.params.id);
  await db.updateTable("crawl_jobs").set({ status: "running" }).where("id", "=", id).execute();
  res.json({ ok: true });
});

app.get("/api/models", async (req, res) => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    withCover: z.coerce.boolean().optional(),
  });
  const input = schema.parse(req.query);
  const offset = (input.page - 1) * input.pageSize;
  let q = db
    .selectFrom("models")
    .leftJoin("model_labels", "model_labels.model_id", "models.id")
    .select([
      "models.id as id",
      "models.url as url",
      "models.title as title",
      "models.author_name as author_name",
      "models.download_count as download_count",
      "models.cover_image_url as cover_image_url",
      "models.updated_at as updated_at",
      "model_labels.grade as grade",
      "model_labels.extracted_json as extracted_json",
    ])
    .orderBy("models.updated_at", "desc");

  if (input.withCover) {
    q = q.where("models.cover_image_url", "is not", null);
  }

  const rawRows = await q.limit(input.pageSize).offset(offset).execute();
  const rows = rawRows.map((r: any) => {
    let summary: string | null = null;
    try {
      const j = r.extracted_json ? JSON.parse(r.extracted_json) : null;
      const s = typeof j?.summary === "string" ? j.summary.trim() : "";
      summary = s ? s : null;
    } catch {
      summary = null;
    }
    const { extracted_json: _ignored, ...rest } = r;
    return { ...rest, summary };
  });

  const countQuery = input.withCover
    ? db
        .selectFrom("models")
        .where("cover_image_url", "is not", null)
        .select((eb) => eb.fn.countAll().as("count"))
    : db.selectFrom("models").select((eb) => eb.fn.countAll().as("count"));

  const [{ count }] = await countQuery.execute();
  res.json({ rows, total: Number(count) });
});

app.get("/api/models/:id", async (req, res) => {
  const id = z.string().parse(req.params.id);
  const model = await db.selectFrom("models").selectAll().where("id", "=", id).executeTakeFirst();
  if (!model) return res.status(404).json({ error: "not found" });
  const images = await db.selectFrom("model_images").selectAll().where("model_id", "=", id).orderBy("idx").execute();
  const label = await db.selectFrom("model_labels").selectAll().where("model_id", "=", id).executeTakeFirst();
  res.json({ model, images, label });
});

app.post("/api/label-jobs", async (req, res) => {
  const schema = z.object({
    limit: z.number().int().min(1).max(50000).optional(),
  });
  const input = schema.parse(req.body ?? {});
  const id = randomId("label");
  const config: LabelJobConfig = {
    limit: input.limit ?? null,
  };

  await db
    .insertInto("label_jobs")
    .values({
      id,
      status: "queued",
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
      config_json: JSON.stringify(config),
      total_count: 0,
      processed_count: 0,
      failed_count: 0,
      last_error: null,
    })
    .execute();

  setTimeout(() => {
    runLabelJob(db, id).catch(() => {});
  }, 50);

  res.json({ id });
});

app.get("/api/label-jobs/:id", async (req, res) => {
  const id = z.string().parse(req.params.id);
  const job = await db.selectFrom("label_jobs").selectAll().where("id", "=", id).executeTakeFirst();
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.post("/api/label-jobs/:id/pause", async (req, res) => {
  const id = z.string().parse(req.params.id);
  await db.updateTable("label_jobs").set({ status: "paused" }).where("id", "=", id).execute();
  res.json({ ok: true });
});

app.post("/api/label-jobs/:id/resume", async (req, res) => {
  const id = z.string().parse(req.params.id);
  await db.updateTable("label_jobs").set({ status: "running" }).where("id", "=", id).execute();
  res.json({ ok: true });
});

app.get("/api/stats", async (_req, res) => {
  const total = await db.selectFrom("models").select((eb) => eb.fn.countAll().as("count")).executeTakeFirstOrThrow();
  const byGrade = await db
    .selectFrom("model_labels")
    .select(["grade"])
    .select((eb) => eb.fn.countAll().as("count"))
    .groupBy("grade")
    .execute();

  const labeled = await db.selectFrom("model_labels").select((eb) => eb.fn.countAll().as("count")).executeTakeFirstOrThrow();
  res.json({
    total: Number(total.count),
    labeled: Number(labeled.count),
    byGrade: Object.fromEntries(byGrade.map((r) => [r.grade, Number((r as any).count)])),
  });
});

app.get("/api/export.csv", async (_req, res) => {
  const rows = await db
    .selectFrom("models")
    .leftJoin("model_labels", "model_labels.model_id", "models.id")
    .select([
      "models.id as id",
      "models.url as url",
      "models.author_name as author_name",
      "models.download_count as download_count",
      "models.title as title",
      "models.cover_image_url as cover_image_url",
      "model_labels.grade as grade",
      "model_labels.extracted_json as extracted_json",
      "model_labels.reason as reason",
    ])
    .orderBy("models.updated_at", "desc")
    .execute();

  const escape = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", 'attachment; filename="makerworld_export.csv"');

  const header = ["ID", "文件链接", "作者名", "下载量", "标题", "模型图", "等级", "图片摘要", "理由"].join(",") + "\n";
  res.write("\uFEFF" + header);
  for (const r of rows) {
    let summary = "";
    try {
      const j = (r as any).extracted_json ? JSON.parse((r as any).extracted_json) : null;
      summary = typeof j?.summary === "string" ? j.summary : "";
    } catch {
      summary = "";
    }
    const line = [
      escape((r as any).id),
      escape((r as any).url),
      escape((r as any).author_name),
      escape((r as any).download_count),
      escape((r as any).title),
      escape((r as any).cover_image_url),
      escape((r as any).grade),
      escape(summary),
      escape((r as any).reason),
    ].join(",") + "\n";
    res.write(line);
  }
  res.end();
});

app.get("/api/probe", async (req, res) => {
  const schema = z.object({
    url: z.string().default("https://makerworld.com/zh/models/242239"),
    cookieHeader: z.string().optional(),
  });
  const input = schema.parse(req.query);
  try {
    const result = await scrapeModelPage({ url: input.url, cookieHeader: input.cookieHeader });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const port = env.PORT;
app.listen(port, async () => {
  process.stdout.write(`worker listening on ${port}\n`);

  const resume = async () => {
    const crawl = await db
      .selectFrom("crawl_jobs")
      .select(["id", "status", "finished_at"])
      .where("finished_at", "is", null)
      .where("status", "in", ["queued", "running"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (crawl) {
      await db.updateTable("crawl_jobs").set({ status: "queued" }).where("id", "=", crawl.id).execute();
      setTimeout(() => runCrawlJob(db, crawl.id).catch(() => {}), 200);
    }

    const label = await db
      .selectFrom("label_jobs")
      .select(["id", "status", "finished_at"])
      .where("finished_at", "is", null)
      .where("status", "in", ["queued", "running"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (label) {
      await db.updateTable("label_jobs").set({ status: "queued" }).where("id", "=", label.id).execute();
      setTimeout(() => runLabelJob(db, label.id).catch(() => {}), 200);
    }
  };

  resume().catch(() => {});
});

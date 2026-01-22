import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database, LabelJobStatus } from "../db/types";
import { nowIso } from "../lib/ids";
import { labelWithOpenAI } from "../label/openai";
import { createContext, scrapeModelPageInContext } from "../crawler/makerworld";

export interface LabelJobConfig {
  limit: number | null;
}

export async function runLabelJob(db: Kysely<Database>, jobId: string) {
  const job = await db.selectFrom("label_jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
  if (!job) return;

  const config = JSON.parse(job.config_json) as LabelJobConfig;

  const updateStatus = async (status: LabelJobStatus, patch?: Partial<Database["label_jobs"]>) => {
    await db
      .updateTable("label_jobs")
      .set({ status, ...patch })
      .where("id", "=", jobId)
      .execute();
  };

  await updateStatus("running", { started_at: nowIso(), last_error: null });

  try {
    const latestCrawl = await db.selectFrom("crawl_jobs").select(["config_json"]).orderBy("created_at", "desc").limit(1).executeTakeFirst();
    const cookieHeader = (() => {
      try {
        const parsed = latestCrawl ? (JSON.parse(latestCrawl.config_json) as any) : null;
        return typeof parsed?.cookieHeader === "string" ? parsed.cookieHeader : undefined;
      } catch {
        return undefined;
      }
    })();

    const { browser, context } = await createContext({ cookieHeader });
    try {
      const baseQuery = db
        .selectFrom("models")
        .leftJoin("model_labels", "model_labels.model_id", "models.id")
        .select([
          "models.id as id",
          "models.url as url",
          "models.title as title",
          "models.description as description",
          "models.cover_image_url as cover_image_url",
          "model_labels.model_id as labeled_id",
        ])
        .where("model_labels.model_id", "is", null)
        .orderBy("models.updated_at", "desc");

      const candidates = config.limit ? await baseQuery.limit(config.limit).execute() : await baseQuery.execute();

      await db.updateTable("label_jobs").set({ total_count: candidates.length }).where("id", "=", jobId).execute();

      const waitIfPausedOrCancelled = async () => {
        while (true) {
          const current = await db.selectFrom("label_jobs").select(["status"]).where("id", "=", jobId).executeTakeFirst();
          if (!current) throw new Error("JOB_CANCELLED");
          if (current.status === "paused") {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (current.status !== "running") throw new Error("JOB_CANCELLED");
          return;
        }
      };

      for (const row of candidates) {
        await waitIfPausedOrCancelled();

        try {
          const existingImages = await db
            .selectFrom("model_images")
            .select(["url"])
            .where("model_id", "=", row.id)
            .orderBy("idx", "asc")
            .limit(12)
            .execute();

          let imageUrls = existingImages.map((x) => x.url).filter(Boolean);
          if (imageUrls.length === 0 && row.cover_image_url) imageUrls = [row.cover_image_url];

          const needScrape = imageUrls.length < 2;
          if (needScrape) {
            const scraped = await scrapeModelPageInContext(context, { url: row.url });
            imageUrls = scraped.imageUrls;
            const coverImageUrl = scraped.imageUrls[0] ?? null;

            await db
              .updateTable("models")
              .set({
                url: scraped.url,
                title: scraped.title,
                author_name: scraped.authorName,
                download_count: scraped.downloadCount,
                cover_image_url: coverImageUrl,
                description: scraped.description,
                updated_at: nowIso(),
              })
              .where("id", "=", row.id)
              .execute();

            await db.deleteFrom("model_images").where("model_id", "=", row.id).execute();
            if (scraped.imageUrls.length > 0) {
              await db
                .insertInto("model_images")
                .values(
                  scraped.imageUrls.map((u, idx) => ({
                    id: `${row.id}_${idx}`,
                    model_id: row.id,
                    idx,
                    url: u,
                  })),
                )
                .execute();
            }
          }

          const result = await labelWithOpenAI({
            imageUrls,
            url: row.url,
          });

          await db
            .insertInto("model_labels")
            .values({
              model_id: row.id,
              grade: result.grade,
              reason: result.reason,
              extracted_json: JSON.stringify(result.extracted),
              updated_at: nowIso(),
            })
            .execute();

          await db.updateTable("label_jobs").set({ processed_count: sql`processed_count + 1` }).where("id", "=", jobId).execute();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .updateTable("label_jobs")
            .set({ failed_count: sql`failed_count + 1`, last_error: message })
            .where("id", "=", jobId)
            .execute();
        }
      }

      await updateStatus("completed", { finished_at: nowIso() });
    } finally {
      await context.close();
      await browser.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "JOB_CANCELLED") return;
    await updateStatus("failed", { finished_at: nowIso(), last_error: message });
  }
}

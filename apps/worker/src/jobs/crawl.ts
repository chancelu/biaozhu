import type { Kysely } from "kysely";
import { createContext, extractModelIdAndUrl, scrapeModelPageInContext } from "../crawler/makerworld";
import type { Database, CrawlJobStatus } from "../db/types";
import { nowIso } from "../lib/ids";
import { sql } from "kysely";

export interface CrawlJobConfig {
  startUrl: string;
  limitModels: number;
  maxScrolls: number;
  concurrency: number;
  delayMs: number;
  cookieHeader?: string;
}

export async function runCrawlJob(db: Kysely<Database>, jobId: string) {
  const job = await db.selectFrom("crawl_jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
  if (!job) throw new Error("job not found");

  const config = JSON.parse(job.config_json) as CrawlJobConfig;

  const updateStatus = async (status: CrawlJobStatus, patch?: Partial<Database["crawl_jobs"]>) => {
    await db
      .updateTable("crawl_jobs")
      .set({ status, ...patch })
      .where("id", "=", jobId)
      .execute();
  };

  await updateStatus("running", { started_at: nowIso(), last_error: null });

  try {
    const { browser, context } = await createContext({ cookieHeader: config.cookieHeader });
    try {
      const discoveredIds = new Set<string>();
      const queue: { id: string; url: string }[] = [];
      let queueIndex = 0;
      let discoveryDone = false;
      let wake: (() => void) | null = null;

      type Discovered = { id: string; url: string; cover_image_url?: string | null; title?: string | null; author_name?: string | null };

      const push = (items: Discovered[]) => {
        if (items.length === 0) return;
        queue.push(...items.map((it) => ({ id: it.id, url: it.url })));
        if (wake) {
          const fn = wake;
          wake = null;
          fn();
        }
      };

      const persistDiscovered = async (items: Discovered[]) => {
        if (items.length === 0) return;
        const now = nowIso();
        await db
          .insertInto("models")
          .values(
            items.map((it) => ({
              id: it.id,
              url: it.url,
              title: it.title ?? null,
              author_name: it.author_name ?? null,
              download_count: null,
              cover_image_url: it.cover_image_url ?? null,
              description: null,
              created_at: now,
              updated_at: now,
            })),
          )
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              url: (eb) => eb.ref("excluded.url"),
              title: sql`COALESCE(excluded.title, title)`,
              author_name: sql`COALESCE(excluded.author_name, author_name)`,
              cover_image_url: sql`COALESCE(excluded.cover_image_url, cover_image_url)`,
              updated_at: now,
            }),
          )
          .execute();
      };

      const getNext = async () => {
        while (true) {
          if (queueIndex < queue.length) {
            const v = queue[queueIndex];
            queueIndex += 1;
            return v;
          }
          if (discoveryDone) return null;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      };

      const waitIfPausedOrCancelled = async () => {
        while (true) {
          const current = await db.selectFrom("crawl_jobs").select(["status"]).where("id", "=", jobId).executeTakeFirst();
          if (!current) throw new Error("JOB_CANCELLED");
          if (current.status === "paused") {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (current.status !== "running") throw new Error("JOB_CANCELLED");
          return;
        }
      };

      const worker = async () => {
        while (true) {
          await waitIfPausedOrCancelled();
          const discovered = await getNext();
          if (!discovered) return;

          try {
            const scraped = await scrapeModelPageInContext(context, { url: discovered.url });
            const cover = scraped.imageUrls[0] ?? null;

            await db
              .updateTable("models")
              .set({
                url: scraped.url,
                title: scraped.title,
                author_name: scraped.authorName,
                download_count: scraped.downloadCount,
                cover_image_url: cover,
                description: scraped.description,
                updated_at: nowIso(),
              })
              .where("id", "=", scraped.id)
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

            await db
              .updateTable("crawl_jobs")
              .set({ processed_count: sql`processed_count + 1` })
              .where("id", "=", jobId)
              .execute();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === "CLOUDFLARE_BLOCKED") {
              await updateStatus("failed", { finished_at: nowIso(), last_error: message });
              return;
            }
            await db
              .updateTable("crawl_jobs")
              .set({ failed_count: sql`failed_count + 1`, last_error: message })
              .where("id", "=", jobId)
              .execute();
          } finally {
            if (config.delayMs > 0) {
              await new Promise((r) => setTimeout(r, config.delayMs));
            }
          }
        }
      };

      const concurrency = Math.max(1, Math.min(5, Number(config.concurrency) || 1));
      const workerPromise = Promise.all(Array.from({ length: concurrency }, () => worker()));

      const listPage = await context.newPage();

      const addFromText = (text: string) => {
        const newItems: Discovered[] = [];
        const re = /https?:\/\/makerworld\.com\/(zh|en)\/models\/\d+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const found = extractModelIdAndUrl(m[0]);
          if (!found) continue;
          if (discoveredIds.has(found.id)) continue;
          if (discoveredIds.size >= config.limitModels) break;
          discoveredIds.add(found.id);
          newItems.push(found);
        }

        if (newItems.length < 20) {
          const re2 =
            /"id"\s*:\s*"?(?<id>\d{4,})"?[\s\S]{0,600}?"(?<k>cover|coverImage|coverImageUrl|thumbnail|thumbnailUrl|image|imageUrl|designImage|designImageUrl)"\s*:\s*"(?<img>https?:\/\/[^"]+)"/g;
          let m2: RegExpExecArray | null;
          let cnt = 0;
          while ((m2 = re2.exec(text))) {
            const id = (m2.groups?.id ?? "").trim();
            const img = (m2.groups?.img ?? "").trim();
            if (!id || !img) continue;
            if (!/makerworld/i.test(img)) continue;
            if (discoveredIds.has(id)) continue;
            if (discoveredIds.size >= config.limitModels) break;
            const url = `https://makerworld.com/zh/models/${id}`;
            discoveredIds.add(id);
            newItems.push({ id, url, cover_image_url: img });
            cnt += 1;
            if (cnt >= 200) break;
          }
        }

        return newItems;
      };

      const onResponse = async (resp: any) => {
        if (discoveredIds.size >= config.limitModels) return;
        try {
          const url = resp.url?.() ?? "";
          if (!/api|graphql|models/i.test(url)) return;
          const headers = await resp.headers?.();
          const ct = (headers?.["content-type"] ?? "").toLowerCase();
          if (!ct.includes("application/json") && !ct.includes("text/plain")) return;
          const text = await resp.text();
          if (text.length > 2_000_000) return;
          const items = addFromText(text);
          if (items.length > 0) {
            push(items);
            await persistDiscovered(items);
            await db
              .updateTable("crawl_jobs")
              .set({ discovered_count: sql`discovered_count + ${items.length}` })
              .where("id", "=", jobId)
              .execute();
          }
        } catch {}
      };

      listPage.on("response", onResponse);
      await listPage.goto(config.startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await listPage.waitForTimeout(1500);
      const listSample = (await listPage.locator("body").innerText().catch(() => ""))?.slice(0, 1200) ?? "";
      if (listSample.includes("Cloudflare") || listSample.includes("验证您是真人")) {
        await updateStatus("failed", { finished_at: nowIso(), last_error: "CLOUDFLARE_BLOCKED" });
        return;
      }

      for (let i = 0; i < config.maxScrolls; i++) {
        await waitIfPausedOrCancelled();

        const domItems = (await listPage.evaluate(
          `(() => {
            const byId = new Map();
            const anchors = Array.from(document.querySelectorAll('a[href]'));

            const pushUrl = (arr, u) => {
              if (!u) return;
              const url = String(u).trim();
              if (!url) return;
              if (url.startsWith('data:')) return;
              if (url.includes('avatar')) return;
              arr.push(url);
            };

            const pickCover = (anchor) => {
              const findContainer = () => {
                let el = anchor;
                for (let i = 0; i < 8 && el; i++) {
                  const hasImg = el.querySelector && (el.querySelector('img') || el.querySelector('source'));
                  const bgInline = (el.style && el.style.backgroundImage) ? el.style.backgroundImage : '';
                  const bgComputed = (getComputedStyle(el).backgroundImage || '');
                  if (hasImg || bgInline.includes('url(') || (bgComputed && bgComputed !== 'none')) return el;
                  el = el.parentElement;
                }
                return anchor.closest('article') || anchor.closest('li') || anchor.closest('div');
              };

              const container = findContainer();
              if (!container) return null;
              const candidates = [];

              for (const img of Array.from(container.querySelectorAll('img'))) {
                pushUrl(candidates, img.currentSrc || '');
                pushUrl(candidates, img.src || '');
                const srcset = img.getAttribute('srcset') || (img.dataset && img.dataset.srcset) || '';
                if (srcset) {
                  const first = (srcset.split(',')[0] || '').trim().split(' ')[0] || '';
                  pushUrl(candidates, first);
                }
                pushUrl(candidates, (img.dataset && (img.dataset.src || img.dataset.original)) || '');
              }

              for (const src of Array.from(container.querySelectorAll('source'))) {
                const srcset = src.srcset || src.getAttribute('srcset') || '';
                if (srcset) {
                  const first = (srcset.split(',')[0] || '').trim().split(' ')[0] || '';
                  pushUrl(candidates, first);
                }
              }

              for (const el of Array.from(container.querySelectorAll('[style*=\"background\"]'))) {
                const style = el.getAttribute('style') || '';
                const m = style.match(/url\\((['\"]?)(.*?)\\1\\)/);
                if (m && m[2]) pushUrl(candidates, m[2]);
              }

              const bgNodes = [container].concat(Array.from(container.querySelectorAll('*')).slice(0, 60));
              for (const node of bgNodes) {
                const bg = (getComputedStyle(node).backgroundImage || '');
                if (!bg || bg === 'none') continue;
                const m = bg.match(/url\\((['\"]?)(.*?)\\1\\)/);
                if (m && m[2]) pushUrl(candidates, m[2]);
              }

              const prefer = candidates.find((c) => /makerworld|design|model|image/i.test(c));
              return prefer || candidates[0] || null;
            };

            for (const a of anchors) {
              const href = a.href || '';
              const m = href.match(/https?:\\/\\/makerworld\\.com\\/(zh|en)\\/models\\/(\\d+)/);
              if (!m) continue;
              const id = m[2];
              const url = 'https://makerworld.com/' + m[1] + '/models/' + id;
              const cover = pickCover(a);
              const title = (
                (a.closest('article') && (a.closest('article').querySelector('h3')?.textContent || a.closest('article').querySelector('h2')?.textContent)) ||
                a.textContent ||
                ''
              ).trim();

              const prev = byId.get(id);
              if (!prev) byId.set(id, { id, url, cover_image_url: cover, title: title || null });
              else {
                if (!prev.cover_image_url && cover) prev.cover_image_url = cover;
                if ((!prev.title || prev.title.length < 4) && title) prev.title = title;
              }
            }

            return Array.from(byId.values());
          })()`,
        )) as Discovered[];

        const newItems: Discovered[] = [];
        const enrichItems: Discovered[] = [];
        for (const it of domItems) {
          if (discoveredIds.has(it.id)) {
            if (it.cover_image_url || it.title || it.author_name) enrichItems.push(it);
            continue;
          }
          if (discoveredIds.size >= config.limitModels) break;
          discoveredIds.add(it.id);
          newItems.push(it);
        }

        if (enrichItems.length > 0) {
          await persistDiscovered(enrichItems);
        }

        if (newItems.length > 0) {
          push(newItems);
          await persistDiscovered(newItems);
          await db
            .updateTable("crawl_jobs")
            .set({ discovered_count: sql`discovered_count + ${newItems.length}` })
            .where("id", "=", jobId)
            .execute();
        }

        if (discoveredIds.size >= config.limitModels) break;
        await listPage.mouse.wheel(0, 2600);
        await listPage.waitForTimeout(900);
      }

      discoveryDone = true;
      if (wake) {
        const fn = wake;
        wake = null;
        fn();
      }

      listPage.off("response", onResponse);
      await listPage.close();

      await workerPromise;

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

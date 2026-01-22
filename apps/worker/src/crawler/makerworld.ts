import { chromium, type Browser, type BrowserContext } from "playwright";
import { env } from "../env";
import { resolveChromiumExecutablePath } from "./executable";

export interface DiscoveredModel {
  id: string;
  url: string;
}

export interface ScrapedModel {
  id: string;
  url: string;
  title: string | null;
  authorName: string | null;
  downloadCount: number | null;
  imageUrls: string[];
  description: string | null;
  rawTextSample: string | null;
}

function normalizeModelUrl(url: string) {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

export function extractModelIdAndUrl(href: string): DiscoveredModel | null {
  const u = new URL(href, "https://makerworld.com");
  const match = u.pathname.match(/\/(zh|en)\/models\/(\d+)/);
  if (!match) return null;
  const id = match[2];
  const url = `https://makerworld.com/${match[1]}/models/${id}`;
  return { id, url };
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>) {
  const executablePath = resolveChromiumExecutablePath(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function createContext(options?: { cookieHeader?: string }) {
  const executablePath = resolveChromiumExecutablePath(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: env.PLAYWRIGHT_USER_AGENT,
    viewport: { width: 1280, height: 720 },
  });
  if (options?.cookieHeader) {
    await context.setExtraHTTPHeaders({ cookie: options.cookieHeader });
  }
  return { browser, context };
}

export async function discoverModelLinks(options: {
  startUrl: string;
  limitModels: number;
  maxScrolls: number;
  cookieHeader?: string;
}) {
  const { browser, context } = await createContext({ cookieHeader: options.cookieHeader });
  try {
    return await discoverModelLinksInContext(context, options);
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function discoverModelLinksInContext(
  context: BrowserContext,
  options: { startUrl: string; limitModels: number; maxScrolls: number },
) {
  const { startUrl, limitModels, maxScrolls } = options;
  const discovered = new Map<string, DiscoveredModel>();

  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  const addFromText = (text: string) => {
    const re = /\/(zh|en)\/models\/(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const lang = m[1];
      const id = m[2];
      if (!discovered.has(id)) {
        discovered.set(id, { id, url: `https://makerworld.com/${lang}/models/${id}` });
      }
    }
  };

  const onResponse = async (resp: any) => {
    if (discovered.size >= limitModels) return;
    try {
      const url = resp.url?.() ?? "";
      if (!/api|graphql|models/i.test(url)) return;
      const headers = await resp.headers?.();
      const ct = (headers?.["content-type"] ?? "").toLowerCase();
      if (!ct.includes("application/json") && !ct.includes("text/plain")) return;
      const text = await resp.text();
      if (text.length > 2_000_000) return;
      addFromText(text);
    } catch {}
  };

  page.on("response", onResponse);

  for (let i = 0; i < maxScrolls; i++) {
    const hrefs = await page.$$eval("a[href]", (anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
    );
    for (const href of hrefs) {
      const model = extractModelIdAndUrl(href);
      if (!model) continue;
      if (!discovered.has(model.id)) {
        discovered.set(model.id, model);
      }
    }
    if (discovered.size >= limitModels) break;
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);
  }

  page.off("response", onResponse);
  await page.close();
  return Array.from(discovered.values()).slice(0, limitModels);
}

function parseNumber(text: string) {
  const raw = text.replace(/[^\d,]/g, "");
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  return n;
}

function parseCompactNumber(text: string) {
  const t = text.trim().toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*([km])\b/);
  if (!m) return parseNumber(text);
  const base = Number(m[1]);
  if (Number.isNaN(base)) return null;
  const mul = m[2] === "m" ? 1_000_000 : 1_000;
  return Math.round(base * mul);
}

function extractAuthorFromText(title: string | null, bodyText: string) {
  const lines = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 200);
  if (!title) return null;
  const idx = lines.indexOf(title.trim());
  if (idx >= 0) {
    const candidate = lines[idx + 1];
    if (candidate && candidate.length <= 40 && !["关注", "Follow"].includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractDownloadsFromText(bodyText: string) {
  const lines = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const isDateLike = (line: string) => {
    const l = line.trim();
    if (l.includes("发布于") || l.toLowerCase().includes("published")) return true;
    if (/\d{4}-\d{1,2}-\d{1,2}/.test(l)) return true;
    if (/\d{1,2}:\d{2}/.test(l)) return true;
    return false;
  };

  for (let i = 0; i < Math.min(lines.length, 400); i++) {
    const line = lines[i];
    if (line.includes("下载") || line.toLowerCase().includes("downloads")) {
      if (!isDateLike(line)) {
        const n = parseCompactNumber(line);
        if (n && n > 0 && n < 100_000_000) return n;
      }
      const next = lines[i + 1];
      if (next) {
        if (!isDateLike(next)) {
          const n2 = parseCompactNumber(next);
          if (n2 && n2 > 0 && n2 < 100_000_000) return n2;
        }
      }
    }
  }
  return null;
}

async function firstTextOrNull(locator: any) {
  try {
    const count = await locator.count();
    if (count < 1) return null;
    const t = await locator.first().innerText();
    const v = t?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

async function getMetaContentOrNull(page: any, selector: string) {
  try {
    const value = await page.locator(selector).getAttribute("content");
    const v = value?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

export async function scrapeModelPage(options: { url: string; cookieHeader?: string }) {
  const { browser, context } = await createContext({ cookieHeader: options.cookieHeader });
  try {
    return await scrapeModelPageInContext(context, { url: options.url });
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function scrapeModelPageInContext(context: BrowserContext, options: { url: string }) {
  const page = await context.newPage();
  let downloadFromApi: number | null = null;
  let authorFromApi: string | null = null;

  const maybeCaptureFromJson = (data: any) => {
    const stack: any[] = [data];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
        continue;
      }
      if (typeof cur !== "object") continue;
      for (const [k, v] of Object.entries(cur)) {
        const key = k.toLowerCase();
        if (downloadFromApi === null && typeof v === "number" && v > 0 && v < 100_000_000) {
          if (key.includes("download")) downloadFromApi = v;
        }
        if (authorFromApi === null && typeof v === "string") {
          if (key === "author" || key.includes("authorname") || key.includes("username")) {
            const s = v.trim();
            if (s && s.length <= 40) authorFromApi = s;
          }
        }
        if (typeof v === "object") stack.push(v);
      }
    }
  };

  const onResponse = async (resp: any) => {
    if (downloadFromApi !== null && authorFromApi !== null) return;
    try {
      const url = resp.url?.() ?? "";
      if (!/api|graphql/i.test(url)) return;
      const headers = await resp.headers?.();
      const ct = (headers?.["content-type"] ?? "").toLowerCase();
      if (!ct.includes("application/json")) return;
      const json = await resp.json();
      maybeCaptureFromJson(json);
    } catch {}
  };

  page.on("response", onResponse);
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const canonical = normalizeModelUrl(page.url());
  const discovered = extractModelIdAndUrl(canonical);
  if (!discovered) {
    throw new Error(`Unable to extract model id from url: ${canonical}`);
  }

  const title =
    (await firstTextOrNull(page.locator("h1"))) ?? (await getMetaContentOrNull(page, 'meta[property="og:title"]'));

  let authorName =
    (await firstTextOrNull(page.locator('a[href*="/@"]'))) ??
    (await firstTextOrNull(page.locator('a[href*="/user/"]'))) ??
    (await firstTextOrNull(page.locator('[data-testid*="author"]'))) ??
    null;

  let downloadCount: number | null = null;
  try {
    const metricTexts = await page.$$eval('[aria-label],[title]', (nodes) => {
      const out: string[] = [];
      for (const n of nodes as any[]) {
        const el = n as HTMLElement;
        const aria = el.getAttribute("aria-label") ?? "";
        const title = el.getAttribute("title") ?? "";
        const key = `${aria} ${title}`.toLowerCase();
        if (!key.includes("下载") && !key.includes("download")) continue;
        const parent = el.parentElement;
        const t = (parent?.innerText ?? el.innerText ?? "").trim();
        if (t) out.push(t);
      }
      return out.slice(0, 80);
    });
    for (const t of metricTexts) {
      const n = parseCompactNumber(t);
      if (n && n > 0 && n < 100_000_000) {
        downloadCount = n;
        break;
      }
    }
  } catch {
    downloadCount = null;
  }

  const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);

  const imgHrefs = await page.$$eval("img", (imgs) =>
    imgs
      .map((img) => (img as HTMLImageElement).src)
      .filter(Boolean)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http"))
      .filter((s) => !/avatar|icon|logo|badge/i.test(s)),
  );
  const uniq = Array.from(new Set([ogImage, ...imgHrefs].filter(Boolean) as string[]));
  const preferred = uniq.filter((u) => /makerworld|design|model/i.test(u));
  const imageUrls = (preferred.length > 0 ? preferred : uniq).slice(0, 30);

  const mainText = (await firstTextOrNull(page.locator("main"))) ?? (await firstTextOrNull(page.locator("article"))) ?? null;
  const description = mainText ? mainText.slice(0, 6000) : null;

  const bodyTextFull = (await page.locator("body").innerText().catch(() => null)) ?? null;
  const rawTextSample = bodyTextFull?.slice(0, 2000) ?? null;
  if (rawTextSample && (rawTextSample.includes("Cloudflare") || rawTextSample.includes("验证您是真人"))) {
    await page.close();
    throw new Error("CLOUDFLARE_BLOCKED");
  }

  if (bodyTextFull) {
    if (!authorName) authorName = extractAuthorFromText(title, bodyTextFull);
    if (!downloadCount) downloadCount = extractDownloadsFromText(bodyTextFull);
  }

  if (!authorName && authorFromApi) authorName = authorFromApi;
  if (!downloadCount && downloadFromApi) downloadCount = downloadFromApi;

  page.off("response", onResponse);
  await page.close();

  const result: ScrapedModel = {
    id: discovered.id,
    url: discovered.url,
    title,
    authorName,
    downloadCount,
    imageUrls,
    description,
    rawTextSample,
  };

  return result;
}

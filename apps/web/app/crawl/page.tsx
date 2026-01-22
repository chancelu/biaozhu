"use client";

import { useEffect, useMemo, useState } from "react";
import { workerUrl } from "@/lib/worker";

type CrawlJob = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  discovered_count: number;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return (await res.json()) as T;
}

export default function CrawlPage() {
  const [startUrl, setStartUrl] = useState("https://makerworld.com/zh/3d-models");
  const [limitModels, setLimitModels] = useState(200);
  const [maxScrolls, setMaxScrolls] = useState(60);
  const [cookieHeader, setCookieHeader] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("mw_crawl_job_id");
    if (saved) {
      setJobId(saved);
      return;
    }
    getJson<CrawlJob>(workerUrl("/api/crawl-jobs-latest"))
      .then((j) => {
        if (j?.id) setJobId(j.id);
      })
      .catch(() => {});
  }, []);

  const tips = useMemo(() => {
    if (!job?.last_error) return null;
    if (job.last_error === "CLOUDFLARE_BLOCKED") {
      return "当前环境被 Cloudflare 人机验证拦截。请先在浏览器正常打开 MakerWorld 后，把 Cookie 粘贴到下面的 Cookie Header（至少包含 cf_clearance），再重新开始爬取。";
    }
    return null;
  }, [job?.last_error]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await getJson<CrawlJob>(workerUrl(`/api/crawl-jobs/${jobId}`));
        if (!cancelled) setJob(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId]);

  const start = async (override?: {
    startUrl?: string;
    limitModels?: number;
    maxScrolls?: number;
    cookieHeader?: string;
  }) => {
    setError(null);
    setBusy(true);
    try {
      const effectiveStartUrl = override?.startUrl ?? startUrl;
      const effectiveLimitModels = override?.limitModels ?? limitModels;
      const effectiveMaxScrolls = override?.maxScrolls ?? maxScrolls;
      const effectiveCookie = override?.cookieHeader ?? cookieHeader;

      const result = await postJson<{ id: string }>(workerUrl("/api/crawl-jobs"), {
        startUrl: effectiveStartUrl,
        limitModels: effectiveLimitModels,
        maxScrolls: effectiveMaxScrolls,
        cookieHeader: effectiveCookie.trim() ? effectiveCookie.trim() : undefined,
        clearHistory: true,
      });
      setJobId(result.id);
      localStorage.setItem("mw_crawl_job_id", result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start10k = async () => {
    const u = "https://makerworld.com/zh/3d-models";
    setStartUrl(u);
    setLimitModels(10000);
    setMaxScrolls(5000);
    await start({ startUrl: u, limitModels: 10000, maxScrolls: 5000 });
  };

  const clearJob = async () => {
    setJobId("");
    setJob(null);
    localStorage.removeItem("mw_crawl_job_id");
  };

  const pause = async () => {
    if (!jobId) return;
    await postJson(workerUrl(`/api/crawl-jobs/${jobId}/pause`), {});
  };

  const resume = async () => {
    if (!jobId) return;
    await postJson(workerUrl(`/api/crawl-jobs/${jobId}/resume`), {});
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">爬取</h1>
        <div className="text-sm text-zinc-600">
          从 <span className="font-mono">/zh/3d-models</span> 自动发现模型链接并进入子页面抓取字段。
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="grid gap-1">
          <div className="text-sm font-medium">起始 URL</div>
          <input
            className="h-10 rounded border border-zinc-200 px-3 text-sm"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="grid gap-1">
            <div className="text-sm font-medium">最多模型数</div>
            <input
              type="number"
              className="h-10 rounded border border-zinc-200 px-3 text-sm"
              value={limitModels}
              onChange={(e) => setLimitModels(Number(e.target.value))}
            />
          </label>

          <label className="grid gap-1">
            <div className="text-sm font-medium">最大滚动次数</div>
            <input
              type="number"
              className="h-10 rounded border border-zinc-200 px-3 text-sm"
              value={maxScrolls}
              onChange={(e) => setMaxScrolls(Number(e.target.value))}
            />
          </label>
        </div>

        <label className="grid gap-1">
          <div className="text-sm font-medium">Cookie Header（可选）</div>
          <textarea
            className="min-h-24 rounded border border-zinc-200 px-3 py-2 text-sm"
            value={cookieHeader}
            onChange={(e) => setCookieHeader(e.target.value)}
            placeholder="例如：cf_clearance=...; other_cookie=..."
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            disabled={busy}
            onClick={() => start()}
            className="h-10 rounded bg-black px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            开始爬取
          </button>
          <button
            disabled={busy}
            onClick={start10k}
            className="h-10 rounded border border-zinc-200 bg-white px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
          >
            一键爬取1万
          </button>
          {jobId ? (
            <a className="text-sm underline" href={`/label`}>
              去标注页查看表格
            </a>
          ) : null}
          {jobId ? (
            <button onClick={clearJob} className="text-sm text-zinc-600 underline">
              清除任务ID
            </button>
          ) : null}
        </div>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {tips ? <div className="text-sm text-amber-700">{tips}</div> : null}
      </div>

      {job ? (
        <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">Job</span> <span className="font-mono">{job.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={pause} className="h-9 rounded border border-zinc-200 px-3 text-sm hover:bg-zinc-50">
                暂停
              </button>
              <button onClick={resume} className="h-9 rounded border border-zinc-200 px-3 text-sm hover:bg-zinc-50">
                继续
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-zinc-500">状态</div>
              <div className="font-medium">{job.status}</div>
            </div>
            <div>
              <div className="text-zinc-500">发现</div>
              <div className="font-medium">{job.discovered_count}</div>
            </div>
            <div>
              <div className="text-zinc-500">已处理</div>
              <div className="font-medium">{job.processed_count}</div>
            </div>
            <div>
              <div className="text-zinc-500">失败</div>
              <div className="font-medium">{job.failed_count}</div>
            </div>
          </div>
          {job.last_error ? (
            <div className="text-sm">
              <div className="text-zinc-500">最后错误</div>
              <div className="font-mono text-red-600">{job.last_error}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

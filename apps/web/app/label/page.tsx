"use client";

import { useEffect, useMemo, useState } from "react";
import { workerUrl } from "@/lib/worker";

type ModelRow = {
  id: string;
  url: string;
  title: string | null;
  author_name: string | null;
  download_count: number | null;
  cover_image_url: string | null;
  summary?: string | null;
  updated_at: string;
  grade?: string | null;
};

type ListResponse = {
  rows: ModelRow[];
  total: number;
};

type LabelJob = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_count: number;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
};

type Stats = {
  total: number;
  labeled: number;
  byGrade: Record<string, number>;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return (await res.json()) as T;
}

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

export default function LabelPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [labelJobId, setLabelJobId] = useState<string>("");
  const [labelJob, setLabelJob] = useState<LabelJob | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [labelLimit, setLabelLimit] = useState<number>(0);
  const [labelBusy, setLabelBusy] = useState(false);

  const pageCount = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / pageSize));
  }, [data, pageSize]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getJson<ListResponse>(workerUrl(`/api/models?page=${page}&pageSize=${pageSize}&withCover=1`));
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const s = await getJson<Stats>(workerUrl("/api/stats"));
        if (!cancelled) setStats(s);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    run();
    const t = setInterval(run, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!labelJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await getJson<LabelJob>(workerUrl(`/api/label-jobs/${labelJobId}`));
        if (!cancelled) setLabelJob(j);
      } catch {
        if (!cancelled) setLabelJob(null);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [labelJobId]);

  const startLabel = async () => {
    setLabelBusy(true);
    setError(null);
    try {
      const res = await postJson<{ id: string }>(workerUrl("/api/label-jobs"), {
        limit: labelLimit > 0 ? labelLimit : undefined,
      });
      setLabelJobId(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLabelBusy(false);
    }
  };

  const pauseLabel = async () => {
    if (!labelJobId) return;
    await postJson(workerUrl(`/api/label-jobs/${labelJobId}/pause`), {});
  };

  const resumeLabel = async () => {
    if (!labelJobId) return;
    await postJson(workerUrl(`/api/label-jobs/${labelJobId}/resume`), {});
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">标注</h1>
          <div className="text-sm text-zinc-600">这里展示爬取入库的模型数据（按你的指定列）。</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            className="h-9 rounded border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            href={workerUrl("/api/export.csv")}
            target="_blank"
            rel="noreferrer"
          >
            导出CSV
          </a>
          <select
            className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}/页
              </option>
            ))}
          </select>
          <button
            className="h-9 rounded border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <div className="text-sm tabular-nums">
            {page} / {pageCount}
          </div>
          <button
            className="h-9 rounded border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            下一页
          </button>
        </div>
      </div>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">自动标注</div>
            <div className="text-sm text-zinc-600">
              需要在 Worker 环境配置 <span className="font-mono">ARK_API_KEY</span>（或兼容的 <span className="font-mono">OPENAI_API_KEY</span>）。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="h-9 w-28 rounded border border-zinc-200 px-2 text-sm"
              placeholder="limit"
              value={labelLimit}
              onChange={(e) => setLabelLimit(Number(e.target.value))}
            />
            <button
              className="h-9 rounded bg-black px-3 text-sm font-medium text-white disabled:opacity-60"
              disabled={labelBusy}
              onClick={startLabel}
            >
              开始标注
            </button>
            <button
              className="h-9 rounded border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={!labelJobId}
              onClick={pauseLabel}
            >
              暂停
            </button>
            <button
              className="h-9 rounded border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={!labelJobId}
              onClick={resumeLabel}
            >
              继续
            </button>
          </div>
        </div>

        {stats ? (
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="rounded border border-zinc-200 px-3 py-2">
              总模型：<span className="font-medium tabular-nums">{stats.total}</span>
            </div>
            <div className="rounded border border-zinc-200 px-3 py-2">
              已标注：<span className="font-medium tabular-nums">{stats.labeled}</span>
            </div>
            {["S", "A", "B", "C", "D"].map((g) => (
              <div key={g} className="rounded border border-zinc-200 px-3 py-2">
                {g}：<span className="font-medium tabular-nums">{stats.byGrade[g] ?? 0}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">统计信息暂不可用</div>
        )}

        {labelJob ? (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-zinc-500">状态</div>
              <div className="font-medium">{labelJob.status}</div>
            </div>
            <div>
              <div className="text-zinc-500">总数</div>
              <div className="font-medium tabular-nums">{labelJob.total_count}</div>
            </div>
            <div>
              <div className="text-zinc-500">已处理</div>
              <div className="font-medium tabular-nums">{labelJob.processed_count}</div>
            </div>
            <div>
              <div className="text-zinc-500">失败</div>
              <div className="font-medium tabular-nums">{labelJob.failed_count}</div>
            </div>
            {labelJob.last_error ? (
              <div className="col-span-2 md:col-span-4">
                <div className="text-zinc-500">最后错误</div>
                <div className="font-mono text-red-600">{labelJob.last_error}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-zinc-200 text-left text-zinc-600">
                <th className="p-3">ID</th>
                <th className="p-3">文件链接</th>
                <th className="p-3">作者名</th>
                <th className="p-3">下载量</th>
                <th className="p-3">标题</th>
                <th className="p-3">模型图</th>
                <th className="p-3">等级</th>
                <th className="p-3">图片摘要</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-3 text-zinc-500" colSpan={8}>
                    加载中…
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 align-top">
                  <td className="p-3 font-mono">{row.id}</td>
                  <td className="p-3">
                    <a className="underline" href={row.url} target="_blank" rel="noreferrer">
                      {row.url}
                    </a>
                  </td>
                  <td className="p-3">{row.author_name ?? "-"}</td>
                  <td className="p-3 tabular-nums">{row.download_count ?? "-"}</td>
                  <td className="p-3">{row.title ?? "-"}</td>
                  <td className="p-3">
                    {row.cover_image_url ? (
                      <a href={row.cover_image_url} target="_blank" rel="noreferrer">
                        <img
                          src={row.cover_image_url}
                          alt={row.title ?? row.id}
                          className="h-16 w-16 rounded object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-3 font-mono">{row.grade ?? "-"}</td>
                  <td className="p-3 max-w-[420px] whitespace-pre-wrap text-zinc-700">{row.summary ?? "-"}</td>
                </tr>
              ))}
              {!loading && data && data.rows.length === 0 ? (
                <tr>
                  <td className="p-3 text-zinc-500" colSpan={8}>
                    暂无数据。请先去“爬取”页面开始抓取。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

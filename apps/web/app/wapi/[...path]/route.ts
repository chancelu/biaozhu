export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workerInternalBase() {
  return (process.env.WORKER_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
}

async function proxy(req: Request, pathParts: string[]) {
  const base = workerInternalBase();
  const url = new URL(req.url);
  const target = `${base}/${pathParts.map(encodeURIComponent).join("/")}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

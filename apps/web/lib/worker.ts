export function workerBaseUrl() {
  const base =
    process.env.NEXT_PUBLIC_WORKER_URL ?? (process.env.NODE_ENV === "production" ? "/wapi" : "http://localhost:4000");
  return base.replace(/\/+$/, "");
}

export function workerUrl(path: string) {
  return `${workerBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

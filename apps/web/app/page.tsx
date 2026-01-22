export default function Home() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">MakerWorld 爬取与标注</h1>
      <div className="flex gap-3">
        <a className="rounded border border-zinc-200 bg-white px-3 py-2 hover:bg-zinc-50" href="/crawl">
          去爬取
        </a>
        <a className="rounded border border-zinc-200 bg-white px-3 py-2 hover:bg-zinc-50" href="/label">
          去标注
        </a>
      </div>
    </div>
  );
}

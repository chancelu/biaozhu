import { scrapeModelPage } from "../crawler/makerworld";

async function main() {
  const url = process.argv[2] ?? "https://makerworld.com/zh/models/242239";
  const result = await scrapeModelPage({ url });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});


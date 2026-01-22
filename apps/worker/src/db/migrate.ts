import { promises as fs } from "node:fs";
import path from "node:path";
import { Migrator, FileMigrationProvider } from "kysely";
import { createDb } from "./db";

async function main() {
  const db = createDb();
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();
  if (results) {
    for (const result of results) {
      if (result.status === "Success") {
        process.stdout.write(`migrated ${result.migrationName}\n`);
      } else {
        process.stdout.write(`failed ${result.migrationName}\n`);
      }
    }
  }
  if (error) {
    throw error;
  }
  await db.destroy();
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});


import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import DatabaseSqlite from "better-sqlite3";
import { Pool } from "pg";
import { env } from "../env";
import type { Database } from "./types";

export function createDb() {
  if (env.DB_DIALECT === "postgres") {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when DB_DIALECT=postgres");
    }
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const dialect = new PostgresDialect({ pool });
    return new Kysely<Database>({ dialect });
  }

  const sqlite = new DatabaseSqlite(env.SQLITE_PATH);
  const dialect = new SqliteDialect({ database: sqlite });
  return new Kysely<Database>({ dialect });
}

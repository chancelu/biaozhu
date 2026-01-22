import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("crawl_jobs")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("started_at", "text")
    .addColumn("finished_at", "text")
    .addColumn("config_json", "text", (col) => col.notNull())
    .addColumn("discovered_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("processed_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("failed_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("last_error", "text")
    .execute();

  await db.schema
    .createTable("models")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("author_name", "text")
    .addColumn("download_count", "integer")
    .addColumn("cover_image_url", "text")
    .addColumn("description", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("model_images")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("model_id", "text", (col) => col.notNull())
    .addColumn("idx", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addForeignKeyConstraint("model_images_model_id_fk", ["model_id"], "models", ["id"], (cb) =>
      cb.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("label_jobs")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("started_at", "text")
    .addColumn("finished_at", "text")
    .addColumn("config_json", "text", (col) => col.notNull())
    .addColumn("total_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("processed_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("failed_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("last_error", "text")
    .execute();

  await db.schema
    .createTable("model_labels")
    .addColumn("model_id", "text", (col) => col.primaryKey())
    .addColumn("grade", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("extracted_json", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addForeignKeyConstraint("model_labels_model_id_fk", ["model_id"], "models", ["id"], (cb) =>
      cb.onDelete("cascade"),
    )
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("model_labels").execute();
  await db.schema.dropTable("label_jobs").execute();
  await db.schema.dropTable("model_images").execute();
  await db.schema.dropTable("models").execute();
  await db.schema.dropTable("crawl_jobs").execute();
}


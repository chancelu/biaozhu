import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./data.db"),
  DB_DIALECT: z.enum(["sqlite", "postgres"]).default("sqlite"),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  PLAYWRIGHT_USER_AGENT: z
    .string()
    .default(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ),
  OPENAI_API_KEY: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z.string().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_MODEL: z.string().default("doubao-seed-1-8-251228"),
  WORKER_PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

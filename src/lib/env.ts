import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("Asia/Karachi"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

let cached: z.infer<typeof schema> | null = null;

/**
 * Validated environment, checked on first use at runtime — not at import time, so `next build`
 * (which has no secrets) can still collect page data.
 */
export function getEnv() {
  cached ??= schema.parse(process.env);
  return cached;
}

export const appUrl = () => getEnv().APP_URL;

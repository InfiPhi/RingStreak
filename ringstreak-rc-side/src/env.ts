import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("8082"),
  APP_BASE_URL: z.string().url().default("http://localhost:8082"),
  RC_SERVER: z.string().url(),
  RC_CLIENT_ID: z.string(),
  RC_CLIENT_SECRET: z.string(),
  RC_WEBHOOK_SECRET: z.string().default("dev-secret"),
  REDIRECT_PATH: z.string().default("/rc/callback"),
  DATA_DIR: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  STREAK_SIDE_URL: z.string().url().default("http://localhost:8081"),
  STREAK_SHARED_SECRET: z.string().default("dev-secret")
});

export const env = EnvSchema.parse(process.env);

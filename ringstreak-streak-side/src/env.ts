import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.string().default("8081"),
  APP_BASE_URL: z.string().url().default("http://localhost:8081"),
  STREAK_API_BASE: z.string().url(),
  STREAK_API_KEY: z.string().min(1, "STREAK_API_KEY is required"),
  STREAK_PIPELINE_KEY: z.string().optional(),
  SHARED_SECRET: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;
export const env: Env = EnvSchema.parse(process.env);
console.log("Environment variables loaded");
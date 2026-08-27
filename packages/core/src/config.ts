// ============================================================================
// Orchestra Part 5 — Configuration
// Source of truth: Part 5 § "Configuration and secrets"
// Configuration is parsed before listeners, queues, or database clients are
// constructed. This makes an incomplete deployment fail during boot rather
// than after accepting a run.
// ============================================================================

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  // ── Runtime ──
  nodeEnv: (process.env.NODE_ENV ?? "development") as string,
  port: Number(process.env.API_PORT ?? 4000),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 25),

  // ── Database (Supabase) ──
  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
  ),
  supabaseUrl: process.env.SUPABASE_URL ?? "http://localhost:54324",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: required(
    "SUPABASE_SERVICE_KEY",
    "replace-with-service-role-key"
  ),

  // ── Redis ──
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  // ── Auth ──
  jwtSecret: required("JWT_SECRET", "dev-jwt-secret-change-me-please-32ch"),
  encryptionKey: required(
    "ENCRYPTION_KEY",
    "dev-encryption-key-change-me-32ch"
  ),
  serviceToken: required(
    "SERVICE_TOKEN",
    "replace-with-a-48-plus-character-random-secret"
  ),
  serviceTokenMaxAgeSeconds: Number(
    process.env.SERVICE_TOKEN_MAX_AGE_SECONDS ?? 60
  ),

  // ── CORS ──
  corsOrigins: (
    process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // ── OAuth providers ──
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:4000/api/v1/oauth/google/callback",
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID ?? "",
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    tenant: process.env.MICROSOFT_TENANT_ID ?? "common",
    redirectUri:
      process.env.MICROSOFT_REDIRECT_URI ??
      "http://localhost:4000/api/v1/oauth/microsoft/callback",
  },

  // ── AI Service ──
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",

  // ── External ──
  stripe: {
    secret: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    publishable: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  },

  // ── Public base URL (for webhook registrations) ──
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",

  // ── Logging ──
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

function required(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? 4000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  apiUrl: process.env.API_URL ?? "http://localhost:4000",
  databaseUrl: required("DATABASE_URL", "postgres://algoverge:algoverge@localhost:5432/algoverge"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: required("JWT_SECRET", "dev-jwt-secret-change-me-please-32ch"),
  encryptionKey: required("ENCRYPTION_KEY", "dev-encryption-key-change-me-32ch"),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim()).filter(Boolean),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/api/v1/oauth/google/callback"
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID ?? "",
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? ""
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? ""
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    tenant: process.env.MICROSOFT_TENANT_ID ?? "common",
    redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? "http://localhost:4000/api/v1/oauth/microsoft/callback"
  },
  stripe: {
    secret: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    publishable: process.env.STRIPE_PUBLISHABLE_KEY ?? ""
  },
  openai: process.env.OPENAI_API_KEY ?? "",
  anthropic: process.env.ANTHROPIC_API_KEY ?? "",
  gemini: process.env.GEMINI_API_KEY ?? "",
  meta: {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "algoverge-verify"
  },
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  resend: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Algoverge <noreply@algoverge.local>",
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@algoverge.local",
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
  serviceToken: process.env.SERVICE_TOKEN ?? "dev-service-token-change-me-32ch",
  serviceTokenMaxAgeSeconds: Number(process.env.SERVICE_TOKEN_MAX_AGE_SECONDS ?? 300),
};

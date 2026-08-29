import type { AppManifest } from "@algoverge/shared";
import { getApp } from "./catalog/catalog";

export type AuthField = {
  key: string;
  label: string;
  type: "string" | "password" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
  helpUrlLabel?: string;
  options?: { label: string; value: string }[];
};

export type AuthSchema = {
  authType: string;
  fields: AuthField[];
  oauthProvider?: "google" | "slack";
  note?: string;
  confirmTitle?: string;
  confirmBody?: string;
};

const API_KEY: AuthField[] = [{ key: "api_key", label: "API key", type: "password", required: true }];

const BY_SLUG: Record<string, AuthField[]> = {
  openai: [
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      placeholder: "sk-...",
      help: "and paste the key below (keys start with sk-).",
      helpUrl: "https://platform.openai.com/api-keys",
      helpUrlLabel: "Create an API key"
    },
    {
      key: "organization_id",
      label: "Organization ID",
      type: "string",
      required: false,
      help: "If your OpenAI account belongs to multiple organizations, paste the org id."
    },
    {
      key: "region",
      label: "Region",
      type: "select",
      required: false,
      options: [
        { label: "Global (Default)", value: "global" },
        { label: "US", value: "us" },
        { label: "EU", value: "eu" }
      ],
      help: "Select your OpenAI data residency region. Choose Global unless your org requires a region."
    }
  ],
  anthropic: [
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      helpUrl: "https://console.anthropic.com/settings/keys",
      helpUrlLabel: "Create an API key"
    }
  ],
  gemini: [
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      helpUrl: "https://aistudio.google.com/apikey",
      helpUrlLabel: "Create an API key"
    }
  ],
  twilio: [
    { key: "account_sid", label: "Account SID", type: "string", required: true },
    { key: "auth_token", label: "Auth token", type: "password", required: true }
  ],
  jira: [
    { key: "host", label: "Site URL", type: "string", required: true, placeholder: "https://your-domain.atlassian.net" },
    { key: "email", label: "Email", type: "string", required: true },
    { key: "api_token", label: "API token", type: "password", required: true }
  ],
  zendesk: [
    { key: "subdomain", label: "Subdomain", type: "string", required: true },
    { key: "email", label: "Email", type: "string", required: true },
    { key: "api_token", label: "API token", type: "password", required: true }
  ],
  shopify: [
    { key: "shop", label: "Shop domain", type: "string", required: true, placeholder: "your-store.myshopify.com" },
    { key: "access_token", label: "Admin API access token", type: "password", required: true }
  ],
  airtable: [
    { key: "api_key", label: "Personal access token", type: "password", required: true }
  ],
  trello: [
    { key: "api_key", label: "API key", type: "password", required: true },
    { key: "token", label: "Token", type: "password", required: true }
  ]
};

const GOOGLE = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

/** Piece auth contract (doc 4 §4): one of five patterns, never credentials on the workflow. */
export function authSchemaFor(app: Pick<AppManifest, "slug" | "authType"> | null | undefined): AuthSchema {
  const authType = app?.authType ?? "none";
  const slug = app?.slug ?? "";
  if (authType === "none") return { authType: "none", fields: [] };
  if (authType === "oauth2") {
    if (GOOGLE.has(slug)) {
      return {
        authType: "oauth2",
        fields: [],
        oauthProvider: "google",
        confirmTitle: `Are you sure you want to connect your ${app?.slug ?? "Google"} account?`,
        confirmBody: "Orchestra stores encrypted tokens only. Copilot can reuse this connection later but cannot create it."
      };
    }
    if (slug === "slack") {
      return {
        authType: "oauth2",
        fields: [{ key: "bot_token", label: "Bot token", type: "password", required: true, placeholder: "xoxb-..." }],
        oauthProvider: "slack",
        confirmTitle: "Are you sure you want to connect your Slack account?",
        note: "Paste a bot token from Slack if OAuth is not configured for this workspace."
      };
    }
    return {
      authType: "oauth2",
      fields: [{ key: "access_token", label: "Access token", type: "password", required: true }],
      note: "OAuth client for this app is not registered yet (manual developer app). Paste a token from the vendor, or wait until OAuth is configured. Do not put credentials on workflow steps."
    };
  }
  if (authType === "basic") {
    return {
      authType: "basic",
      fields: BY_SLUG[slug] ?? [
        { key: "username", label: "Username", type: "string", required: true },
        { key: "password", label: "Password / token", type: "password", required: true }
      ]
    };
  }
  return { authType: authType || "api_key", fields: BY_SLUG[slug] ?? API_KEY };
}

export function authSchemaForSlug(slug: string) {
  return authSchemaFor(getApp(slug) ?? { slug, authType: "api_key" });
}

export function validateAuthCredentials(schema: AuthSchema, credentials: Record<string, unknown>) {
  const missing = schema.fields.filter((f) => f.required !== false && !String(credentials[f.key] ?? "").trim()).map((f) => f.key);
  return missing;
}

export function looksLikeSlackToken(value: string) {
  const v = value.trim();
  return /^xox[a-z][a-z0-9.-]/i.test(v) || v.startsWith("xoxe.");
}

export function isOpenAiApiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]/.test(value.trim());
}

export function credentialShapeError(appSlug: string, credentials: Record<string, unknown>): string | null {
  const key = String(credentials.api_key ?? credentials.access_token ?? "").trim();
  if (!key) return null;
  if (appSlug === "openai" || appSlug === "ai") {
    if (looksLikeSlackToken(key)) {
      return "That value is a Slack token (starts with xoxe/xoxb), not an OpenAI key. Paste a key from https://platform.openai.com/api-keys that starts with sk-. Changing OPENAI_API_KEY in .env does not replace a saved connection.";
    }
    if (!isOpenAiApiKey(key)) {
      return "OpenAI API keys start with sk-. Get one from https://platform.openai.com/api-keys, then Reconnect this account. Updating .env alone does not update an existing connection.";
    }
  }
  if (appSlug === "anthropic" && !key.startsWith("sk-ant-") && looksLikeSlackToken(key)) {
    return "That looks like a Slack token. Anthropic keys start with sk-ant-.";
  }
  if (appSlug === "slack" && isOpenAiApiKey(key)) {
    return "That looks like an OpenAI key. Connect Slack with OAuth or a Slack bot token (xoxb-), not an sk- key.";
  }
  return null;
}

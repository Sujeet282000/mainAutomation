import type { AppManifest } from "@algoverge/shared";
import { getApp } from "./catalog";
import { authSchemaFor } from "../auth-schema";

export type ConnectionAuthField = {
  key: string;
  label: string;
  type: "text" | "string" | "password" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
  helpUrlLabel?: string;
  options?: { label: string; value: string }[];
};

export type ConnectionSetup = {
  appSlug: string;
  appName: string;
  authType: string;
  oauthProvider?: string;
  fields: ConnectionAuthField[];
  note?: string;
  capabilities: { triggers: number; actions: number; searches: number };
};

const GOOGLE = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

/**
 * Connection setup for the connect-account modal: rich per-app credential
 * fields (Zapier-style), plus capability counts for the header line.
 */
export function getConnectionSetup(appSlug: string): ConnectionSetup | null {
  const app = getApp(appSlug);
  if (!app) return null;
  const schema = authSchemaFor(app);
  const counts = app.operations.reduce(
    (out, operation) => {
      if (operation.type === "trigger") out.triggers += 1;
      else if (operation.type === "action") out.actions += 1;
      else if (operation.type === "search") out.searches += 1;
      return out;
    },
    { triggers: 0, actions: 0, searches: 0 }
  );
  return {
    appSlug: app.slug,
    appName: app.name,
    authType: app.authType ?? "none",
    ...(schema.oauthProvider ? { oauthProvider: schema.oauthProvider } : {}),
    fields: schema.fields as ConnectionAuthField[],
    ...(schema.note ? { note: schema.note } : {}),
    capabilities: counts
  };
}

export function connectionCanBeUsedByApp(connectionAppSlug: string, stepAppSlug: string): boolean {
  return connectionAppSlug === stepAppSlug || (GOOGLE.has(connectionAppSlug) && GOOGLE.has(stepAppSlug));
}

export function sanitizeConnectionMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const input = metadata as Record<string, unknown>;
  const forbidden = new Set(["access_token", "refresh_token", "client_secret", "api_key", "password", "secret", "token"]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !forbidden.has(key.toLowerCase())));
}

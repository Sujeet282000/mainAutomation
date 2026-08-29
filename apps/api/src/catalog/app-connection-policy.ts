import type { AppManifest } from "@algoverge/shared";
import { getApp } from "./catalog";

export type ConnectionAuthField = {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[];
};

export type ConnectionSetup = {
  appSlug: string;
  appName: string;
  authType: string;
  oauthProvider?: string;
  fields: ConnectionAuthField[];
  capabilities: { triggers: number; actions: number; searches: number };
};

const GOOGLE = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

function authFields(app: AppManifest | undefined): ConnectionAuthField[] {
  if (!app || app.authType === "none") return [];
  if (app.authType === "oauth2") {
    return [{ key: "oauth", label: "Account", type: "text", required: false, help: "You will authorize this account in the provider window." }];
  }
  if (app.authType === "api_key") {
    return [{ key: "api_key", label: "API key", type: "password", required: true }];
  }
  if (app.authType === "basic") {
    return [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true }
    ];
  }
  return [{ key: "credentials", label: "Credentials JSON", type: "password", required: true, help: "Stored encrypted; never returned to the browser." }];
}

export function getConnectionSetup(appSlug: string): ConnectionSetup | null {
  const app = getApp(appSlug);
  if (!app) return null;
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
    ...(GOOGLE.has(app.slug) ? { oauthProvider: "google" } : {}),
    fields: authFields(app),
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

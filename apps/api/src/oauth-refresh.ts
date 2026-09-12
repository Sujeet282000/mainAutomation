/**
 * OAuth token lifecycle — Zapier-style "the connection just works".
 *
 * - `ensureFreshToken` is called whenever a connection's credentials are loaded
 *   (workflow execution, step testing, connection tests). If the stored access
 *   token is expired (or expiring inside the safety window) and a refresh token
 *   exists for a refreshable provider, it silently refreshes and persists the
 *   new tokens. On refresh failure the connection is marked needs_attention so
 *   the UI prompts a reconnect — runs never crash on a stale token.
 * - `refreshConnectionToken` performs the vendor exchange from the registry
 *   (`catalog/oauth-providers.ts`), so providers are data, not code.
 */
import { query, queryOne } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import { OAUTH_PROVIDERS } from "./catalog/oauth-providers";

/** Refresh when the token dies within the next 5 minutes. */
const SAFETY_WINDOW_MS = 5 * 60 * 1000;

type StoredAuth = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  instance_url?: string;
  [k: string]: unknown;
};

/**
 * Returns credentials for a connection, refreshing the access token first when
 * needed. Falls back to the stored credentials on any refresh error.
 */
export async function ensureFreshToken(
  connectionId: string,
  orgId: string,
  pieceName: string,
): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown }>(
    `SELECT ciphertext, encrypted_payload FROM connections WHERE id = $1 AND org_id = $2`,
    [connectionId, orgId],
  );
  if (!row) return null;
  let auth: StoredAuth | null = null;
  if (row.ciphertext) auth = decryptJson(row.ciphertext, orgId) as StoredAuth;
  else if (row.encrypted_payload && typeof row.encrypted_payload === "object") {
    const blob = row.encrypted_payload as { _enc?: string };
    auth = blob._enc
      ? (decryptJson(Buffer.from(blob._enc, "base64"), orgId) as StoredAuth)
      : (row.encrypted_payload as StoredAuth);
  }
  if (!auth) return null;

  const expiresAt = Number(auth.expires_at ?? 0);
  const needsRefresh =
    Boolean(auth.refresh_token) &&
    expiresAt > 0 &&
    expiresAt - SAFETY_WINDOW_MS < Date.now();

  if (!needsRefresh) return auth as Record<string, unknown>;

  try {
    const fresh = await refreshConnectionToken(pieceName, auth);
    if (!fresh) return auth as Record<string, unknown>;

    const merged: StoredAuth = {
      ...auth,
      access_token: fresh.access_token,
      // Some vendors only return a refresh token on first consent — keep the old one then.
      refresh_token: fresh.refresh_token ?? auth.refresh_token,
      expires_at: Date.now() + Number(fresh.expires_in ?? 3600) * 1000,
      token_type: fresh.token_type ?? auth.token_type,
      ...(fresh.instance_url ? { instance_url: fresh.instance_url } : {}),
    };
    const buf = encryptJson(merged, orgId);
    await query(
      `UPDATE connections SET ciphertext = $1, encrypted_payload = $2, status = 'connected', updated_at = now()
       WHERE id = $3 AND org_id = $4`,
      [buf, JSON.stringify({ _enc: buf.toString("base64") }), connectionId, orgId],
    );
    return merged as Record<string, unknown>;
  } catch {
    // Refresh failed (revoked grant, expired refresh token, vendor outage):
    // flag the connection instead of poisoning the run with a doomed token.
    await query(
      `UPDATE connections SET status = 'needs_attention', updated_at = now() WHERE id = $1 AND org_id = $2`,
      [connectionId, orgId],
    ).catch(() => undefined);
    return auth as Record<string, unknown>;
  }
}

/** Exchange a refresh token for a new access token using the provider registry. */
export async function refreshConnectionToken(
  pieceName: string,
  auth: StoredAuth,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; instance_url?: string } | null> {
  const entry = Object.entries(OAUTH_PROVIDERS).find(([, c]) => c.appSlugs.includes(pieceName));
  if (!entry) return null;
  const [provider, config] = entry;
  if (!config.refreshable && provider !== "google") {
    // Only vendors we know rotate refresh tokens get proactive refresh;
    // everything else fails with the stored token and needs re-consent.
    if (!auth.refresh_token) return null;
  }
  if (!auth.refresh_token) return null;

  const clientId = process.env[`${config.envKey}_CLIENT_ID`] ?? "";
  const clientSecret = process.env[`${config.envKey}_CLIENT_SECRET`] ?? "";
  if (!clientId || !clientSecret) return null;

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (config.clientAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refresh_token,
  });
  if (config.clientAuth === "body") body.set("client_id", clientId), body.set("client_secret", clientSecret);

  const res = await fetch(config.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`${config.envKey} refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; instance_url?: string };
}

import { getApp } from "./catalog/catalog";
import { decryptJson, encryptJson } from "./crypto";
import { query, queryOne } from "./db";

/** A Google OAuth grant is deliberately shared by the Google pieces. The OAuth
 * flow requests the union of the supported Google scopes, so requiring users to
 * reconnect the same account once per Google product is both unnecessary and
 * the source of easily-misconfigured workflows. */
export const GOOGLE_APP_SLUGS = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

export function connectionsAreCompatible(stepAppSlug: string, connectionAppSlug: string) {
  return stepAppSlug === connectionAppSlug || (GOOGLE_APP_SLUGS.has(stepAppSlug) && GOOGLE_APP_SLUGS.has(connectionAppSlug));
}

async function connectionOrg(connectionId: string, workspaceId?: string) {
  const modern = workspaceId
    ? await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown; org_id: string }>(
        `select ciphertext, encrypted_payload, org_id from connections where id=$1 and org_id=$2`,
        [connectionId, workspaceId],
      )
    : await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown; org_id: string }>(
        `select ciphertext, encrypted_payload, org_id from connections where id=$1`,
        [connectionId],
      );
  if (modern) {
    return {
      encrypted_credentials: modern.ciphertext,
      encrypted_payload: modern.encrypted_payload,
      organization_id: modern.org_id,
    };
  }
  return null;
}

/** Zapier-style reusable app account: OAuth or API key, envelope-encrypted at rest. */
export async function loadConnectionAuth(
  connectionId: string | undefined | null,
  workspaceId?: string
): Promise<Record<string, unknown> | null> {
  if (!connectionId) return null;
  const row = await connectionOrg(connectionId, workspaceId);
  if (!row) return null;
  const orgId = (row as { organization_id: string }).organization_id;
  const cipher = (row as { encrypted_credentials?: Buffer | null }).encrypted_credentials;
  if (cipher) return decryptJson(cipher, orgId);
  const payload = (row as { encrypted_payload?: { _enc?: string } }).encrypted_payload;
  if (payload?._enc) return decryptJson(Buffer.from(payload._enc, "base64"), orgId);
  if (payload && typeof payload === "object" && !("_enc" in payload)) return payload as Record<string, unknown>;
  return null;
}

/** Resolve a selected connection, or reuse an active Google grant for legacy
 * drafts that were saved before Google accounts became shared across pieces. */
export async function loadCompatibleConnectionAuth(
  connectionId: string | undefined | null,
  workspaceId: string,
  appSlug: string
): Promise<{ connectionId: string | null; auth: Record<string, unknown> | null }> {
  if (connectionId) {
    const auth = await loadConnectionAuth(connectionId, workspaceId);
    // A published legacy flow can retain an account that has since been
    // deleted/reconnected. For Google only, recover by selecting another
    // active grant in the same workspace; never cross this boundary for a
    // different provider.
    if (auth || !GOOGLE_APP_SLUGS.has(appSlug)) return { connectionId, auth };
  }
  if (!GOOGLE_APP_SLUGS.has(appSlug)) return { connectionId: null, auth: null };
  const row = await queryOne<{ id: string }>(
    `select id from connections
     where org_id=$1 and status='active' and piece_name = any($2::text[])
     order by last_used_at desc nulls last, use_count desc, created_at asc limit 1`,
    [workspaceId, [...GOOGLE_APP_SLUGS]]
  );
  return row ? { connectionId: row.id, auth: await loadConnectionAuth(row.id, workspaceId) } : { connectionId: null, auth: null };
}

export async function persistConnectionAuth(
  connectionId: string | undefined,
  auth: Record<string, unknown>,
  workspaceId?: string
) {
  if (!connectionId) return;
  const row = await connectionOrg(connectionId, workspaceId);
  if (!row) return;
  const blob = encryptJson(auth, row.organization_id);
  await query(`update connections set ciphertext=$2, updated_at=now() where id=$1 and org_id=coalesce($3, org_id)`, [
    connectionId,
    blob,
    workspaceId ?? null
  ]);
}

export async function touchConnection(connectionId: string, workspaceId: string) {
  await query(
    `update connections set use_count = coalesce(use_count,0)+1, last_used_at=now(), updated_at=now()
     where id=$1 and org_id=$2`,
    [connectionId, workspaceId]
  );
}

/** Copilot may SELECT an existing connection but never CREATE one. */
export async function pickForCopilot(opts: {
  workspaceId: string;
  pieceName: string;
  userEmail?: string | null;
}) {
  const compatibleApps = GOOGLE_APP_SLUGS.has(opts.pieceName) ? [...GOOGLE_APP_SLUGS] : [opts.pieceName];
  let candidates = await query<{ id: string; name: string; use_count: number }>(
    `select id, label as name, coalesce(use_count,0) as use_count from connections
     where org_id=$1 and piece_name = any($2::text[]) and status='active'
     order by use_count desc, created_at asc`,
    [opts.workspaceId, compatibleApps]
  );
  if (!candidates.length) return { connectionId: null as string | null, needsHuman: true as const };
  const email = opts.userEmail?.toLowerCase();
  const byEmail = email ? candidates.find((c) => c.name.toLowerCase().includes(email)) : undefined;
  const chosen = byEmail ?? candidates[0];
  return { connectionId: chosen.id, label: chosen.name, needsHuman: false as const };
}

export async function nextConnectionName(workspaceId: string, appSlug: string, desired: string) {
  const rows = await query<{ name: string }>(
    `select label as name from connections where org_id=$1 and piece_name=$2`,
    [workspaceId, appSlug]
  );
  const used = new Set(rows.map((r) => r.name));
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired} #${n}`)) n += 1;
  return `${desired} #${n}`;
}

export function presentConnection(row: {
  id: string;
  app_slug: string;
  name: string;
  auth_type?: string;
  status: string;
  metadata?: unknown;
  created_at?: string;
  last_tested_at?: string | null;
  zap_count?: number | string | null;
}) {
  const app = getApp(row.app_slug);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    appSlug: row.app_slug,
    app_slug: row.app_slug,
    appName: app?.name ?? row.app_slug,
    appVersion: "1.0.0",
    authType: row.auth_type,
    auth_type: row.auth_type,
    createdAt: row.created_at,
    lastTestedAt: row.last_tested_at,
    metadata: row.metadata,
    zapCount: Number(row.zap_count ?? 0)
  };
}

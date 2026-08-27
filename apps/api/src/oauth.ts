import { Router } from "express";
import { env } from "./config";
import { encryptJson, randomToken } from "./crypto";
import { query, queryOne } from "./db";
import { authMiddleware, workspaceMiddleware } from "./auth";
import { nextConnectionName } from "./connections";

export const oauthRouter = Router();

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file"
].join(" ");
const GOOGLE_APP_SLUGS = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

oauthRouter.get("/google/start", authMiddleware, workspaceMiddleware, async (req, res) => {
  if (!req.user || !req.orgId) return res.status(401).json({ error: "unauthorized" });
  if (!env.google.clientId) return res.status(400).json({ error: "GOOGLE_CLIENT_ID is not set (MANUAL)" });
  const appSlug = String(req.query.appSlug ?? "gmail");
  if (!GOOGLE_APP_SLUGS.has(appSlug)) return res.status(400).json({ error: "unsupported_google_app" });
  const redirectTo = String(req.query.returnTo ?? "");
  if (redirectTo && (!redirectTo.startsWith("/") || redirectTo.startsWith("//"))) {
    return res.status(400).json({ error: "invalid_return_to" });
  }
  const state = randomToken(16);
  await query(
    `insert into oauth_states (state, user_id, org_id, app_slug, redirect_to, expires_at)
     values ($1,$2,$3,$4,$5, now() + interval '15 minutes')`,
    [state, req.user.userId, req.orgId, appSlug, redirectTo || null]
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.google.clientId);
  url.searchParams.set("redirect_uri", env.google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("state", state);
  res.json({ url: url.toString() });
});

oauthRouter.get("/google/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const row = await queryOne<{ user_id: string; org_id: string; app_slug: string; redirect_to: string | null }>(
    `select * from oauth_states where state=$1 and expires_at > now()`,
    [state]
  );
  if (!row || !code) return res.status(400).send("Invalid OAuth state. Retry Connect from the Apps page.");
  if (!env.google.clientSecret) return res.status(400).send("GOOGLE_CLIENT_SECRET is not set.");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.redirectUri,
      grant_type: "authorization_code"
    })
  });
  const tokens = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) return res.status(400).send(JSON.stringify(tokens));
  let accountLabel = `Google (${row.app_slug})`;
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${String(tokens.access_token ?? "")}` }
    });
    const profile = (await profileRes.json()) as { email?: string; name?: string };
    if (profile.email) accountLabel = profile.email;
    else if (profile.name) accountLabel = profile.name;
  } catch {
    /* keep default label */
  }
  const name = await nextConnectionName(row.org_id, row.app_slug, accountLabel);
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [row.org_id]);
  const buf = encryptJson({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
    token_type: tokens.token_type
  }, row.org_id);
  const connection = await queryOne<{ id: string }>(
    `insert into connections (org_id, project_id, piece_name, label, auth_type, status, ciphertext, encrypted_payload, owner_email, account_email)
     values ($1,$2,$3,$4,'oauth2','active',$5,$6,$7,$8) returning id`,
    [
      row.org_id,
      proj!.id,
      row.app_slug,
      name,
      buf,
      JSON.stringify({ _enc: buf.toString("base64") }),
      accountLabel,
      accountLabel
    ]
  );
  await query(`delete from oauth_states where state=$1`, [state]);
  const returnTo = row.redirect_to || `/connections?app=${encodeURIComponent(row.app_slug)}`;
  const complete = new URL("/connections/oauth-complete", env.appUrl);
  complete.searchParams.set("app", row.app_slug);
  complete.searchParams.set("connectionId", connection!.id);
  complete.searchParams.set("returnTo", returnTo);
  res.redirect(complete.toString());
});

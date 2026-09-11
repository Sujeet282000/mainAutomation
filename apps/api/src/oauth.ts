import { Router } from "express";
import { env } from "./config";
import { encryptJson, randomToken } from "./crypto";
import { query, queryOne } from "./db";
import { authMiddleware, workspaceMiddleware } from "./auth";
import { nextConnectionName } from "./connections";
import { getConnectionSetup } from "./catalog/app-connection-policy";
import { OAUTH_PROVIDERS, oauthProviderForApp, oauthProviderReady } from "./catalog/oauth-providers";

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

oauthRouter.get("/connection-setup/:appSlug", authMiddleware, workspaceMiddleware, async (req, res) => {
  const setup = getConnectionSetup(String(req.params.appSlug));
  if (!setup) return res.status(404).json({ error: "unknown_app" });
  res.json({ authSchema: setup });
});

oauthRouter.get("/google/start", authMiddleware, workspaceMiddleware, async (req, res) => {
  if (!req.user || !req.orgId) return res.status(401).json({ error: "unauthorized" });
  if (!env.google.clientId) return res.status(400).json({ error: "GOOGLE_CLIENT_ID is not set (MANUAL)" });
  const appSlug = String(req.query.appSlug ?? "gmail");
  if (!GOOGLE_APP_SLUGS.has(appSlug)) return res.status(400).json({ error: "unsupported_google_app" });
  const redirectTo = String(req.query.returnTo ?? "");
  if (redirectTo && (!redirectTo.startsWith("/") || redirectTo.startsWith("//"))) return res.status(400).json({ error: "invalid_return_to" });
  const state = randomToken(16);
  await query(`insert into oauth_states (state, user_id, org_id, app_slug, redirect_to, expires_at) values ($1,$2,$3,$4,$5, now() + interval '15 minutes')`, [state, req.user.userId, req.orgId, appSlug, redirectTo || null]);
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
  const row = await queryOne<{ user_id: string; org_id: string; app_slug: string; redirect_to: string | null }>(`select * from oauth_states where state=$1 and expires_at > now()`, [state]);
  if (!row || !code) return res.status(400).send("Invalid OAuth state. Retry Connect from the Apps page.");
  if (!env.google.clientSecret) return res.status(400).send("GOOGLE_CLIENT_SECRET is not set.");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.google.clientId, client_secret: env.google.clientSecret, redirect_uri: env.google.redirectUri, grant_type: "authorization_code" })
  });
  const tokens = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) return res.status(400).send(JSON.stringify(tokens));
  let accountLabel = `Google (${row.app_slug})`;
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${String(tokens.access_token ?? "")}` } });
    const profile = (await profileRes.json()) as { email?: string; name?: string };
    if (profile.email) accountLabel = profile.email;
    else if (profile.name) accountLabel = profile.name;
  } catch { /* keep default label */ }
  const name = await nextConnectionName(row.org_id, row.app_slug, accountLabel);
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [row.org_id]);
  const buf = encryptJson({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + Number(tokens.expires_in ?? 3600) * 1000, token_type: tokens.token_type }, row.org_id);
  const connection = await queryOne<{ id: string }>(`insert into connections (org_id, project_id, piece_name, label, auth_type, status, ciphertext, encrypted_payload, owner_email, account_email) values ($1,$2,$3,$4,'oauth2','active',$5,$6,$7,$8) returning id`, [row.org_id, proj!.id, row.app_slug, name, buf, JSON.stringify({ _enc: buf.toString("base64") }), accountLabel, accountLabel]);
  await query(`delete from oauth_states where state=$1`, [state]);
  const returnTo = row.redirect_to || `/connections?app=${encodeURIComponent(row.app_slug)}`;
  const complete = new URL("/connections/oauth-complete", env.appUrl);
  complete.searchParams.set("app", row.app_slug);
  complete.searchParams.set("connectionId", connection!.id);
  complete.searchParams.set("returnTo", returnTo);
  res.redirect(complete.toString());
});

// ── Generic OAuth2 flow (registry-driven) ────────────────────────────────────
// GET /oauth/:provider/start?appSlug=… → vendor consent screen
// GET /oauth/:provider/callback?code=…&state=… → encrypted connection stored
// Adding a provider is data in catalog/oauth-providers.ts, not new code.

oauthRouter.get("/:provider/start", authMiddleware, workspaceMiddleware, async (req, res) => {
  const provider = String(req.params.provider ?? "");
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return res.status(404).json({ error: "unknown_oauth_provider" });
  if (!oauthProviderReady(provider)) {
    return res.status(400).json({
      error: `${config.envKey}_CLIENT_ID / ${config.envKey}_CLIENT_SECRET are not set. Add them to .env, or connect with a token for now.`,
      envKeys: [`${config.envKey}_CLIENT_ID`, `${config.envKey}_CLIENT_SECRET`],
      docsUrl: config.docsUrl,
    });
  }

  const appSlug = String(req.query.appSlug ?? config.appSlugs[0]);
  if (!config.appSlugs.includes(appSlug)) return res.status(400).json({ error: "unsupported_app_for_provider" });
  if (!req.user || !req.orgId) return res.status(401).json({ error: "unauthorized" });
  const redirectTo = String(req.query.returnTo ?? "");
  if (redirectTo && (!redirectTo.startsWith("/") || redirectTo.startsWith("//"))) return res.status(400).json({ error: "invalid_return_to" });

  const clientId = process.env[`${config.envKey}_CLIENT_ID`]!;
  const redirectUri = process.env[config.redirectEnvKey ?? `${config.envKey}_REDIRECT_URI`] ??
    `${env.apiUrl.replace(/\/$/, "")}/api/v1/oauth/${provider}/callback`;

  const state = randomToken(16);
  await query(
    `insert into oauth_states (state, user_id, org_id, app_slug, redirect_to, expires_at) values ($1,$2,$3,$4,$5, now() + interval '15 minutes')`,
    [state, req.user.userId, req.orgId, appSlug, redirectTo || null],
  );

  const url = new URL(config.authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  const scope = [...config.scopes].join(config.authUrl.includes("microsoftonline") ? " " : " ");
  if (scope) url.searchParams.set("scope", scope);
  for (const [k, v] of Object.entries(config.authParams ?? {})) url.searchParams.set(k, v);

  res.json({ url: url.toString(), provider, appSlug });
});

oauthRouter.get("/:provider/callback", async (req, res) => {
  const provider = String(req.params.provider ?? "");
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return res.status(404).send("Unknown OAuth provider.");
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const row = await queryOne<{ user_id: string; org_id: string; app_slug: string; redirect_to: string | null }>(
    `select * from oauth_states where state=$1 and expires_at > now()`,
    [state],
  );
  if (!row || !code) return res.status(400).send("Invalid OAuth state. Retry Connect from the Apps page.");

  const clientId = process.env[`${config.envKey}_CLIENT_ID`] ?? "";
  const clientSecret = process.env[`${config.envKey}_CLIENT_SECRET`] ?? "";
  const redirectUri = process.env[config.redirectEnvKey ?? `${config.envKey}_REDIRECT_URI`] ??
    `${env.apiUrl.replace(/\/$/, "")}/api/v1/oauth/${provider}/callback`;

  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (config.clientAuth === "basic") headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (config.clientAuth === "body") body.set("client_id", clientId), body.set("client_secret", clientSecret);

  let tokens: Record<string, unknown>;
  try {
    const tokenRes = await fetch(config.tokenUrl, { method: "POST", headers, body });
    tokens = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) return res.status(400).send(`Token exchange failed: ${JSON.stringify(tokens).slice(0, 300)}`);
  } catch (err) {
    return res.status(502).send(`Token exchange error: ${err instanceof Error ? err.message : "network"}`);
  }

  // Best-effort account label for the connection name.
  let accountLabel = `${config.envKey.charAt(0) + config.envKey.slice(1).toLowerCase()} (${row.app_slug})`;
  const probeBearer = String(tokens.access_token ?? "");
  if (probeBearer) {
    try {
      const probes: Record<string, string> = {
        github: "https://api.github.com/user",
        pipedrive: "https://api.pipedrive.com/v1/users/me",
        todoist: "https://api.todoist.com/sync/v9/user",
      };
      const probeUrl = probes[provider];
      if (probeUrl) {
        const pr = await fetch(probeUrl, { headers: { authorization: `Bearer ${probeBearer}`, "user-agent": "orchestra" } });
        if (pr.ok) {
          const pj = (await pr.json()) as Record<string, unknown>;
          const userObj = pj.user as Record<string, unknown> | undefined;
          const name = pj.name ?? userObj?.name ?? userObj?.email;
          if (typeof name === "string" && name) accountLabel = name;
        }
      }
    } catch { /* keep default label */ }
  }

  const name = await nextConnectionName(row.org_id, row.app_slug, accountLabel);
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [row.org_id]);
  const tokenPayload = tokens as Record<string, unknown> & {
    team?: { name?: string };
  };
  const buf = encryptJson(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      token_type: tokens.token_type,
      scope: tokens.scope,
      ...(tokens.instance_url ? { instance_url: tokens.instance_url } : {}), // Salesforce
      ...(tokenPayload.team?.name ? { account_name: tokenPayload.team.name } : {}), // Slack-style payloads
    },
    row.org_id,
  );
  const connection = await queryOne<{ id: string }>(
    `insert into connections (org_id, project_id, piece_name, label, auth_type, status, ciphertext, encrypted_payload, owner_email, account_email)
     values ($1,$2,$3,$4,'oauth2','active',$5,$6,$7,$8) returning id`,
    [row.org_id, proj?.id ?? null, row.app_slug, name, buf, JSON.stringify({ _enc: buf.toString("base64") }), accountLabel, accountLabel],
  );
  await query(`delete from oauth_states where state=$1`, [state]);
  const returnTo = row.redirect_to || `/connections?app=${encodeURIComponent(row.app_slug)}`;
  const complete = new URL("/connections/oauth-complete", env.appUrl);
  complete.searchParams.set("app", row.app_slug);
  complete.searchParams.set("connectionId", connection!.id);
  complete.searchParams.set("returnTo", returnTo);
  res.redirect(complete.toString());
});

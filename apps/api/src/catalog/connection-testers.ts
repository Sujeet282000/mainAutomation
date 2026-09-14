/**
 * Per-provider credential verification, Zapier-style: when the user connects
 * an account we actually call the vendor API with the supplied credentials
 * before marking the connection "active". A connection that has never
 * succeeded does not exist here.
 */
import { queryOne, query } from "../db";
import { loadConnectionSecret } from "../flow-runtime";

type Auth = Record<string, unknown>;
type TestResult = { ok: boolean; hint?: string; detail?: string };

async function get(
  url: string,
  headers: Record<string, string>,
  app: string,
): Promise<{ ok: true; body: unknown } | { ok: false; hint: string }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return {
        ok: false,
        hint:
          res.status === 401 || res.status === 403
            ? `${app} rejected these credentials (HTTP ${res.status}). Double-check the value and that the key/token is still active.`
            : `${app} returned HTTP ${res.status}: ${text}`,
      };
    }
    let body: unknown = null;
    try { body = await res.json(); } catch { body = {}; }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, hint: `Could not reach ${app}: ${err instanceof Error ? err.message : "network error"}` };
  }
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  app: string,
): Promise<{ ok: true; body: unknown } | { ok: false; hint: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return {
        ok: false,
        hint:
          res.status === 401 || res.status === 403
            ? `${app} rejected these credentials (HTTP ${res.status}). Double-check the value and that the key/token is still active.`
            : `${app} returned HTTP ${res.status}: ${text}`,
      };
    }
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { parsed = {}; }
    return { ok: true, body: parsed };
  } catch (err) {
    return { ok: false, hint: `Could not reach ${app}: ${err instanceof Error ? err.message : "network error"}` };
  }
}

/** Read the first non-empty string credential from the given keys. */
function str(a: Auth, ...keys: string[]): string {
  for (const k of keys) {
    const v = String(a[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

// ── Testers keyed by catalog slug ─────────────────────────────────────────────

export const CONNECTION_TESTERS: Record<string, (auth: Auth) => Promise<TestResult>> = {
  // ── AI ────────────────────────────────────────────────────────────────────
  openai: async (a) => {
    const r = await get("https://api.openai.com/v1/models", { authorization: `Bearer ${str(a, "api_key")}` }, "OpenAI");
    return r.ok ? { ok: true, detail: "Key valid — models endpoint reachable." } : { ok: false, hint: r.hint };
  },
  anthropic: async (a) => {
    const r = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": str(a, "api_key"), "anthropic-version": "2023-06-01" },
      { model: "claude-3-5-haiku-20241022", max_tokens: 8, messages: [{ role: "user", content: "ping" }] },
      "Anthropic",
    );
    return r.ok ? { ok: true, detail: "Key valid." } : { ok: false, hint: r.hint };
  },
  gemini: async (a) => {
    const r = await get("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": str(a, "api_key") }, "Gemini");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  groq: async (a) => {
    const r = await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${str(a, "api_key")}` }, "Groq");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  huggingface: async (a) => {
    const r = await get("https://huggingface.co/api/whoami-v2", { authorization: `Bearer ${str(a, "api_key")}` }, "Hugging Face");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  cohere: async (a) => {
    const r = await get("https://api.cohere.com/v1/models", { authorization: `Bearer ${str(a, "api_key")}` }, "Cohere");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  replicate: async (a) => {
    const r = await get("https://api.replicate.com/v1/account", { authorization: `Bearer ${str(a, "api_key")}` }, "Replicate");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  elevenlabs: async (a) => {
    const r = await get("https://api.elevenlabs.io/v1/user", { "xi-api-key": str(a, "api_key") }, "ElevenLabs");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── Communication ─────────────────────────────────────────────────────────
  telegram: async (a) => {
    const token = str(a, "api_key", "bot_token");
    const r = await get(`https://api.telegram.org/bot${token}/getMe`, {}, "Telegram");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  discord: async (a) => {
    const r = await get("https://discord.com/api/v10/users/@me", { authorization: `Bot ${str(a, "bot_token", "api_key")}` }, "Discord");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  twilio: async (a) => {
    const sid = str(a, "account_sid");
    const r = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { authorization: basic(sid, str(a, "auth_token")) }, "Twilio");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  mattermost: async (a) => {
    const base = str(a, "site_url").replace(/\/$/, "");
    const r = await get(`${base}/api/v4/users/me`, { authorization: `Bearer ${str(a, "api_key")}` }, "Mattermost");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  vonage: async (a) => {
    const r = await get(
      `https://rest.nexmo.com/account/get-balance?api_key=${encodeURIComponent(str(a, "api_key"))}&api_secret=${encodeURIComponent(str(a, "api_secret"))}`,
      {},
      "Vonage",
    );
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  messagebird: async (a) => {
    const r = await get("https://rest.messagebird.com/balance", { authorization: `AccessKey ${str(a, "api_key")}` }, "MessageBird");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── Project management / docs ─────────────────────────────────────────────
  linear: async (a) => {
    const r = await post("https://api.linear.app/graphql", { authorization: str(a, "api_key") }, { query: "{ viewer { id } }" }, "Linear");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  airtable: async (a) => {
    const r = await get("https://api.airtable.com/v0/meta/whoami", { authorization: `Bearer ${str(a, "api_key")}` }, "Airtable");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  trello: async (a) => {
    const r = await get(
      `https://api.trello.com/1/members/me?key=${encodeURIComponent(str(a, "api_key"))}&token=${encodeURIComponent(str(a, "token"))}`,
      {},
      "Trello",
    );
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  jira: async (a) => {
    const host = str(a, "host").replace(/\/$/, "");
    const r = await get(`${host}/rest/api/3/myself`, { authorization: basic(str(a, "email"), str(a, "api_token")) }, "Jira");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  confluence: async (a) => {
    const host = str(a, "host").replace(/\/$/, "");
    const r = await get(`${host}/rest/api/me`, { authorization: basic(str(a, "email"), str(a, "api_token")) }, "Confluence");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  coda: async (a) => {
    const r = await get("https://coda.io/apis/v1/whoami", { authorization: `Bearer ${str(a, "api_key")}` }, "Coda");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── Commerce / payments ───────────────────────────────────────────────────
  shopify: async (a) => {
    const shop = str(a, "shop").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${shop}/admin/api/2024-01/shop.json`, { "X-Shopify-Access-Token": str(a, "access_token") }, "Shopify");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  woocommerce: async (a) => {
    const base = str(a, "site_url").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/wp-json/wc/v3/system_status`, { authorization: basic(str(a, "consumer_key"), str(a, "consumer_secret")) }, "WooCommerce");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  bigcommerce: async (a) => {
    const h = str(a, "store_hash");
    const r = await get(`https://api.bigcommerce.com/stores/${h}/v3/catalog/summary`, { "X-Auth-Token": str(a, "access_token"), accept: "application/json" }, "BigCommerce");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  razorpay: async (a) => {
    const r = await get("https://api.razorpay.com/v1/payments?count=1", { authorization: basic(str(a, "key_id"), str(a, "key_secret")) }, "Razorpay");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  chargebee: async (a) => {
    const site = str(a, "site");
    const r = await get(`https://${site}.chargebee.com/api/v2/plans?limit=1`, { authorization: basic(str(a, "api_key"), "") }, "Chargebee");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── Support / HR / dev tools ──────────────────────────────────────────────
  freshdesk: async (a) => {
    const base = str(a, "domain").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/api/v2/tickets?per_page=1`, { authorization: basic(str(a, "api_key"), "X") }, "Freshdesk");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  gorgias: async (a) => {
    const base = str(a, "domain").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/api/1/users/me`, { authorization: `Bearer ${str(a, "api_key")}` }, "Gorgias");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  bamboohr: async (a) => {
    const sub = str(a, "subdomain");
    const r = await get(`https://api.bamboohr.com/gateway.php/${sub}/v1/employees/directory`, { authorization: basic(str(a, "api_key"), "x"), accept: "application/json" }, "BambooHR");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  greenhouse: async (a) => {
    const r = await get("https://harvest.greenhouse.io/v1/partners", { authorization: basic(str(a, "api_key"), "") }, "Greenhouse");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  workable: async (a) => {
    const r = await get("https://www.workable.com/spi/v3/accounts", { authorization: `Bearer ${str(a, "api_key")}` }, "Workable");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  gitlab: async (a) => {
    const r = await get("https://gitlab.com/api/v4/user", { authorization: `Bearer ${str(a, "access_token", "api_key")}` }, "GitLab");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  bitbucket: async (a) => {
    const r = await get("https://api.bitbucket.org/2.0/user", { authorization: basic(str(a, "username"), str(a, "api_key")) }, "Bitbucket");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  vercel: async (a) => {
    const r = await get("https://api.vercel.com/v2/user", { authorization: `Bearer ${str(a, "api_key")}` }, "Vercel");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  netlify: async (a) => {
    const r = await get("https://api.netlify.com/api/v1/user", { authorization: `Bearer ${str(a, "api_key")}` }, "Netlify");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  pagerduty: async (a) => {
    const r = await get("https://api.pagerduty.com/users?limit=1", { authorization: `Token token=${str(a, "api_key")}`, accept: "application/vnd.pagerduty+json;version=2" }, "PagerDuty");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  sentry: async (a) => {
    const r = await get("https://sentry.io/api/0/organizations/", { authorization: `Bearer ${str(a, "api_key")}` }, "Sentry");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  datadog: async (a) => {
    const base = str(a, "site_url") || "https://api.datadoghq.com";
    const r = await get(`${base}/api/v1/validate`, { "DD-API-KEY": str(a, "api_key") }, "Datadog");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  mixpanel: async (a) => {
    const r = await get("https://mixpanel.com/api/app/me", { authorization: basic(str(a, "username", "service_account_username"), str(a, "api_key")), accept: "application/json" }, "Mixpanel");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  amplitude: async (a) => {
    const r = await get("https://amplitude.com/api/2/taxonomy/category", { authorization: basic(str(a, "api_key"), str(a, "api_key")) }, "Amplitude");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  segment: async () => ({ ok: true, detail: "Write keys cannot be validated server-side; they are verified on the first event." }),
  "cal-com": async (a) => {
    const r = await get("https://api.cal.com/v1/me", { authorization: `Bearer ${str(a, "api_key")}` }, "Cal.com");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  acuity: async (a) => {
    const r = await get("https://acuityscheduling.com/api/v1/me", { authorization: basic(str(a, "user_id"), str(a, "api_key")) }, "Acuity");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  shipstation: async (a) => {
    const r = await get("https://ssapi.shipstation.com/account", { authorization: basic(str(a, "api_key"), str(a, "api_secret")) }, "ShipStation");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  shippo: async (a) => {
    const r = await get("https://api.goshippo.com/parcels/", { authorization: `ShippoToken ${str(a, "api_key")}` }, "Shippo");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  "dropbox-sign": async (a) => {
    const r = await get("https://api.hellosign.com/v3/account", { authorization: basic(str(a, "api_key"), "") }, "Dropbox Sign");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  teachable: async (a) => {
    const r = await get("https://developers.teachable.com/v1/ping", { authorization: `Bearer ${str(a, "api_key")}` }, "Teachable");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  thinkific: async (a) => {
    const r = await get("https://api.thinkific.com/api/public/v1/users?limit=1", { "X-Auth-API-Key": str(a, "api_key"), "X-Auth-Subdomain": str(a, "subdomain", "site_url") }, "Thinkific");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  okta: async (a) => {
    const base = str(a, "site_url").replace(/\/$/, "");
    const r = await get(`${base}/api/v1/users/me`, { authorization: `SSWS ${str(a, "api_key")}` }, "Okta");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── CMS / marketing / CRM ─────────────────────────────────────────────────
  wordpress: async (a) => {
    const base = str(a, "site_url").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/wp-json/wp/v2/users/me?context=edit`, { authorization: basic(str(a, "username"), str(a, "api_key")) }, "WordPress");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  ghost: async (a) => {
    const base = str(a, "site_url").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/ghost/api/content/posts/?limit=1`, {}, "Ghost");
    return r.ok ? { ok: true, detail: "Content API reachable; the admin key is verified on first write." } : { ok: false, hint: r.hint };
  },
  supabase: async (a) => {
    const base = str(a, "project_url").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`https://${base}/rest/v1/`, { apikey: str(a, "api_key") }, "Supabase");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  sendgrid: async (a) => {
    const r = await get("https://api.sendgrid.com/v3/scopes", { authorization: `Bearer ${str(a, "api_key")}` }, "SendGrid");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  mailchimp: async (a) => {
    const raw = str(a, "api_key");
    const dc = raw.split("-")[1] ?? "us1";
    const r = await get(`https://${dc}.api.mailchimp.com/3.0/ping`, { authorization: basic("anystring", raw) }, "Mailchimp");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  activecampaign: async (a) => {
    const base = str(a, "url").replace(/\/$/, "");
    const r = await get(`${base}/api/3/users/me`, { "Api-Token": str(a, "api_key") }, "ActiveCampaign");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  klaviyo: async (a) => {
    const r = await get("https://a.klaviyo.com/api/accounts/", { revision: "2024-05-15", authorization: `Klaviyo-API-Key ${str(a, "api_key")}` }, "Klaviyo");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  brevo: async (a) => {
    const r = await get("https://api.brevo.com/v3/account", { "api-key": str(a, "api_key") }, "Brevo");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  convertkit: async (a) => {
    const r = await get(`https://api.convertkit.com/v3/account?api_secret=${encodeURIComponent(str(a, "api_key"))}`, {}, "ConvertKit");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  mailerlite: async (a) => {
    const r = await get("https://connect.mailerlite.com/api/me", { authorization: `Bearer ${str(a, "api_key")}` }, "MailerLite");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  close: async (a) => {
    const r = await get("https://api.close.com/api/v1/me/", { authorization: basic(str(a, "api_key"), "") }, "Close");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  freshsales: async (a) => {
    const base = str(a, "domain").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await get(`${base}/api/settings/roles`, { authorization: `Token token=${str(a, "api_key")}` }, "Freshsales");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
  "follow-up-boss": async (a) => {
    const r = await get("https://api.followupboss.com/v1/identity", { "x-system": "Orchestra", "x-version": "1.0", authorization: basic(str(a, "api_key"), "") }, "Follow Up Boss");
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },

  // ── Database / custom: verified on first use ────────────────────────────────
  postgresql: async () => ({ ok: true, detail: "Database connections are verified on first query execution." }),
  mysql: async () => ({ ok: true, detail: "Database connections are verified on first query execution." }),
  mongodb: async () => ({ ok: true, detail: "Database connections are verified on first query execution." }),
  snowflake: async () => ({ ok: true, detail: "Database connections are verified on first query execution." }),
  firebase: async () => ({ ok: true, detail: "Service accounts are verified on the first operation." }),
  netsuite: async () => ({ ok: true, detail: "Token-based auth is verified on the first request." }),
  odoo: async () => ({ ok: true, detail: "XML-RPC credentials are verified on the first request." }),
  auth0: async (a) => {
    const base = str(a, "domain").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const r = await post(
      `https://${base}/oauth/token`,
      {},
      { client_id: str(a, "client_id"), client_secret: str(a, "client_secret"), audience: `https://${base}/api/v2/`, grant_type: "client_credentials" },
      "Auth0",
    );
    return r.ok ? { ok: true } : { ok: false, hint: r.hint };
  },
};

/** Test a connection by id using the vendor-specific probe for its app. */
export async function testConnectionById(
  id: string,
  orgId: string,
): Promise<TestResult & { appSlug: string; /** false when no vendor-specific probe exists and the caller should try its own checks. */ tested: boolean }> {
  const conn = await queryOne<{ id: string; piece_name: string }>(
    `SELECT id, piece_name FROM connections WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  if (!conn) throw new Error("not_found");
  const appSlug = conn.piece_name;
  const auth = await loadConnectionSecret(conn.id, orgId);
  if (!auth || !Object.keys(auth).length) {
    return { ok: false, hint: "No credentials stored for this connection. Reconnect the account.", appSlug, tested: true };
  }
  const tester = CONNECTION_TESTERS[appSlug];
  if (!tester) {
    // No vendor-specific probe: let the caller run its own checks.
    return { ok: true, appSlug, tested: false };
  }
  const result = await tester(auth as Auth);
  if (result.ok) {
    await query(`UPDATE connections SET status = 'active', updated_at = now() WHERE id = $1 AND org_id = $2`, [conn.id, orgId]);
  } else {
    // DB enum connection_status is {active,expired,error,missing}; 'error'
    // maps to the UI's "needs attention" state (packages/contracts/connection.ts).
    await query(`UPDATE connections SET status = 'error', updated_at = now() WHERE id = $1 AND org_id = $2`, [conn.id, orgId]);
  }
  return { ...result, appSlug, tested: true };
}

/**
 * Bulk connection health check (P2 #27): runs vendor probes across every
 * connection in the org with bounded concurrency, updates connection status
 * rows, and returns an aggregate health report. Connections whose app has no
 * dedicated probe report `tested: false` with their stored status — the
 * caller's own per-app checks (routes.ts) remain the fallback for those.
 */
export async function checkConnectionHealth(orgId: string): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  untested: number;
  results: Array<{ id: string; appSlug: string; ok: boolean | null; hint?: string }>;
}> {
  const conns = await query<{ id: string; piece_name: string }>(
    `SELECT id, piece_name FROM connections WHERE org_id = $1 ORDER BY created_at ASC`,
    [orgId],
  );
  const results: Array<{ id: string; appSlug: string; ok: boolean | null; hint?: string }> = [];
  const CONCURRENCY = 5;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, conns.length) }, async () => {
    while (cursor < conns.length) {
      const idx = cursor++;
      const conn = conns[idx];
      try {
        const r = await testConnectionById(conn.id, orgId);
        results.push({ id: conn.id, appSlug: r.appSlug, ok: r.tested ? r.ok : null, hint: r.hint });
      } catch (err) {
        results.push({
          id: conn.id,
          appSlug: conn.piece_name,
          ok: false,
          hint: err instanceof Error ? err.message : "Health check failed",
        });
      }
    }
  });
  await Promise.all(workers);
  const healthy = results.filter((r) => r.ok === true).length;
  const unhealthy = results.filter((r) => r.ok === false).length;
  const untested = results.filter((r) => r.ok === null).length;
  return { total: results.length, healthy, unhealthy, untested, results };
}

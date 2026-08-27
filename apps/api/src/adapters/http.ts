const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "169.254.169.254"]);

function isPrivateIp(hostname: string) {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  if (hostname === "::1" || hostname.endsWith(".localhost")) return true;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL protocol not allowed");
  if (isPrivateIp(url.hostname)) throw new Error("SSRF_BLOCKED: private or loopback address");
  return url;
}

export async function httpRequest(input: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const method = String(input.method ?? "GET").toUpperCase();
  const url = assertPublicUrl(String(input.url));
  const query = (input.query as Record<string, string> | undefined) ?? {};
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const headers = { ...(input.headers as Record<string, string> | undefined), ...extraHeaders };
  if (input.idempotencyKey && !headers["X-Idempotency-Key"] && !headers["x-idempotency-key"]) {
    headers["X-Idempotency-Key"] = String(input.idempotencyKey);
  }
  const timeoutMs = Number(input.timeoutMs ?? 15000);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(input.body ?? {}),
      signal: controller.signal
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* raw */
    }
    return {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      body: json
    };
  } finally {
    clearTimeout(t);
  }
}

export function authHeaders(auth: Record<string, unknown> | null): Record<string, string> {
  if (!auth) return {};
  if (auth.access_token) return { authorization: `Bearer ${auth.access_token}` };
  if (auth.api_key && auth.header) return { [String(auth.header)]: String(auth.api_key) };
  if (auth.api_key) return { authorization: `Bearer ${auth.api_key}` };
  if (auth.username && auth.password) {
    const basic = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    return { authorization: `Basic ${basic}` };
  }
  return {};
}

export async function requireOk(res: Response, label: string) {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body as Record<string, unknown>;
}


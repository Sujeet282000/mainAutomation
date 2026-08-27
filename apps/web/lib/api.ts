export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getWorkspaceId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("workspaceId");
}

export function setSession(token: string, workspaceId?: string | null) {
  localStorage.setItem("token", token);
  if (workspaceId) localStorage.setItem("workspaceId", workspaceId);
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("workspaceId");
}

export async function streamSse(
  path: string,
  body: unknown,
  onEvent: (data: Record<string, unknown>) => void,
  signal?: AbortSignal
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  const workspaceId = getWorkspaceId();
  if (token) headers.authorization = `Bearer ${token}`;
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`Cannot reach the Orchestra API at ${API_URL}. Start the API on port 4000 and retry.`);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const payload = data as { hint?: string; error?: string; message?: string };
    throw new Error(payload.hint ?? payload.message ?? payload.error ?? res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const consume = (chunk: string) => {
    const line = chunk.split("\n").find((row) => row.startsWith("data: "));
    if (!line) return;
    try {
      onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
    } catch {
      /* ignore malformed event */
    }
  };
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) consume(chunk);
  }
  if (buf.trim()) consume(buf);
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined)
  };
  const token = getToken();
  const workspaceId = getWorkspaceId();
  if (token) headers.authorization = `Bearer ${token}`;
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new Error(`Cannot reach the Orchestra API at ${API_URL}. Start the API on port 4000 and retry.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      clearSession();
      if (!window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
        window.location.href = "/login";
      }
    }
    throw new Error(data.hint ?? data.message ?? data.error ?? res.statusText);
  }
  return data as T;
}

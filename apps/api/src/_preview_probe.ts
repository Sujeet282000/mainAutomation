import fs from "node:fs";

const API = "http://127.0.0.1:4000/api/v1";

async function req(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, json };
}

async function main() {
  const out: Record<string, unknown> = {};
  out.loginAdmin = await req("POST", "/auth/login", { email: "admin@algoverge.local", password: "ChangeMe123!" });
  out.loginBuilder = await req("POST", "/auth/login", { email: "builder@orchestra.local", password: "ChangeMe123!" });
  const email = `preview${Date.now()}@orchestra.local`;
  out.register = await req("POST", "/auth/register", { email, password: "ChangeMe123!", name: "Preview User" });
  const token =
    (out.register as { json?: { token?: string } }).json?.token ||
    (out.loginAdmin as { json?: { token?: string } }).json?.token ||
    (out.loginBuilder as { json?: { token?: string } }).json?.token;
  out.tokenPresent = Boolean(token);
  if (token) {
    out.me = await req("GET", "/me", undefined, token);
    out.automations = await req("GET", "/automations", undefined, token);
    out.executions = await req("GET", "/executions", undefined, token);
    out.billing = await req("GET", "/billing", undefined, token);
    out.templates = await req("GET", "/templates", undefined, token);
    out.apps = await req("GET", "/apps", undefined, token);
    out.connections = await req("GET", "/connections", undefined, token);
    out.copilotStatus = await req("GET", "/copilot/status", undefined, token);
    const session = await req(
      "POST",
      "/copilot/sessions",
      { prompt: "When a Gmail arrives, send a Slack message", mode: "auto_build" },
      token,
    );
    out.session = session;
    const sid = (session.json as { sessionId?: string })?.sessionId;
    if (sid) {
      const gen = await fetch(`${API}/copilot/sessions/${sid}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: "When a Gmail arrives, send a Slack message", mode: "auto_build" }),
      });
      const raw = await gen.text();
      const events = raw.split("\n\n").filter((c) => c.includes("data: "));
      const resultLine = [...events].reverse().find((c) => c.includes('"type": "result"') || c.includes('"type":"result"'));
      out.generateStatus = gen.status;
      out.generateEventCount = events.length;
      out.generateTail = raw.slice(-800);
      let graph: unknown;
      if (resultLine) {
        const data = resultLine.split("\n").find((l) => l.startsWith("data: "));
        if (data) {
          const parsed = JSON.parse(data.slice(6)) as { graph?: unknown };
          graph = parsed.graph;
        }
      }
      const created = await req(
        "POST",
        "/automations",
        { name: "Gmail to Slack preview", origin: "copilot", graph },
        token,
      );
      out.createdAutomation = created;
      out.useTemplate = await req("POST", "/templates/gmail-sheets/use", { name: "From template" }, token);
      const autoId = (created.json as { automation?: { id: string } })?.automation?.id;
      if (autoId) {
        out.getAuto = await req("GET", `/automations/${autoId}`, undefined, token);
        out.run = await req("POST", `/automations/${autoId}/run`, { payload: { from: "a@b.com", subject: "hi" } }, token);
      }
    }
  }
  fs.writeFileSync("C:/Users/admin/Pictures/atuomate/.freebuff/preview-api.json", JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        tokenPresent: out.tokenPresent,
        loginAdmin: (out.loginAdmin as { status: number }).status,
        register: (out.register as { status: number }).status,
        auto: (out.automations as { status?: number })?.status,
        exec: (out.executions as { status?: number })?.status,
        billing: (out.billing as { status?: number })?.status,
        copilot: (out.copilotStatus as { status?: number })?.status,
        gen: out.generateStatus,
        events: out.generateEventCount,
        created: (out.createdAutomation as { status?: number })?.status,
        tpl: (out.useTemplate as { status?: number })?.status,
        run: (out.run as { status?: number })?.status,
        autoErr: (out.automations as { json?: unknown })?.json,
        execErr: (out.executions as { json?: unknown })?.json,
        copilotJson: (out.copilotStatus as { json?: unknown })?.json,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

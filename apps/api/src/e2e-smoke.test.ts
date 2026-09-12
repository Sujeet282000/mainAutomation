/**
 * End-to-end smoke test — walks the full product flow against a RUNNING API:
 *
 *   register → create automation → publish → trigger registration
 *   → run (manual + webhook) → inspect execution
 *
 * Requires the API on :4000 (npm run dev) and migrations applied.
 * Run: npm run test:e2e -w @algoverge/api   (or npm run test:e2e at the root)
 */
import assert from "node:assert/strict";
import test from "node:test";

const BASE = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

function auth(token: string, workspaceId: string) {
  return { Authorization: `Bearer ${token}`, "x-workspace-id": workspaceId };
}

async function waitFor(
  fn: () => Promise<boolean>,
  { timeoutMs = 15_000, everyMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

test("E2E: register → create → publish → trigger registration → run → execution", { timeout: 60_000 }, async () => {
  // ── 1. Register a fresh user ────────────────────────────────────────────
  const email = `e2e-smoke-${Date.now()}@test.local`;
  const reg = await api("POST", "/api/v1/auth/register", {
    email,
    password: "SmokeTest123!",
    name: "E2E Smoke",
  });
  assert.equal(reg.status, 200, `register failed: ${JSON.stringify(reg.json)}`);
  const token = reg.json?.token as string;
  const workspaceId = (reg.json?.workspace?.id ?? reg.json?.workspaces?.[0]?.id) as string;
  assert.ok(token, "register must return a token");
  assert.ok(workspaceId, "register must return a workspace id");
  const h = auth(token, workspaceId);

  // ── 2. Create an automation with a webhook trigger + http action ───────
  const create = await api("POST", "/api/v1/automations", {
    name: `Smoke Flow ${Date.now()}`,
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          appSlug: "webhook",
          operation: "catch_hook",
          label: "Webhook Trigger",
          position: { x: 280, y: 40 },
          config: {},
          connectionId: null,
        },
        {
          id: "notify",
          type: "action",
          appSlug: "http",
          operation: "request",
          label: "HTTP Request",
          position: { x: 280, y: 220 },
          config: { method: "GET", url: "https://httpbin.org/status/200" },
          connectionId: null,
        },
      ],
      edges: [{ id: "e-trigger-notify", source: "trigger", target: "notify" }],
    },
  }, h);
  assert.equal(create.status, 200, `create failed: ${JSON.stringify(create.json)}`);
  const flowId = (create.json?.automation?.id ?? create.json?.id) as string;
  assert.ok(flowId, "create must return an automation id");

  // ── 3. Publish — should create a version AND register the trigger ─────
  const publish = await api("POST", `/api/v1/automations/${flowId}/publish`, {}, h);
  assert.equal(publish.status, 200, `publish failed: ${JSON.stringify(publish.json)}`);
  assert.equal(publish.json?.ok, true);
  assert.ok(publish.json?.versionId, "publish must return a versionId");
  // Webhook trigger registration returns a Catch URL
  const webhookUrl = publish.json?.webhookUrl as string | null;
  assert.ok(webhookUrl, "publish of a webhook-triggered flow must return webhookUrl");
  assert.ok(webhookUrl.includes("/webhooks/inbound/"), "webhookUrl must point at the inbound ingress");

  // ── 4. Automation now shows as live with its webhook ───────────────────
  const got = await api("GET", `/api/v1/automations/${flowId}`, undefined, h);
  assert.equal(got.status, 200);
  const automation = got.json?.automation as Record<string, unknown> | undefined;
  assert.equal(automation?.status, "on", "published automation must be live");
  assert.ok(automation?.webhook_public_id, "published automation must expose its webhook id");

  // ── 5a. Manual run ─────────────────────────────────────────────────────
  const run = await api("POST", `/api/v1/automations/${flowId}/run`, { payload: { source: "smoke-manual" } }, h);
  assert.equal(run.status, 200, `manual run failed: ${JSON.stringify(run.json)}`);
  const manualExecId = (run.json?.execution?.id ?? run.json?.id) as string;
  assert.ok(manualExecId, "run must return an execution id");

  // ── 5b. Webhook run (fire the Catch URL) ───────────────────────────────
  const hookRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-id": `smoke-${Date.now()}` },
    body: JSON.stringify({ source: "smoke-webhook", value: 42 }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(hookRes.status === 200 || hookRes.status === 202, `webhook ingress failed: ${hookRes.status}`);

  // ── 6. Executions appear and the manual run reaches a terminal state ──
  const sawRuns = await waitFor(async () => {
    const list = await api("GET", "/api/v1/executions", undefined, h);
    const execs = (list.json?.executions ?? []) as Array<Record<string, unknown>>;
    return execs.some((e) => e.automation_id === flowId || e.id === manualExecId);
  });
  assert.ok(sawRuns, "runs for the flow must appear in /executions");

  const reachedTerminal = await waitFor(async () => {
    const detail = await api("GET", `/api/v1/executions/${manualExecId}`, undefined, h);
    const ex = (detail.json?.execution ?? detail.json) as Record<string, unknown> | undefined;
    const status = String(ex?.status ?? "");
    return status === "succeeded" || status === "failed";
  });
  assert.ok(reachedTerminal, "manual run must reach a terminal state");

  // ── 7. Inspect the execution detail (steps recorded) ───────────────────
  const detail = await api("GET", `/api/v1/executions/${manualExecId}`, undefined, h);
  assert.equal(detail.status, 200, `execution detail failed: ${JSON.stringify(detail.json)}`);
  const ex = (detail.json?.execution ?? detail.json) as Record<string, unknown>;
  assert.equal(ex.id, manualExecId);
  const steps = (detail.json?.steps ?? []) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(steps), "execution detail must include steps");
  assert.ok(steps.length > 0, "at least the trigger step must be recorded");

  // Analytics summary endpoint reflects the runs
  const summary = await api("GET", "/api/v1/analytics/summary?days=14", undefined, h);
  assert.equal(summary.status, 200, `analytics summary failed: ${JSON.stringify(summary.json)}`);
  assert.ok(Array.isArray(summary.json?.daily), "summary must include daily series");
});

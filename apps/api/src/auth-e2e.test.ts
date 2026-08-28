import assert from "node:assert/strict";
import test from "node:test";

const BASE = process.env.API_URL ?? "http://localhost:4000";

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
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

// ──────────────────────────────────────────────────────────────────────────────
// Register
// ──────────────────────────────────────────────────────────────────────────────
test("POST /api/v1/auth/register creates a new user and returns token", async () => {
  const email = `e2e-register-${Date.now()}@test.local`;
  const { status, json } = await api("POST", "/api/v1/auth/register", {
    email,
    password: "TestPass123!",
    name: "E2E Test User",
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.ok(json?.token, "response must include a JWT token");
  assert.equal(json?.user?.email, email);
  assert.ok(json?.organization, "response must include organization");
  assert.ok(json?.workspace, "response must include workspace");
  assert.ok(json?.workspaces, "response must include workspaces array");
});

test("POST /api/v1/auth/register rejects duplicate email", async () => {
  const email = `e2e-dup-${Date.now()}@test.local`;
  // First registration succeeds
  await api("POST", "/api/v1/auth/register", {
    email,
    password: "TestPass123!",
    name: "Dup User",
  });
  // Second registration fails
  const { status, json } = await api("POST", "/api/v1/auth/register", {
    email,
    password: "TestPass123!",
    name: "Dup User Again",
  });
  assert.equal(status, 409, `expected 409, got ${status}`);
  assert.equal((json as any)?.error, "email_taken");
});

test("POST /api/v1/auth/register rejects invalid input", async () => {
  const { status } = await api("POST", "/api/v1/auth/register", {
    email: "not-an-email",
    password: "short",
    name: "",
  });
  assert.equal(status, 400, "invalid input should return 400");
});

// ──────────────────────────────────────────────────────────────────────────────
// Login
// ──────────────────────────────────────────────────────────────────────────────
test("POST /api/v1/auth/login returns token for valid credentials", async () => {
  const { status, json } = await api("POST", "/api/v1/auth/login", {
    email: "admin@orchestra.ai",
    password: "Orchestra123!",
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.ok(json?.token, "response must include a JWT token");
  assert.equal(json?.user?.email, "admin@orchestra.ai");
  assert.ok(json?.organization, "response must include organization");
});

test("POST /api/v1/auth/login rejects wrong password", async () => {
  const { status, json } = await api("POST", "/api/v1/auth/login", {
    email: "admin@orchestra.ai",
    password: "WrongPassword999!",
  });
  assert.equal(status, 401, `expected 401, got ${status}`);
  assert.ok((json as any)?.error, "response must include error field");
});

test("POST /api/v1/auth/login rejects non-existent user", async () => {
  const { status } = await api("POST", "/api/v1/auth/login", {
    email: "nonexistent-nobody-12345@test.local",
    password: "DoesNotMatter!",
  });
  assert.equal(status, 401, "non-existent user should return 401");
});

// ──────────────────────────────────────────────────────────────────────────────
// Authenticated access (dashboard API)
// ──────────────────────────────────────────────────────────────────────────────
function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function loginAsAdmin() {
  const { json } = await api("POST", "/api/v1/auth/login", {
    email: "admin@orchestra.ai",
    password: "Orchestra123!",
  });
  return (json as any).token as string;
}

test("GET /api/v1/me returns current user with valid token", async () => {
  const token = await loginAsAdmin();
  const { status, json } = await api("GET", "/api/v1/me", undefined, authHeader(token));
  assert.equal(status, 200, `expected 200, got ${status}`);
  assert.equal((json as any)?.user?.email, "admin@orchestra.ai");
});

test("GET /api/v1/me rejects request without token", async () => {
  const { status } = await api("GET", "/api/v1/me");
  assert.ok(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

test("GET /api/v1/me rejects request with invalid token", async () => {
  const { status } = await api("GET", "/api/v1/me", undefined, {
    Authorization: "Bearer invalid-garbage-token",
  });
  assert.ok(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

test("GET /api/v1/automations returns empty list for fresh workspace", async () => {
  const token = await loginAsAdmin();
  const { status, json } = await api("GET", "/api/v1/automations", undefined, authHeader(token));
  assert.equal(status, 200, `expected 200, got ${status}`);
  assert.ok(Array.isArray((json as any)?.automations), "response must include automations array");
});

test("GET /api/v1/apps returns catalog apps", async () => {
  const token = await loginAsAdmin();
  const { status, json } = await api("GET", "/api/v1/apps", undefined, authHeader(token));
  assert.equal(status, 200, `expected 200, got ${status}`);
  const apps = (json as any)?.apps ?? json;
  assert.ok(Array.isArray(apps), "response must be an array or include apps array");
  assert.ok(apps.length > 0, "catalog must contain at least one app");
});

test("GET /api/v1/billing returns plan info", async () => {
  const token = await loginAsAdmin();
  const { status, json } = await api("GET", "/api/v1/billing", undefined, authHeader(token));
  assert.equal(status, 200, `expected 200, got ${status}`);
  assert.ok((json as any)?.plan, "response must include plan");
  assert.ok(Array.isArray((json as any)?.plans), "response must include plans array");
});

test("Register → Login → Access dashboard is a complete round-trip", async () => {
  const email = `e2e-roundtrip-${Date.now()}@test.local`;

  // 1. Register
  const reg = await api("POST", "/api/v1/auth/register", {
    email,
    password: "RoundTrip123!",
    name: "Round Trip",
  });
  assert.equal(reg.status, 200, "register should succeed");

  // 2. Login with the same credentials
  const login = await api("POST", "/api/v1/auth/login", {
    email,
    password: "RoundTrip123!",
  });
  assert.equal(login.status, 200, "login should succeed");
  const token = (login.json as any).token;
  assert.ok(token, "login must return a token");

  // 3. Access /me
  const me = await api("GET", "/api/v1/me", undefined, authHeader(token));
  assert.equal(me.status, 200, "/me should succeed");
  assert.equal((me.json as any)?.user?.email, email);

  // 4. Access /automations (dashboard data)
  const autos = await api("GET", "/api/v1/automations", undefined, authHeader(token));
  assert.equal(autos.status, 200, "/automations should succeed");
  assert.ok(Array.isArray((autos.json as any)?.automations));
});

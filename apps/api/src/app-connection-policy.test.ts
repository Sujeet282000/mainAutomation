import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionCanBeUsedByApp, getConnectionSetup, sanitizeConnectionMetadata } from "./app-connection-policy";

test("connection setup is grounded in the real catalog", () => {
  const setup = getConnectionSetup("gmail");
  assert.ok(setup);
  assert.equal(setup.appSlug, "gmail");
  assert.equal(setup.authType, "oauth2");
  assert.equal(setup.oauthProvider, "google");
  assert.ok(setup.capabilities.actions > 0 || setup.capabilities.triggers > 0);
});

test("unknown apps have no connection setup", () => {
  assert.equal(getConnectionSetup("does-not-exist"), null);
});

test("Google connections can be reused across Google pieces", () => {
  assert.equal(connectionCanBeUsedByApp("gmail", "google-calendar"), true);
  assert.equal(connectionCanBeUsedByApp("google-sheets", "google-drive"), true);
  assert.equal(connectionCanBeUsedByApp("slack", "google-calendar"), false);
});

test("connection metadata never exposes credential-like keys", () => {
  const safe = sanitizeConnectionMetadata({
    email: "person@example.com",
    accountId: "123",
    access_token: "secret",
    refresh_token: "secret",
    api_key: "secret",
    nested: { token: "secret" }
  });
  assert.deepEqual(safe, { email: "person@example.com", accountId: "123", nested: { token: "secret" } });
});

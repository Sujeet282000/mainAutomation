import assert from "node:assert/strict";
import test from "node:test";
import { authSchemaFor, credentialShapeError, validateAuthCredentials } from "./auth-schema";
import { hmacSha256Hex, timingSafeEqualHex, verifyStripeSignature } from "./webhook-crypto";
import { isAuthError, missingRequiredMappings, shouldPauseAfterFailures, StepError } from "./runtime-guards";

test("twilio uses basic multi-field auth, google oauth has no paste fields", () => {
  const twilio = authSchemaFor({ slug: "twilio", authType: "basic" });
  assert.equal(twilio.authType, "basic");
  assert.ok(twilio.fields.some((f) => f.key === "account_sid"));
  const gmail = authSchemaFor({ slug: "gmail", authType: "oauth2" });
  assert.equal(gmail.oauthProvider, "google");
  assert.equal(gmail.fields.length, 0);
});

test("openai rejects slack tokens and requires sk- keys", () => {
  const slack = credentialShapeError("openai", { api_key: "xoxe.xoxp-not-an-openai-key" });
  assert.ok(slack && /Slack token/i.test(slack));
  assert.equal(credentialShapeError("openai", { api_key: "sk-proj-abc123" }), null);
});

test("required auth fields are validated without inventing secrets", () => {
  const schema = authSchemaFor({ slug: "openai", authType: "api_key" });
  assert.ok(schema.fields.some((f) => f.key === "api_key" && f.helpUrl));
  assert.ok(schema.fields.some((f) => f.key === "organization_id"));
  assert.deepEqual(validateAuthCredentials(schema, {}), ["api_key"]);
  assert.deepEqual(validateAuthCredentials(schema, { api_key: "sk-test" }), []);
});

test("auth errors and mapping misses are not retried; five failures pause", () => {
  assert.equal(isAuthError(new Error("Google API 401 unauthorized")), true);
  assert.equal(isAuthError(new Error("timeout")), false);
  const err = new StepError("Required field mapping missing: To", { retryable: false, code: "mapping" });
  assert.equal(err.retryable, false);
  assert.equal(shouldPauseAfterFailures(["failed", "failed", "failed", "failed", "failed"]), true);
  assert.equal(shouldPauseAfterFailures(["failed", "succeeded", "failed", "failed", "failed"]), false);
});

test("required interpolated fields that resolve empty are detected", () => {
  const missing = missingRequiredMappings(
    "http",
    "request",
    { method: "POST", url: "{{trigger.body.url}}" },
    { method: "POST", url: "" }
  );
  assert.ok(missing.length >= 1);
});

test("hmac compare is timing-safe; stripe signature verifies when secret set", () => {
  const secret = "whsec_test";
  const body = "{\"ok\":true}";
  const hex = hmacSha256Hex(secret, body);
  assert.equal(timingSafeEqualHex(hex, hex), true);
  assert.equal(timingSafeEqualHex(hex, "00".repeat(32)), false);
  const ts = "1234";
  const v1 = hmacSha256Hex(secret, `${ts}.${body}`);
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${v1}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${"00".repeat(32)}`, secret), false);
  assert.equal(verifyStripeSignature(body, undefined, ""), true);
});

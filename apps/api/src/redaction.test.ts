import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "./crypto";

test("redact removes credentials from nested execution data", () => {
  const result = redact({
    access_token: "token",
    headers: { Cookie: "session=secret", authorization: "Bearer token" },
    nested: [{ client_secret: "secret", value: "safe" }],
  }) as Record<string, unknown>;
  assert.equal(result.access_token, "[REDACTED]");
  assert.deepEqual(result.headers, { Cookie: "[REDACTED]", authorization: "[REDACTED]" });
  assert.deepEqual(result.nested, [{ client_secret: "[REDACTED]", value: "safe" }]);
});
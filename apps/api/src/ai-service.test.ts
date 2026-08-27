import assert from "node:assert/strict";
import test from "node:test";
import { createServiceToken, hashServiceBody, verifyServiceToken } from "./auth";

test("service token round-trips for Node ↔ Python HMAC", () => {
  const raw = JSON.stringify({ org_id: "org-1", request_id: "req-1", request_text: "hi" });
  const hash = hashServiceBody(raw);
  const token = createServiceToken({
    method: "POST",
    path: "/copilot/generate",
    bodySha256: hash,
    orgId: "org-1",
    requestId: "req-1",
  });
  assert.equal(verifyServiceToken(token, "POST", "/copilot/generate", hash, "org-1", "req-1"), true);
  assert.equal(verifyServiceToken(token, "GET", "/copilot/generate", hash, "org-1", "req-1"), false);
});

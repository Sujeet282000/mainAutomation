import assert from "node:assert/strict";
import test from "node:test";
import { classifyHttpFailure, parseRetryAfter, backoffDelayMs } from "./retry-policy";

test("429 is retryable and respects Retry-After seconds", () => {
  const d = classifyHttpFailure(429, "30");
  assert.equal(d.retryable, true);
  assert.equal(d.code, "rate_limit");
  assert.equal(d.retryAfterMs, 30_000);
});

test("401/403 are never retried blindly", () => {
  assert.equal(classifyHttpFailure(401).retryable, false);
  assert.equal(classifyHttpFailure(403).retryable, false);
});

test("404/410 are not retryable; 408/409/425 are", () => {
  assert.equal(classifyHttpFailure(404).retryable, false);
  assert.equal(classifyHttpFailure(410).retryable, false);
  assert.equal(classifyHttpFailure(408).retryable, true);
  assert.equal(classifyHttpFailure(409).retryable, true);
  assert.equal(classifyHttpFailure(425).retryable, true);
});

test("5xx are retryable, other 4xx are not", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(classifyHttpFailure(status).retryable, true, String(status));
  }
  assert.equal(classifyHttpFailure(400).retryable, false);
  assert.equal(classifyHttpFailure(422).retryable, false);
});

test("Retry-After parses HTTP dates and rejects junk", () => {
  const soon = Date.now() + 10_000;
  const ms = parseRetryAfter(new Date(soon).toUTCString());
  assert.ok(ms !== undefined && ms > 0 && ms <= 10_000);
  assert.equal(parseRetryAfter("junk"), undefined);
  assert.equal(parseRetryAfter(null), undefined);
});

test("backoff grows exponentially and is capped", () => {
  const a1 = backoffDelayMs(1, 1000, 60_000);
  const a4 = backoffDelayMs(4, 1000, 60_000);
  const a12 = backoffDelayMs(12, 1000, 60_000);
  assert.ok(a1 >= 1000 && a1 < 1300);
  assert.ok(a4 >= 8000 && a4 < 10_000);
  assert.ok(a12 <= 60_000 * 1.25);
});

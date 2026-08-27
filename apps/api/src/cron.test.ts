import assert from "node:assert/strict";
import test from "node:test";
import { cronMatchesUtc, nextCronUtc } from "./cron";

test("cron */15 matches quarter hours", () => {
  assert.equal(cronMatchesUtc("*/15 * * * *", new Date("2026-01-01T00:00:00Z")), true);
  assert.equal(cronMatchesUtc("*/15 * * * *", new Date("2026-01-01T00:07:00Z")), false);
});

test("nextCronUtc moves forward", () => {
  const n = nextCronUtc("0 * * * *", new Date("2026-01-01T00:01:00Z"));
  assert.equal(n.toISOString(), "2026-01-01T01:00:00.000Z");
});

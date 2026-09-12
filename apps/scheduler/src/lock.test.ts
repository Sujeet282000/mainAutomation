import assert from "node:assert/strict";
import test from "node:test";
import { RedisLease } from "./lock";

test("RedisLease skips work when another scheduler owns the lease", async () => {
  let calls = 0;
  const client = {
    async set() { return null; },
    async eval() { return 0; },
  };
  const result = await new RedisLease(client, "scheduler:tick:leader", 3_000).run(async () => {
    calls += 1;
    return "ran";
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("RedisLease releases its own token after work completes", async () => {
  const values = new Map<string, string>();
  const evalCalls: Array<{ key: string; token: string }> = [];
  const client = {
    async set(key: string, token: string) {
      if (values.has(key)) return null;
      values.set(key, token);
      return "OK" as const;
    },
    async eval(_script: string, _keyCount: number, key: string, token: string) {
      evalCalls.push({ key, token });
      if (values.get(key) !== token) return 0;
      values.delete(key);
      return 1;
    },
  };
  const result = await new RedisLease(client, "scheduler:tick:leader", 3_000).run(async () => "ran");
  assert.equal(result, "ran");
  assert.equal(values.size, 0);
  assert.equal(evalCalls.length, 1);
});

test("RedisLease does not release a replacement owner's token", async () => {
  const values = new Map<string, string>();
  const client = {
    async set(key: string, token: string) {
      values.set(key, token);
      return "OK" as const;
    },
    async eval(_script: string, _keyCount: number, key: string, token: string) {
      if (values.get(key) !== token) return 0;
      values.delete(key);
      return 1;
    },
  };
  await new RedisLease(client, "scheduler:tick:leader", 3_000).run(async () => {
    values.set("scheduler:tick:leader", "replacement-owner");
    return "ran";
  });
  assert.equal(values.get("scheduler:tick:leader"), "replacement-owner");
});

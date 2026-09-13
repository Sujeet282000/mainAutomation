import assert from "node:assert/strict";
import test from "node:test";
import { runCodeStep } from "./code-runner";

test("code runner returns the script result", async () => {
  const res = await runCodeStep("result = input.a + input.b", { a: 2, b: 3 }, false);
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.result, 5);
});

test("code runner surfaces script errors instead of swallowing them", async () => {
  const res = await runCodeStep("throw new Error(\"boom\")", {}, false);
  assert.ok(!res.ok);
  if (!res.ok) assert.match(res.error, /boom/);
});

test("code runner enforces the vm timeout on runaway scripts", async () => {
  const res = await runCodeStep("while (true) {}", {}, false, 3_000);
  assert.ok(!res.ok);
  // Either the vm-level timeout (1500ms) or the thread wall-clock kill stops it.
  if (!res.ok) assert.match(res.error, /terminated|timed out|timeout/i);
});

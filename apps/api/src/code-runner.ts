// ============================================================================
// Code-step isolation (spec #25: never execute arbitrary user code on the API
// request path). `node:vm` alone is NOT a sandbox — it shares the host event
// loop (a runaway script freezes every request) and a vm timeout cannot stop
// synchronous infinite loops from starving the process. Each execution now
// runs in a short-lived Worker thread with a wall-clock kill and V8 resource
// limits, so a bad script burns its own thread, not the API.
// ============================================================================

import { Worker } from "node:worker_threads";

/** Hard wall-clock kill for the whole worker (vm's own timeout is a first line only). */
const CODE_TIMEOUT_MS = 5_000;

type RunResult = { ok: true; result: unknown } | { ok: false; error: string };

const workerSource = `
const { workerData, parentPort } = require("node:worker_threads");
const vm = require("node:vm");
const sandbox = {
  input: workerData.input,
  auth: { connected: workerData.authConnected },
  result: undefined,
};
try {
  vm.runInNewContext(workerData.code, sandbox, { timeout: 1500 });
  parentPort.postMessage({ ok: true, result: sandbox.result === undefined ? sandbox : sandbox.result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
`;

export function runCodeStep(
  code: string,
  input: unknown,
  authConnected: boolean,
  timeoutMs: number = CODE_TIMEOUT_MS,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RunResult, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) void worker.terminate();
      resolve(value);
    };

    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { code: `${code};`, input, authConnected },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });

    const timer = setTimeout(() => {
      finish({ ok: false, error: `Code step exceeded ${timeoutMs}ms and was terminated.` }, true);
    }, timeoutMs);

    worker.once("message", (msg: RunResult) => finish(msg));
    worker.once("error", (err: Error) => finish({ ok: false, error: err.message }));
    worker.once("exit", (exitCode: number) => {
      if (exitCode !== 0) finish({ ok: false, error: `Code worker exited unexpectedly (code ${exitCode}).` });
    });
  });
}

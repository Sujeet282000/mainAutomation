import { z } from "zod";
import { query, queryOne } from "./db";

export const Diagnosis = z.object({
  cause: z.string(),
  category: z.enum([
    "auth",
    "mapping",
    "validation",
    "rate_limit",
    "logic",
    "third_party_outage",
    "data_quality",
    "configuration"
  ]),
  userFix: z.string(),
  patch: z.array(z.any()),
  patchExplanation: z.string(),
  confidence: z.number().min(0).max(1),
  safeToAutoApply: z.boolean()
});

export type TDiagnosis = z.infer<typeof Diagnosis>;

function errText(error: unknown) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) return String((error as { message?: unknown }).message ?? "");
  return JSON.stringify(error);
}

export function diagnoseFromFailure(opts: {
  status?: string;
  runError?: unknown;
  failed?: { name?: string | null; app_slug?: string | null; operation?: string | null; error?: unknown; input?: unknown };
}): TDiagnosis {
  const text = `${errText(opts.runError)} ${errText(opts.failed?.error)}`.toLowerCase();
  const step = opts.failed?.name || opts.failed?.operation || "a step";

  if (/xoxe|xoxb|incorrect api key/.test(text) && /openai/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} used a Slack token (xoxe) instead of an OpenAI API key.`,
      category: "auth",
      userFix:
        "Open the OpenAI step → Setup → Reconnect. Paste a key that starts with sk- from https://platform.openai.com/api-keys. Changing .env does not rewrite a saved connection.",
      patch: [],
      patchExplanation: "No draft patch — credentials stay a human consent boundary.",
      confidence: 0.94,
      safeToAutoApply: false
    });
  }
  if (/gmail api has not been used|gmail\.googleapis\.com.*(?:disabled|permission_denied)|service_disabled/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} could not access Gmail because the Gmail API is disabled in the Google Cloud project used by this connection.`,
      category: "configuration",
      userFix:
        "In Google Cloud Console, enable Gmail API for the project named in the error. Wait a few minutes for Google to activate it, then reconnect the Google account and test the workflow again.",
      patch: [],
      patchExplanation: "No workflow patch is needed. This is a Google Cloud project setting and OAuth consent boundary.",
      confidence: 0.99,
      safeToAutoApply: false
    });
  }
  if (/401|403|unauthorized|invalid.?token|reconnect|expired/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} failed because the connection is missing, expired, or unauthorized.`,
      category: "auth",
      userFix: "Reconnect the account on that step. Copilot cannot complete OAuth or store secrets.",
      patch: [],
      patchExplanation: "No draft patch — credentials stay a human consent boundary.",
      confidence: 0.86,
      safeToAutoApply: false
    });
  }
  if (/429|rate.?limit|too many requests/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} was throttled by the third-party API.`,
      category: "rate_limit",
      userFix: "Wait and replay the run, or lower concurrency on this piece.",
      patch: [],
      patchExplanation: "Empty patch — this is an external limit, not a mapping error.",
      confidence: 0.8,
      safeToAutoApply: false
    });
  }
  if (/5\d\d|timeout|econnreset|enotfound|outage/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} failed because the third-party service did not respond cleanly.`,
      category: "third_party_outage",
      userFix: "Retry later. If it keeps failing, check the app status page.",
      patch: [],
      patchExplanation: "Empty patch — do not rewrite the draft for a transient outage.",
      confidence: 0.72,
      safeToAutoApply: false
    });
  }
  if (/required|missing field|unmapped|cannot resolve|empty/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} is missing a required mapped value.`,
      category: "mapping",
      userFix: "Open the step’s Map tab, bind a token from upstream data, then test the step.",
      patch: [],
      patchExplanation: "Mapping patches are review-only. Abstain rather than guess a field.",
      confidence: 0.74,
      safeToAutoApply: false
    });
  }
  if (/validat/.test(text)) {
    return Diagnosis.parse({
      cause: `${step} returned a shape that failed schema validation.`,
      category: "validation",
      userFix: "Inspect the step output, then adjust the mapping or the AI output schema.",
      patch: [],
      patchExplanation: "No auto patch — validation failures need a human look at the contract.",
      confidence: 0.7,
      safeToAutoApply: false
    });
  }
  return Diagnosis.parse({
    cause: opts.failed
      ? `${step} failed during execution.`
      : "This run did not record a failed step with enough detail.",
    category: "configuration",
    userFix: "Open the failed step, compare input vs output, then test before publishing any change.",
    patch: [],
    patchExplanation: "Ops Copilot is read-only by default. Suggested patches require your approval.",
    confidence: 0.45,
    safeToAutoApply: false
  });
}

export async function diagnoseRun(opts: { workspaceId: string; organizationId: string; runId: string }) {
  const execution = await queryOne<{
    id: string;
    status: string;
    error: unknown;
    automation_id: string;
  }>(`select id, status, error, automation_id from executions where id=$1 and workspace_id=$2`, [
    opts.runId,
    opts.workspaceId
  ]);
  if (!execution) throw Object.assign(new Error("not_found"), { status: 404 });

  const steps = await query<{
    name: string | null;
    app_slug: string | null;
    operation: string | null;
    status: string;
    error: unknown;
    input: unknown;
  }>(
    `select name, app_slug, operation, status, error, input from execution_steps where execution_id=$1 order by started_at asc`,
    [opts.runId]
  );
  const failed = steps.find((s) => s.status === "failed") ?? steps[steps.length - 1];
  const diagnosis = diagnoseFromFailure({
    status: execution.status,
    runError: execution.error,
    failed
  });

  await query(
    `insert into copilot_actions (organization_id, workspace_id, automation_id, prompt, stage, payload)
     values ($1,$2,$3,$4,'ops_diagnose',$5)`,
    [
      opts.organizationId,
      opts.workspaceId,
      execution.automation_id,
      `diagnose-run ${opts.runId}`,
      JSON.stringify({ diagnosis, runId: opts.runId, applied: false })
    ]
  ).catch(() => undefined);

  return { diagnosis, runId: opts.runId, automationId: execution.automation_id };
}

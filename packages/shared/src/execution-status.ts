export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "paused",
  "retrying",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
  "filtered",
  "dehydrated",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  "pending",
  "queued",
  "running",
  "waiting",
  "retrying",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

export function isTerminalRunStatus(status: RunStatus) {
  return ["succeeded", "failed", "cancelled", "timed_out", "expired", "filtered"].includes(status);
}

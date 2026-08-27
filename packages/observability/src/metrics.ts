// ============================================================================
// Orchestra Part 12 — Prometheus Metrics
// Source of truth: Part 12 § "Metrics"
// ============================================================================

// ── Flow execution metrics ──────────────────────────────────────────────────

export const metrics = {
  // Flow runs by terminal status
  runsTotal: {
    name: "orchestra_runs_total",
    help: "Flow runs by terminal status",
    labels: ["org_id", "flow_id", "status"] as const,
    count: 0,
  },

  // Wall-clock run duration
  runDuration: {
    name: "orchestra_run_duration_seconds",
    help: "Wall-clock run duration, excluding dehydrated time",
    labels: ["flow_id"] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300],
    values: [] as number[],
  },

  // Per-step execution duration
  stepDuration: {
    name: "orchestra_step_duration_seconds",
    help: "Per-step execution duration",
    labels: ["piece", "operation", "status"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 60],
    values: [] as number[],
  },

  // Step failures by error class and code
  stepErrors: {
    name: "orchestra_step_errors_total",
    help: "Step failures by error class and code",
    labels: ["piece", "error_class", "code"] as const,
    count: 0,
  },

  // Queue depth — the primary autoscaling signal
  queueDepth: {
    name: "orchestra_queue_depth",
    help: "Waiting jobs per queue",
    labels: ["queue", "state"] as const,
    value: 0,
  },

  // Webhook acknowledgement time
  webhookAck: {
    name: "orchestra_webhook_ack_seconds",
    help: "Time from webhook receipt to HTTP 200",
    labels: ["piece"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.5],
    values: [] as number[],
  },

  // Active connections expiring
  connectionsExpiring: {
    name: "orchestra_connections_expiring",
    help: "Active connections expiring within 7 days",
    labels: ["piece"] as const,
    value: 0,
  },

  // Dehydrated runs
  dehydratedRuns: {
    name: "orchestra_dehydrated_runs",
    help: "Runs parked on a delay or an approval",
    labels: ["reason"] as const,
    value: 0,
  },

  // ── AI metrics ──────────────────────────────────────────────────────────

  // Model calls by purpose, model, and outcome
  aiCalls: {
    name: "orchestra_ai_calls_total",
    help: "Model calls by purpose, model, and outcome",
    labels: ["purpose", "model", "outcome"] as const,
    count: 0,
  },

  // Tokens consumed
  aiTokens: {
    name: "orchestra_ai_tokens_total",
    help: "Tokens consumed",
    labels: ["purpose", "model", "direction"] as const,
    count: 0,
  },

  // Model spend in USD
  aiCost: {
    name: "orchestra_ai_cost_usd_total",
    help: "Model spend in USD",
    labels: ["org_id", "purpose", "model"] as const,
    value: 0,
  },

  // Model call latency
  aiLatency: {
    name: "orchestra_ai_latency_seconds",
    help: "Model call latency",
    labels: ["purpose", "model"] as const,
    buckets: [0.2, 0.5, 1, 2, 4, 8, 15, 30, 60, 120],
    values: [] as number[],
  },

  // Prompt cache hits and misses
  cacheEvents: {
    name: "orchestra_ai_cache_events_total",
    help: "Prompt cache hits and misses",
    labels: ["purpose", "result"] as const,
    count: 0,
  },

  // Schema repair attempts
  schemaRepairs: {
    name: "orchestra_ai_schema_repairs_total",
    help: "Structured-output repair attempts and their outcome",
    labels: ["purpose", "outcome"] as const,
    count: 0,
  },

  // Deliberate abstentions
  abstentions: {
    name: "orchestra_ai_abstentions_total",
    help: "Deliberate abstentions — a quality signal, not an error",
    labels: ["purpose", "reason"] as const,
    count: 0,
  },

  // Copilot pipeline stage completions
  copilotStage: {
    name: "orchestra_copilot_stage_total",
    help: "Copilot pipeline stage completions",
    labels: ["stage", "outcome"] as const,
    count: 0,
  },

  // Agent iterations per step
  agentIterations: {
    name: "orchestra_agent_iterations",
    help: "Iterations consumed per agent step",
    buckets: [1, 2, 3, 4, 5, 6, 8, 10, 15],
    values: [] as number[],
  },

  // Budget rejections
  budgetRejections: {
    name: "orchestra_ai_budget_rejections_total",
    help: "Calls rejected before reaching a provider",
    labels: ["org_id", "scope"] as const,
    count: 0,
  },

  // Concurrent model calls — the AI service autoscaling signal
  inflight: {
    name: "orchestra_ai_inflight_calls",
    help: "Concurrent model calls",
    value: 0,
  },
};

// ── Metric recording helpers ────────────────────────────────────────────────

export function recordRun(orgId: string, flowId: string, status: string) {
  metrics.runsTotal.count++;
}

export function recordStep(piece: string, operation: string, status: string, durationMs: number) {
  metrics.stepDuration.values.push(durationMs / 1000);
}

export function recordStepError(piece: string, errorClass: string, code: string) {
  metrics.stepErrors.count++;
}

export function recordAiCall(purpose: string, model: string, outcome: string) {
  metrics.aiCalls.count++;
}

export function recordAiTokens(purpose: string, model: string, direction: "in" | "out", count: number) {
  metrics.aiTokens.count += count;
}

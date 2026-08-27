import type { Db } from "@algoverge/db";

/** Maps the SQL repository's snake_case rows to the engine's runtime contract. */
export function createEngineDb(db: Db) {
  return {
    flowRuns: {
      async claimTransition(runId: string, expectedCursor: number, expectedEpoch: number) {
        const result = await db.service.query(
          `UPDATE flow_runs SET transition_epoch = transition_epoch + 1, transition_lease = now() + interval '5 minutes'
           WHERE id = $1 AND cursor = $2 AND transition_epoch = $3 AND status IN ('running', 'queued') RETURNING *`,
          [runId, expectedCursor, expectedEpoch],
        );
        const row = result.rows[0];
        return row ? mapRun(row) : null;
      },
      async checkpoint(runId: string, input: { expectedCursor: number; expectedEpoch: number; appendContext: Record<string, unknown>; nextCursor: number; status: string }) {
        const result = await db.service.query(
          `UPDATE flow_runs SET context = context || $3::jsonb, cursor = $4, status = $5, transition_epoch = transition_epoch + 1
           WHERE id = $1 AND cursor = $2 AND transition_epoch = $6 RETURNING *`,
          [runId, input.expectedCursor, JSON.stringify(input.appendContext), input.nextCursor, input.status, input.expectedEpoch],
        );
        if (!result.rows[0]) throw new Error("FLOW_RUN_CHECKPOINT_CONFLICT");
        return mapRun(result.rows[0]);
      },
      async finish(runId: string, status: string, context: unknown, finishedAt: Date) {
        await db.service.query(
          `UPDATE flow_runs SET status = $2, context = $3::jsonb, finished_at = $4,
             duration_ms = extract(epoch from ($4 - started_at)) * 1000,
             steps_billable = (SELECT count(*)::int FROM run_steps WHERE run_id = $1 AND status = 'succeeded') WHERE id = $1`,
          [runId, status, JSON.stringify(context), finishedAt],
        );
      },
      async pause(runId: string, input: { expectedCursor: number; expectedEpoch: number; contextJson: Record<string, unknown>; reason: string; resumeAt: string | null }) {
        const result = await db.service.query(
          `UPDATE flow_runs SET status = 'paused', paused_reason = $3, resume_at = $4, context = $5::jsonb
           WHERE id = $1 AND cursor = $2 AND transition_epoch = $6`,
          [runId, input.expectedCursor, input.reason, input.resumeAt, JSON.stringify(input.contextJson), input.expectedEpoch],
        );
        if (!result.rowCount) throw new Error("FLOW_RUN_PAUSE_CONFLICT");
      },
    },
    flowVersions: {
      async byId(versionId: string) {
        const result = await db.service.query("SELECT * FROM flow_versions WHERE id = $1", [versionId]);
        const row = result.rows[0];
        return row ? { id: row.id, orgId: row.org_id, flowId: row.flow_id, versionNumber: row.version_number, definition: row.definition } : null;
      },
    },
    runSteps: {
      async completedByEffectKey(runId: string, stepId: string, effectKey: string) {
        const result = await db.service.query(
          `SELECT * FROM run_steps WHERE run_id = $1 AND step_id = $2 AND effect_key = $3 AND status = 'succeeded' ORDER BY attempt DESC LIMIT 1`,
          [runId, stepId, effectKey],
        );
        const row = result.rows[0];
        return row ? { outputJson: row.output_json ?? {} } : null;
      },
      async insert(input: any) {
        const result = await db.service.query(
          `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, operation_id, effect_key, status, input_json, output_json, error_class, error_code, error_json, attempt, duration_ms, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING *`,
          [input.runId, input.runCreatedAt, input.orgId, input.stepId, input.stepType, input.operationId ?? null, input.effectKey ?? null, input.status, input.inputJson ? JSON.stringify(input.inputJson) : null, input.outputJson ? JSON.stringify(input.outputJson) : null, input.errorClass ?? null, input.errorCode ?? null, input.errorJson ? JSON.stringify(input.errorJson) : null, input.attempt ?? 1, input.durationMs ?? null],
        );
        return result.rows[0];
      },
      async finish(orgId: string, id: string, output: unknown, durationMs: number, status = "succeeded", errorClass?: string, errorCode?: string, errorJson?: Record<string, unknown>) {
        await db.service.query(
          `UPDATE run_steps SET status=$3, output_json=$4::jsonb, error_class=$5, error_code=$6, error_json=$7::jsonb, duration_ms=$8, finished_at=now() WHERE id=$1 AND org_id=$2`,
          [id, orgId, status, output == null ? null : JSON.stringify(output), errorClass ?? null, errorCode ?? null, errorJson ? JSON.stringify(errorJson) : null, durationMs],
        );
      },
    },
    todos: {
      async create(orgId: string, runId: string, runCreatedAt: string, stepId: string, title: string, payload: Record<string, unknown>) {
        await db.service.query(
          `INSERT INTO todos (org_id, run_id, run_created_at, step_id, title, payload_json, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
          [orgId, runId, runCreatedAt, stepId, title, JSON.stringify(payload)],
        );
      },
    },
  };
}

function mapRun(row: any) {
  return {
    id: row.id,
    createdAt: row.created_at,
    orgId: row.org_id,
    projectId: row.project_id,
    flowId: row.flow_id,
    flowVersionId: row.flow_version_id,
    triggerKind: row.trigger_kind,
    status: row.status,
    context: row.context ?? {},
    transitionEpoch: row.transition_epoch,
    cursor: row.cursor,
  };
}

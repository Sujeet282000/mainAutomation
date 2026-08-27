// ============================================================================
// Orchestra Part 5 — Database Layer (@orchestra/db)
// Source of truth: Part 5 § "@orchestra/db : typed Supabase access"
//
// Two deliberately different access paths:
// - RLS policies remain the authority for user-scoped reads
// - service-role methods after authorization has been performed
// ============================================================================

import { Pool, type PoolClient, type QueryResult } from "pg";

// ── Types ───────────────────────────────────────────────────────────────────

export type FlowDefinition = Record<string, unknown>;

export interface FlowRow {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  slug: string;
  status: string;
  draft_definition: FlowDefinition;
  published_version_id: string | null;
  origin: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowVersionRow {
  id: string;
  org_id: string;
  flow_id: string;
  version_number: number;
  definition: FlowDefinition;
  definition_hash: string;
  published_by: string | null;
  published_at: string;
}

export interface FlowRunRow {
  id: string;
  created_at: string;
  org_id: string;
  project_id: string;
  flow_id: string;
  flow_version_id: string;
  trigger_kind: string;
  trigger_event_id: string | null;
  idempotency_key: string | null;
  status: string;
  context: Record<string, unknown>;
  context_preview: Record<string, unknown>;
  transition_epoch: number;
  transition_lease: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  steps_billable: number;
  paused_reason: string | null;
  resume_at: string | null;
}

export interface RunStepRow {
  id: string;
  run_id: string;
  run_created_at: string;
  org_id: string;
  step_id: string;
  step_type: string;
  operation_id: string | null;
  sequence_no: number;
  attempt: number;
  effect_key: string | null;
  status: string;
  input_json: Record<string, unknown> | null;
  input_ref: string | null;
  output_json: Record<string, unknown> | null;
  output_ref: string | null;
  output_preview: Record<string, unknown> | null;
  error_class: string | null;
  error_code: string | null;
  error_json: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ConnectionRow {
  id: string;
  org_id: string;
  project_id: string | null;
  piece_id: string | null;
  piece_name: string;
  label: string;
  auth_type: string;
  status: string;
  owner_email: string | null;
  account_email: string | null;
  use_count: number;
  last_used_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TriggerRegistryRow {
  id: string;
  org_id: string;
  flow_id: string;
  flow_version_id: string;
  kind: string;
  operation_id: string | null;
  connection_id: string | null;
  piece_name: string | null;
  webhook_token: string | null;
  external_hook_id: string | null;
  cron_expr: string | null;
  timezone: string;
  poll_cursor: Record<string, unknown>;
  next_poll_at: string | null;
  enabled: boolean;
  consecutive_failures: number;
  status: string;
}

export interface TodoRow {
  id: string;
  org_id: string;
  run_id: string;
  run_created_at: string;
  step_id: string;
  assignee_id: string | null;
  title: string;
  payload_json: Record<string, unknown>;
  status: string;
  resolution: Record<string, unknown> | null;
  expires_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PieceOperationRow {
  operation_id: string;
  kind: string;
  display_name: string;
  description: string;
  props: Record<string, unknown>;
  metadata: Record<string, unknown>;
  side_effect: string;
  auth_type: string;
  text: string;
  piece_name: string;
  piece_display_name: string;
  piece_version: string;
}

// ── Db class ────────────────────────────────────────────────────────────────

export class Db {
  readonly service: Pool;
  private _anon: Pool | null = null;

  constructor(connectionString: string) {
    this.service = new Pool({ connectionString, max: 20 });
  }

  /** Anon pool for user-scoped queries (RLS applies) */
  get anon(): Pool {
    if (!this._anon) {
      this._anon = new Pool({
        connectionString: this.service.options.connectionString,
        max: 10,
      });
    }
    return this._anon;
  }

  /** Execute a transaction with service-role access */
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.service.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.service.end();
    if (this._anon) await this._anon.end();
  }
}

// ── Repositories ────────────────────────────────────────────────────────────
// Source of truth: Part 5 § "Repositories"

export class FlowsRepository {
  constructor(private readonly db: Db) {}

  async byId(orgId: string, flowId: string): Promise<FlowRow | null> {
    const result = await this.db.service.query(
      "SELECT * FROM flows WHERE id = $1 AND org_id = $2",
      [flowId, orgId]
    );
    return result.rows[0] ?? null;
  }

  async listForOrg(
    orgId: string,
    projectId?: string
  ): Promise<FlowRow[]> {
    let query = "SELECT * FROM flows WHERE org_id = $1";
    const params: unknown[] = [orgId];
    if (projectId) {
      query += " AND project_id = $2";
      params.push(projectId);
    }
    query += " ORDER BY updated_at DESC";
    const result = await this.db.service.query(query, params);
    return result.rows;
  }

  async create(input: {
    orgId: string;
    projectId: string;
    name: string;
    slug: string;
    origin?: string;
    createdBy?: string;
    draftDefinition?: FlowDefinition;
  }): Promise<FlowRow> {
    const result = await this.db.service.query(
      `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.orgId,
        input.projectId,
        input.name,
        input.slug,
        input.origin ?? "manual",
        input.createdBy ?? null,
        JSON.stringify(input.draftDefinition ?? { schemaVersion: 1, trigger: { id: "trigger", type: "manual", props: {} }, steps: [], settings: {} }),
      ]
    );
    return result.rows[0];
  }

  async update(
    orgId: string,
    flowId: string,
    updates: Partial<{
      name: string;
      slug: string;
      status: string;
      draft_definition: FlowDefinition;
      published_version_id: string;
      updated_by: string;
    }>
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 3;
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      sets.push(`${key} = $${i}`);
      params.push(key === "draft_definition" ? JSON.stringify(value) : value);
      i++;
    }
    if (sets.length === 0) return;
    sets.push("updated_at = now()");
    await this.db.service.query(
      `UPDATE flows SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`,
      [flowId, orgId, ...params]
    );
  }

  async enable(orgId: string, flowId: string): Promise<void> {
    await this.db.service.query(
      "UPDATE flows SET status = 'active', updated_at = now() WHERE id = $1 AND org_id = $2",
      [flowId, orgId]
    );
  }

  async disable(orgId: string, flowId: string): Promise<void> {
    await this.db.service.query(
      "UPDATE flows SET status = 'disabled', updated_at = now() WHERE id = $1 AND org_id = $2",
      [flowId, orgId]
    );
  }
}

export class FlowVersionsRepository {
  constructor(private readonly db: Db) {}

  async insert(input: {
    orgId: string;
    flowId: string;
    definition: FlowDefinition;
    definitionHash: string;
    versionNumber: number;
    publishedBy?: string;
  }): Promise<FlowVersionRow> {
    const result = await this.db.service.query(
      `INSERT INTO flow_versions (org_id, flow_id, definition, definition_hash, version_number, published_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.orgId,
        input.flowId,
        JSON.stringify(input.definition),
        input.definitionHash,
        input.versionNumber,
        input.publishedBy ?? null,
      ]
    );
    return result.rows[0];
  }

  async byNumber(
    orgId: string,
    flowId: string,
    versionNumber: number
  ): Promise<FlowVersionRow | null> {
    const result = await this.db.service.query(
      "SELECT * FROM flow_versions WHERE org_id = $1 AND flow_id = $2 AND version_number = $3",
      [orgId, flowId, versionNumber]
    );
    return result.rows[0] ?? null;
  }

  async currentPublished(flowId: string): Promise<FlowVersionRow | null> {
    const result = await this.db.service.query(
      `SELECT * FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [flowId]
    );
    return result.rows[0] ?? null;
  }

  async byHash(
    orgId: string,
    flowId: string,
    definitionHash: string
  ): Promise<FlowVersionRow | null> {
    const result = await this.db.service.query(
      "SELECT * FROM flow_versions WHERE org_id = $1 AND flow_id = $2 AND definition_hash = $3",
      [orgId, flowId, definitionHash]
    );
    return result.rows[0] ?? null;
  }
}

export class RunsRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    orgId: string;
    projectId: string;
    flowId: string;
    flowVersionId: string;
    triggerKind: string;
    triggerEventId?: string;
    idempotencyKey?: string;
    context: Record<string, unknown>;
  }): Promise<FlowRunRow> {
    const result = await this.db.service.query(
      `INSERT INTO flow_runs (org_id, project_id, flow_id, flow_version_id, trigger_kind, trigger_event_id, idempotency_key, status, context, context_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9)
       RETURNING *`,
      [
        input.orgId,
        input.projectId,
        input.flowId,
        input.flowVersionId,
        input.triggerKind,
        input.triggerEventId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(input.context),
        JSON.stringify({ trigger: input.context.trigger }),
      ]
    );
    return result.rows[0];
  }

  async claimQueued(limit: number): Promise<FlowRunRow[]> {
    return this.db.transaction(async (client) => {
      const result = await client.query(
        `WITH claimed AS (
           SELECT id, created_at FROM flow_runs
           WHERE status = 'queued'
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE flow_runs r
         SET status = 'running', started_at = now(), transition_epoch = transition_epoch + 1
         FROM claimed c
         WHERE r.id = c.id AND r.created_at = c.created_at
         RETURNING r.*`,
        [limit]
      );
      return result.rows;
    });
  }

  async claimTransition(
    runId: string,
    expectedCursor: number,
    expectedEpoch: number
  ): Promise<FlowRunRow | null> {
    const result = await this.db.service.query(
      `UPDATE flow_runs
       SET transition_epoch = transition_epoch + 1,
           transition_lease = now() + interval '5 minutes'
       WHERE id = $1
         AND transition_epoch = $2
         AND status IN ('running', 'queued')
       RETURNING *`,
      [runId, expectedEpoch]
    );
    return result.rows[0] ?? null;
  }

  async checkpoint(
    runId: string,
    input: {
      expectedCursor: number;
      expectedEpoch: number;
      appendContext: Record<string, unknown>;
      nextCursor: number;
      status: string;
    }
  ): Promise<FlowRunRow> {
    const result = await this.db.service.query(
      `UPDATE flow_runs
       SET context = context || $3::jsonb,
           status = $4,
           transition_epoch = transition_epoch + 1
       WHERE id = $1 AND transition_epoch = $2
       RETURNING *`,
      [
        runId,
        input.expectedEpoch,
        JSON.stringify(input.appendContext),
        input.status,
      ]
    );
    return result.rows[0];
  }

  async finish(
    runId: string,
    status: string,
    context: unknown,
    finishedAt: Date
  ): Promise<void> {
    await this.db.service.query(
      `UPDATE flow_runs
       SET status = $2, context = $3::jsonb, finished_at = $4,
           steps_billable = (SELECT count(*)::int FROM run_steps WHERE run_id = $1 AND status = 'succeeded' AND step_type IN ('piece_action', 'http', 'code', 'ai', 'agent', 'data_table'))
       WHERE id = $1`,
      [runId, status, JSON.stringify(context), finishedAt]
    );
  }

  async pause(
    runId: string,
    input: {
      expectedCursor: number;
      expectedEpoch: number;
      contextJson: Record<string, unknown>;
      reason: string;
      resumeAt: string | null;
    }
  ): Promise<void> {
    await this.db.service.query(
      `UPDATE flow_runs
       SET status = 'paused', paused_reason = $3, resume_at = $4,
           context = $5::jsonb
       WHERE id = $1 AND transition_epoch = $2`,
      [runId, input.expectedEpoch, input.reason, input.resumeAt, JSON.stringify(input.contextJson)]
    );
  }

  async byId(orgId: string, runId: string): Promise<FlowRunRow | null> {
    const result = await this.db.service.query(
      "SELECT * FROM flow_runs WHERE id = $1 AND org_id = $2",
      [runId, orgId]
    );
    return result.rows[0] ?? null;
  }
}

export class RunStepsRepository {
  constructor(private readonly db: Db) {}

  async insert(input: {
    runId: string;
    runCreatedAt: string;
    orgId: string;
    stepId: string;
    stepType: string;
    operationId?: string;
    effectKey?: string;
    status: string;
    inputJson?: Record<string, unknown>;
    inputRef?: string;
  }): Promise<RunStepRow> {
    const result = await this.db.service.query(
      `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, operation_id, effect_key, status, input_json, input_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.runId,
        input.runCreatedAt,
        input.orgId,
        input.stepId,
        input.stepType,
        input.operationId ?? null,
        input.effectKey ?? null,
        input.status,
        input.inputJson ? JSON.stringify(input.inputJson) : null,
        input.inputRef ?? null,
      ]
    );
    return result.rows[0];
  }

  async finish(
    orgId: string,
    id: string,
    output: unknown,
    durationMs: number,
    status: string = "succeeded",
    errorClass?: string,
    errorCode?: string,
    errorJson?: Record<string, unknown>,
    outputRef?: string
  ): Promise<RunStepRow> {
    const result = await this.db.service.query(
      `UPDATE run_steps
       SET status = $3, output_json = $4, output_ref = $5,
           error_class = $6, error_code = $7, error_json = $8,
           duration_ms = $9, finished_at = now()
       WHERE id = $1 AND org_id = $2
       RETURNING *`,
      [
        id,
        orgId,
        status,
        output ? JSON.stringify(output) : null,
        outputRef ?? null,
        errorClass ?? null,
        errorCode ?? null,
        errorJson ? JSON.stringify(errorJson) : null,
        durationMs,
      ]
    );
    return result.rows[0];
  }

  async completedByEffectKey(
    runId: string,
    stepId: string,
    effectKey: string
  ): Promise<RunStepRow | null> {
    const result = await this.db.service.query(
      `SELECT * FROM run_steps
       WHERE run_id = $1 AND step_id = $2 AND effect_key = $3 AND status = 'succeeded'
       ORDER BY attempt DESC LIMIT 1`,
      [runId, stepId, effectKey]
    );
    return result.rows[0] ?? null;
  }

  async listByRun(runId: string, runCreatedAt: string): Promise<RunStepRow[]> {
    const result = await this.db.service.query(
      `SELECT * FROM run_steps
       WHERE run_id = $1 AND run_created_at = $2
       ORDER BY sequence_no ASC`,
      [runId, runCreatedAt]
    );
    return result.rows;
  }
}

export class ConnectionsRepository {
  constructor(private readonly db: Db) {}

  async byIdInternal(orgId: string, connectionId: string): Promise<ConnectionRow | null> {
    const result = await this.db.service.query(
      "SELECT * FROM connections WHERE id = $1 AND org_id = $2",
      [connectionId, orgId]
    );
    return result.rows[0] ?? null;
  }

  async usable(
    orgId: string,
    projectId: string,
    pieceName: string
  ): Promise<ConnectionRow[]> {
    const result = await this.db.service.query(
      `SELECT id, label, piece_name, auth_type, status, owner_email, account_email, use_count, project_id
       FROM connections
       WHERE org_id = $1 AND piece_name = $2 AND status = 'active'
         AND (project_id = $3 OR project_id IS NULL)
       ORDER BY use_count DESC, created_at ASC`,
      [orgId, pieceName, projectId]
    );
    return result.rows;
  }

  async touch(orgId: string, connectionId: string): Promise<void> {
    await this.db.service.query("SELECT public.touch_connection($1, $2)", [
      orgId,
      connectionId,
    ]);
  }

  async markError(orgId: string, id: string, code: string): Promise<void> {
    await this.db.service.query(
      "UPDATE connections SET status = 'error', error_code = $3 WHERE id = $1 AND org_id = $2",
      [id, orgId, code]
    );
  }

  async listMetadataForOrg(orgId: string): Promise<ConnectionRow[]> {
    const result = await this.db.service.query(
      `SELECT id, org_id, project_id, piece_name, label, auth_type, status,
              owner_email, account_email, use_count, last_used_at, expires_at, created_at
       FROM connections WHERE org_id = $1`,
      [orgId]
    );
    return result.rows;
  }
}

export class TriggersRepository {
  constructor(private readonly db: Db) {}

  async claimDue(limit: number): Promise<TriggerRegistryRow[]> {
    return this.db.transaction(async (client) => {
      const result = await client.query(
        "SELECT * FROM internal.claim_due_triggers($1)",
        [limit]
      );
      return result.rows;
    });
  }

  async listActiveForFlow(flowId: string): Promise<TriggerRegistryRow[]> {
    const result = await this.db.service.query(
      "SELECT * FROM triggers_registry WHERE flow_id = $1 AND enabled = true",
      [flowId]
    );
    return result.rows;
  }

  async disable(id: string, at: Date): Promise<void> {
    await this.db.service.query(
      "UPDATE triggers_registry SET enabled = false, status = 'disabled', updated_at = $2 WHERE id = $1",
      [id, at]
    );
  }
}

export class TodosRepository {
  constructor(private readonly db: Db) {}

  async create(
    orgId: string,
    runId: string,
    runCreatedAt: string,
    stepId: string,
    title: string,
    payload: Record<string, unknown>
  ): Promise<TodoRow> {
    const result = await this.db.service.query(
      `INSERT INTO todos (org_id, run_id, run_created_at, step_id, title, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orgId, runId, runCreatedAt, stepId, title, JSON.stringify(payload)]
    );
    return result.rows[0];
  }

  async claimOldestPending(orgId: string): Promise<TodoRow | null> {
    return this.db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE todos SET status = 'approved', resolved_at = now()
         WHERE id = (
           SELECT id FROM todos
           WHERE org_id = $1 AND status = 'pending'
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [orgId]
      );
      return result.rows[0] ?? null;
    });
  }
}

export class CopilotSessionsRepository {
  constructor(private readonly db: Db) {}

  async create(
    orgId: string,
    projectId: string,
    userId: string,
    flowId?: string
  ): Promise<{ id: string }> {
    const result = await this.db.service.query(
      `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [orgId, projectId, userId, flowId ?? null]
    );
    return result.rows[0];
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export type Repositories = {
  flows: FlowsRepository;
  flowVersions: FlowVersionsRepository;
  runs: RunsRepository;
  runSteps: RunStepsRepository;
  connections: ConnectionsRepository;
  triggers: TriggersRepository;
  todos: TodosRepository;
  copilotSessions: CopilotSessionsRepository;
};

export function createRepositories(db: Db): Repositories {
  return {
    flows: new FlowsRepository(db),
    flowVersions: new FlowVersionsRepository(db),
    runs: new RunsRepository(db),
    runSteps: new RunStepsRepository(db),
    connections: new ConnectionsRepository(db),
    triggers: new TriggersRepository(db),
    todos: new TodosRepository(db),
    copilotSessions: new CopilotSessionsRepository(db),
  };
}

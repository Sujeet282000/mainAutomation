// ============================================================================
// Orchestra Part 5 — Core Services
// Source of truth: Part 5 § "PieceRegistry, ConnectionsService, FlowsService, FlowValidator"
// ============================================================================

import { definitionHash, safeParseFlowDefinition, type TFlowDefinition, type Condition, type Step } from "./flow-schema";
import { assertCapability } from "./invariants";

// ── Types (self-contained, no external DB dependency) ───────────────────────

export interface FlowRow {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  slug: string;
  status: string;
  draft_definition: Record<string, unknown>;
  published_version_id: string | null;
}

export interface FlowVersionRow {
  id: string;
  org_id: string;
  flow_id: string;
  version_number: number;
  definition: Record<string, unknown>;
  definition_hash: string;
  published_by: string | null;
}

export interface ConnectionRow {
  id: string;
  org_id: string;
  piece_name: string;
  label: string;
  status: string;
  account_email: string | null;
}

// ── PieceRegistry ───────────────────────────────────────────────────────────

export interface PieceOperation {
  operationId: string;
  kind: "trigger" | "action" | "search";
  displayName: string;
  description: string;
  aiHint: string;
  props: Record<string, { kind: string; required?: boolean; aiHint: string }>;
  outputSchema?: unknown;
  sampleOutput?: unknown;
}

export class PieceRegistry {
  private operations = new Map<string, PieceOperation>();

  register(pieceName: string, operations: PieceOperation[]): void {
    for (const op of operations) {
      this.operations.set(`${pieceName}:${op.kind}:${op.displayName}`, op);
    }
  }

  action(pieceName: string, _version: string, operationName: string): PieceOperation {
    const key = `${pieceName}:action:${operationName}`;
    const op = this.operations.get(key);
    if (!op) throw new Error(`UNKNOWN_ACTION:${key}`);
    return op;
  }

  trigger(pieceName: string, _version: string, operationName: string): PieceOperation {
    const key = `${pieceName}:trigger:${operationName}`;
    const op = this.operations.get(key);
    if (!op) throw new Error(`UNKNOWN_TRIGGER:${key}`);
    return op;
  }

  getTrigger(pieceName: string, operationName: string): PieceOperation {
    const key = `${pieceName}:trigger:${operationName}`;
    const op = this.operations.get(key);
    if (!op) throw new Error(`UNKNOWN_TRIGGER:${key}`);
    return op;
  }

  search(query: string): PieceOperation[] {
    const q = query.toLowerCase();
    return Array.from(this.operations.values()).filter(
      (op) =>
        op.displayName.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q) ||
        op.aiHint.toLowerCase().includes(q)
    );
  }
}

// ── ConnectionsService ──────────────────────────────────────────────────────

export type Actor = { orgId: string; projectId: string; userId: string; userEmail: string };

export class ConnectionsService {
  constructor(
    private readonly getConnections: (orgId: string, projectId: string, pieceName: string) => Promise<ConnectionRow[]>,
    private readonly getConnById: (orgId: string, id: string) => Promise<ConnectionRow | null>,
    private readonly decrypt: (orgId: string, connectionId: string) => Promise<Record<string, unknown>>,
  ) {}

  async loadForExecution(orgId: string, connectionId: string): Promise<{ pieceName: string; auth: Record<string, unknown> }> {
    const row = await this.getConnById(orgId, connectionId);
    if (!row) throw new Error("CONNECTION_REQUIRED");
    if (row.status !== "active") throw new Error("CONNECTION_EXPIRED");
    const auth = await this.decrypt(orgId, connectionId);
    return { pieceName: row.piece_name, auth };
  }

  async pickForCopilot(
    orgId: string,
    projectId: string,
    userEmail: string,
    pieceName: string
  ): Promise<{ needsHuman: true; connection: null } | { needsHuman: false; connection: ConnectionRow }> {
    const candidates = await this.getConnections(orgId, projectId, pieceName);
    if (!candidates.length) return { needsHuman: true, connection: null };
    const email = userEmail.toLowerCase();
    const exact = candidates.find((c) => c.account_email?.toLowerCase() === email);
    const chosen = exact ?? candidates[0];
    return { needsHuman: false, connection: chosen };
  }
}

// ── FlowsService ────────────────────────────────────────────────────────────

export class FlowsService {
  constructor(
    private readonly getFlow: (orgId: string, flowId: string) => Promise<FlowRow | null>,
    private readonly updateDraft: (orgId: string, flowId: string, definition: Record<string, unknown>) => Promise<void>,
    private readonly insertVersion: (input: {
      orgId: string;
      flowId: string;
      definition: Record<string, unknown>;
      definitionHash: string;
      versionNumber: number;
      publishedBy: string;
    }) => Promise<FlowVersionRow>,
    private readonly setPublished: (orgId: string, flowId: string, versionId: string) => Promise<void>,
    private readonly validator: FlowValidator,
  ) {}

  async saveDraft(orgId: string, flowId: string, definition: unknown) {
    const parsed = safeParseFlowDefinition(definition);
    if (!parsed.success) {
      throw new Error(JSON.stringify({ code: "AI_SCHEMA_INVALID", errors: parsed.error }));
    }
    const issues = await this.validator.lint(orgId, parsed.data);
    await this.updateDraft(orgId, flowId, parsed.data);
    return { issues };
  }

  async publish(orgId: string, flowId: string, userId: string): Promise<FlowVersionRow> {
    const flow = await this.getFlow(orgId, flowId);
    if (!flow) throw new Error("FLOW_NOT_FOUND");
    const parsed = safeParseFlowDefinition(flow.draft_definition);
    if (!parsed.success) throw new Error("AI_SCHEMA_INVALID");
    const issues = await this.validator.lint(orgId, parsed.data);
    const blocking = issues.filter((i) => i.severity === "error");
    if (blocking.length) throw new Error(JSON.stringify({ code: "NOT_PUBLISHABLE", blocking }));
    const defHash = definitionHash(parsed.data);
    const version = await this.insertVersion({
      orgId,
      flowId,
      definition: parsed.data,
      definitionHash: defHash,
      versionNumber: 1,
      publishedBy: userId,
    });
    await this.setPublished(orgId, flowId, version.id);
    return version;
  }
}

// ── FlowValidator ───────────────────────────────────────────────────────────

export type Issue = {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
  stepId?: string;
};

export class FlowValidator {
  constructor(
    private readonly registry: PieceRegistry,
    private readonly getConnById: (orgId: string, id: string) => Promise<ConnectionRow | null>,
  ) {}

  async lint(orgId: string, definition: TFlowDefinition): Promise<Issue[]> {
    const issues: Issue[] = [];
    const allIds = new Set<string>();

    // Validate trigger
    const trigger = definition.trigger;
    if (trigger.type === "app_event" || trigger.type === "schedule") {
      if (trigger.type === "app_event") {
        if (!trigger.connectionId) {
          issues.push(this.issue("CONNECTION_REQUIRED", "trigger", "A connection is required for app_event triggers."));
        }
      }
    }

    // Walk steps
    await this.walkSteps(orgId, definition.steps, "steps", new Set(), allIds, issues);

    // Check for duplicate IDs
    for (const step of definition.steps) {
      if (allIds.has(step.id)) {
        issues.push(this.issue("CYCLE_DETECTED", `steps.${step.id}`, `Duplicate step ID: ${step.id}`));
      }
      allIds.add(step.id);
    }

    return issues;
  }

  private async walkSteps(
    orgId: string,
    steps: Step[],
    base: string,
    seen: Set<string>,
    allIds: Set<string>,
    issues: Issue[],
  ): Promise<void> {
    for (const [index, step] of steps.entries()) {
      const path = `${base}[${index}]`;
      if (step.type === "piece_action") {
        if (!step.connectionId) {
          issues.push(this.issue("CONNECTION_REQUIRED", `${path}.connectionId`, `Connection required for ${step.piece?.name ?? "piece"}.`));
        }
      }
      if (step.type === "branch") {
        if (step.onTrue?.length === 0 || step.onFalse?.length === 0) {
          issues.push(this.issue("EMPTY_BRANCH", path, "Both branch paths must have at least one step."));
        }
      }
      if (step.type === "router") {
        for (const branch of step.branches ?? []) {
          if (branch.steps.length === 0) {
            issues.push(this.issue("EMPTY_BRANCH", `${path}.branches.${branch.id}`, "Router branch cannot be empty."));
          }
        }
      }
    }
  }

  private issue(code: string, path: string, message: string): Issue {
    return { severity: "error", code, path, message };
  }
}

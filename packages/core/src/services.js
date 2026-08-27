"use strict";
// ============================================================================
// Orchestra Part 5 — Core Services
// Source of truth: Part 5 § "PieceRegistry, ConnectionsService, FlowsService, FlowValidator"
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowValidator = exports.FlowsService = exports.ConnectionsService = exports.PieceRegistry = void 0;
const flow_schema_1 = require("./flow-schema");
class PieceRegistry {
    operations = new Map();
    register(pieceName, operations) {
        for (const op of operations) {
            this.operations.set(`${pieceName}:${op.kind}:${op.displayName}`, op);
        }
    }
    action(pieceName, _version, operationName) {
        const key = `${pieceName}:action:${operationName}`;
        const op = this.operations.get(key);
        if (!op)
            throw new Error(`UNKNOWN_ACTION:${key}`);
        return op;
    }
    trigger(pieceName, _version, operationName) {
        const key = `${pieceName}:trigger:${operationName}`;
        const op = this.operations.get(key);
        if (!op)
            throw new Error(`UNKNOWN_TRIGGER:${key}`);
        return op;
    }
    getTrigger(pieceName, operationName) {
        const key = `${pieceName}:trigger:${operationName}`;
        const op = this.operations.get(key);
        if (!op)
            throw new Error(`UNKNOWN_TRIGGER:${key}`);
        return op;
    }
    search(query) {
        const q = query.toLowerCase();
        return Array.from(this.operations.values()).filter((op) => op.displayName.toLowerCase().includes(q) ||
            op.description.toLowerCase().includes(q) ||
            op.aiHint.toLowerCase().includes(q));
    }
}
exports.PieceRegistry = PieceRegistry;
class ConnectionsService {
    getConnections;
    getConnById;
    decrypt;
    constructor(getConnections, getConnById, decrypt) {
        this.getConnections = getConnections;
        this.getConnById = getConnById;
        this.decrypt = decrypt;
    }
    async loadForExecution(orgId, connectionId) {
        const row = await this.getConnById(orgId, connectionId);
        if (!row)
            throw new Error("CONNECTION_REQUIRED");
        if (row.status !== "active")
            throw new Error("CONNECTION_EXPIRED");
        const auth = await this.decrypt(orgId, connectionId);
        return { pieceName: row.piece_name, auth };
    }
    async pickForCopilot(orgId, projectId, userEmail, pieceName) {
        const candidates = await this.getConnections(orgId, projectId, pieceName);
        if (!candidates.length)
            return { needsHuman: true, connection: null };
        const email = userEmail.toLowerCase();
        const exact = candidates.find((c) => c.account_email?.toLowerCase() === email);
        const chosen = exact ?? candidates[0];
        return { needsHuman: false, connection: chosen };
    }
}
exports.ConnectionsService = ConnectionsService;
// ── FlowsService ────────────────────────────────────────────────────────────
class FlowsService {
    getFlow;
    updateDraft;
    insertVersion;
    setPublished;
    validator;
    constructor(getFlow, updateDraft, insertVersion, setPublished, validator) {
        this.getFlow = getFlow;
        this.updateDraft = updateDraft;
        this.insertVersion = insertVersion;
        this.setPublished = setPublished;
        this.validator = validator;
    }
    async saveDraft(orgId, flowId, definition) {
        const parsed = (0, flow_schema_1.safeParseFlowDefinition)(definition);
        if (!parsed.success) {
            throw new Error(JSON.stringify({ code: "AI_SCHEMA_INVALID", errors: parsed.error }));
        }
        const issues = await this.validator.lint(orgId, parsed.data);
        await this.updateDraft(orgId, flowId, parsed.data);
        return { issues };
    }
    async publish(orgId, flowId, userId) {
        const flow = await this.getFlow(orgId, flowId);
        if (!flow)
            throw new Error("FLOW_NOT_FOUND");
        const parsed = (0, flow_schema_1.safeParseFlowDefinition)(flow.draft_definition);
        if (!parsed.success)
            throw new Error("AI_SCHEMA_INVALID");
        const issues = await this.validator.lint(orgId, parsed.data);
        const blocking = issues.filter((i) => i.severity === "error");
        if (blocking.length)
            throw new Error(JSON.stringify({ code: "NOT_PUBLISHABLE", blocking }));
        const defHash = (0, flow_schema_1.definitionHash)(parsed.data);
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
exports.FlowsService = FlowsService;
class FlowValidator {
    registry;
    getConnById;
    constructor(registry, getConnById) {
        this.registry = registry;
        this.getConnById = getConnById;
    }
    async lint(orgId, definition) {
        const issues = [];
        const allIds = new Set();
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
    async walkSteps(orgId, steps, base, seen, allIds, issues) {
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
    issue(code, path, message) {
        return { severity: "error", code, path, message };
    }
}
exports.FlowValidator = FlowValidator;

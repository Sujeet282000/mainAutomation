"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphToFlowDefinition = graphToFlowDefinition;
exports.flowDefinitionToGraph = flowDefinitionToGraph;
exports.coerceWorkflowGraph = coerceWorkflowGraph;
const shared_1 = require("@algoverge/shared");
const flow_schema_1 = require("./flow-schema");
const GRAPH_TO_FLOW_OP = {
    equals: "eq",
    not_equals: "neq",
    contains: "contains",
    not_contains: "not_contains",
    starts_with: "starts_with",
    ends_with: "ends_with",
    gt: "gt",
    lt: "lt",
    gte: "gte",
    lte: "lte",
    exists: "exists",
    not_exists: "not_exists",
    empty: "not_exists",
    not_empty: "exists",
    eq: "eq",
    neq: "neq"
};
const FLOW_TO_GRAPH_OP = {
    eq: "equals",
    neq: "not_equals"
};
function conditionFromNode(config) {
    const mapped = GRAPH_TO_FLOW_OP[String(config.operator ?? "equals")] ?? "eq";
    const validOps = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with", "exists", "not_exists", "matches", "in", "not_in", "is_empty", "is_not_empty"];
    const op = validOps.includes(mapped) ? mapped : "eq";
    return {
        op,
        left: config.left ?? "",
        right: config.right
    };
}
function isUuid(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function connectionRef(node) {
    return isUuid(node.connectionId) ? node.connectionId : null;
}
function triggerFromNode(node) {
    const props = node.config ?? {};
    if (node.appSlug === "webhook") {
        return { id: "trigger", type: "webhook", props: { authMode: props.secret ? "hmac" : "none" } };
    }
    if (node.appSlug === "schedule") {
        return {
            id: "trigger",
            type: "schedule",
            props: { expression: String(props.cron ?? props.expression ?? "0 * * * *"), timezone: String(props.timezone ?? "UTC") }
        };
    }
    if (node.appSlug === "forms") {
        return { id: "trigger", type: "form", props: { fields: Array.isArray(props.fields) ? props.fields : [] } };
    }
    if (node.appSlug === "manual" || !node.appSlug) {
        return { id: "trigger", type: "manual", props };
    }
    // Default: app_event trigger
    return {
        id: "trigger",
        type: "app_event",
        piece: { name: node.appSlug, version: "*" },
        operation: node.operation || "trigger",
        connectionId: connectionRef(node),
        props
    };
}
function childrenOf(graph, nodeId, handle) {
    return graph.edges
        .filter((e) => e.source === nodeId && (handle == null || e.sourceHandle === handle || (!e.sourceHandle && !handle)))
        .map((e) => graph.nodes.find((n) => n.id === e.target))
        .filter((n) => Boolean(n));
}
function aiOperation(op) {
    if (op.includes("summar"))
        return "summarize";
    if (op.includes("classif"))
        return "classify";
    if (op.includes("extract"))
        return "extract";
    if (op.includes("vision") || op.includes("image"))
        return "vision";
    if (op.includes("transcrib"))
        return "transcribe";
    if (op.includes("embed"))
        return "embed";
    return "generate";
}
function stepFromNode(graph, node, visiting) {
    if (visiting.has(node.id)) {
        return {
            id: node.id,
            type: "filter",
            condition: { op: "eq", left: "1", right: "1" }
        };
    }
    visiting.add(node.id);
    const props = node.config ?? {};
    const connectionId = connectionRef(node);
    if (node.appSlug === "filter") {
        return { id: node.id, name: node.label, type: "filter", condition: conditionFromNode(props), connectionId: null };
    }
    if (node.appSlug === "paths" && node.operation === "branch") {
        return {
            id: node.id,
            name: node.label,
            type: "branch",
            condition: conditionFromNode(props),
            onTrue: childrenOf(graph, node.id, "true").map((n) => stepFromNode(graph, n, visiting)),
            onFalse: childrenOf(graph, node.id, "false").map((n) => stepFromNode(graph, n, visiting))
        };
    }
    if (node.appSlug === "paths") {
        return {
            id: node.id,
            name: node.label,
            type: "router",
            branches: [
                {
                    id: "path-a",
                    label: "Path A",
                    condition: conditionFromNode(props),
                    steps: childrenOf(graph, node.id, "path-a").map((n) => stepFromNode(graph, n, visiting))
                },
                {
                    id: "path-b",
                    label: "Default",
                    default: true,
                    steps: childrenOf(graph, node.id, "path-b").map((n) => stepFromNode(graph, n, visiting))
                }
            ]
        };
    }
    if (node.appSlug === "loop") {
        return {
            id: node.id,
            name: node.label,
            type: "loop",
            props: { items: String(props.items ?? "{{trigger.items}}"), concurrency: Number(props.concurrency ?? 1) },
            steps: childrenOf(graph, node.id).map((n) => stepFromNode(graph, n, visiting))
        };
    }
    if (node.appSlug === "delay") {
        return {
            id: node.id,
            name: node.label,
            type: "delay",
            props: node.operation === "until"
                ? { mode: "until", untilIso: String(props.at ?? "") }
                : { mode: "duration", seconds: Number(props.amount ?? 1) }
        };
    }
    if (node.appSlug === "approval") {
        return {
            id: node.id,
            name: node.label,
            type: "approval",
            props: {
                title: String(props.title ?? node.label ?? "Approval required"),
                timeoutHours: Number(props.timeoutHours ?? 72),
                onTimeout: "reject"
            }
        };
    }
    if (node.appSlug === "http" || (node.appSlug === "webhook" && node.operation === "send_hook")) {
        return {
            id: node.id,
            name: node.label,
            type: "http",
            props: {
                method: String(props.method ?? "POST").toUpperCase(),
                url: String(props.url ?? ""),
                headers: props.headers ?? {},
                body: props.body,
                timeoutMs: Number(props.timeoutMs ?? 30000)
            }
        };
    }
    if (["openai", "anthropic", "gemini", "ai"].includes(node.appSlug)) {
        return {
            id: node.id,
            name: node.label,
            type: "ai",
            props: {
                model: String(props.model ?? "auto"),
                operation: aiOperation(node.operation),
                input: props.input ?? "{{trigger}}",
            }
        };
    }
    if (node.appSlug === "code") {
        return {
            id: node.id,
            name: node.label,
            type: "code",
            props: {
                language: "js",
                source: String(props.source ?? props.code ?? ""),
                inputs: props.inputs ?? {},
                timeoutMs: Number(props.timeoutMs ?? 15000)
            }
        };
    }
    if (node.appSlug === "tables") {
        const op = node.operation.includes("update")
            ? "update"
            : node.operation.includes("delete")
                ? "delete"
                : node.operation.includes("find") || node.operation.includes("get")
                    ? "find"
                    : "create";
        return {
            id: node.id,
            name: node.label,
            type: "table_op",
            props: { tableId: String(props.tableId ?? ""), operation: op, data: props }
        };
    }
    if (node.appSlug === "subflow") {
        return {
            id: node.id,
            name: node.label,
            type: "subflow",
            props: {
                flowId: String(props.automationId ?? props.flowId ?? ""),
                input: props.payload ?? {},
                waitForCompletion: true
            }
        };
    }
    if (node.appSlug === "forms" && node.type !== "trigger") {
        return { id: node.id, name: node.label, type: "note", props: { markdown: JSON.stringify(props) } };
    }
    if (node.appSlug === "agents" || node.operation === "run_agent") {
        return {
            id: node.id,
            name: node.label,
            type: "agent",
            props: {
                instructions: String(props.instructions ?? ""),
                tools: [],
                maxIterations: Number(props.maxIterations ?? 8),
                maxCreditBudget: Number(props.maxCreditBudget ?? 50),
                input: String(props.input ?? "{{trigger}}")
            }
        };
    }
    const search = node.operation.includes("find") || node.operation.includes("search") || node.operation.includes("list");
    return {
        id: node.id,
        name: node.label,
        type: "piece_action",
        piece: { name: node.appSlug || "http", version: "*" },
        operation: node.operation || "request",
        connectionId,
        props
    };
}
function sanitizeFlowId(raw, fallback) {
    let s = String(raw || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    if (!s)
        s = fallback;
    if (!/^[a-z]/.test(s))
        s = `s_${s}`;
    return s.slice(0, 64);
}
/** Convert the builder graph into the Orchestra FlowDefinition. Nested control-flow children are inlined. */
function graphToFlowDefinition(raw) {
    const graph = structuredClone((0, shared_1.normalizeWorkflowGraph)(raw));
    const used = new Set(["trigger"]);
    const remap = new Map();
    for (const node of graph.nodes) {
        if (node.type === "trigger") {
            remap.set(node.id, "trigger");
            node.id = "trigger";
            continue;
        }
        let id = sanitizeFlowId(node.id, "step");
        let n = 2;
        while (used.has(id)) {
            id = sanitizeFlowId(`${node.id}_${n}`, `step_${n}`);
            n += 1;
        }
        used.add(id);
        remap.set(node.id, id);
        node.id = id;
    }
    for (const edge of graph.edges) {
        edge.source = remap.get(edge.source) ?? sanitizeFlowId(edge.source, "step");
        edge.target = remap.get(edge.target) ?? sanitizeFlowId(edge.target, "step");
    }
    const triggerNode = graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];
    const roots = childrenOf(graph, triggerNode.id);
    const visiting = new Set();
    const steps = roots.map((n) => stepFromNode(graph, n, visiting));
    return flow_schema_1.FlowDefinition.parse({
        schemaVersion: 1,
        trigger: triggerFromNode(triggerNode),
        steps,
        settings: {}
    });
}
function pos(i) {
    return { x: 280, y: 40 + i * 160 };
}
function graphOpFromCondition(c) {
    if (!c || c.op === "and" || c.op === "or" || c.op === "not")
        return { operator: "equals", left: "", right: "" };
    const leaf = c;
    return {
        operator: FLOW_TO_GRAPH_OP[leaf.op] ?? leaf.op,
        left: leaf.left,
        right: leaf.right
    };
}
function flattenSteps(steps, nodes, edges, parentId, handle) {
    let prev = parentId;
    let prevHandle = handle ?? null;
    for (const step of steps) {
        const node = stepToNode(step, nodes.length);
        nodes.push(node);
        edges.push({
            id: `e-${prev}-${node.id}${prevHandle ? `-${prevHandle}` : ""}`,
            source: prev,
            target: node.id,
            sourceHandle: prevHandle
        });
        if (step.type === "branch") {
            flattenSteps(step.onTrue ?? [], nodes, edges, node.id, "true");
            flattenSteps(step.onFalse ?? [], nodes, edges, node.id, "false");
            prevHandle = null;
            continue;
        }
        if (step.type === "router") {
            const branches = step.branches ?? [];
            for (const b of branches)
                flattenSteps(b.steps ?? [], nodes, edges, node.id, b.id);
            prevHandle = null;
            continue;
        }
        if (step.type === "loop") {
            flattenSteps(step.steps ?? [], nodes, edges, node.id, null);
            prevHandle = null;
            continue;
        }
        prev = node.id;
        prevHandle = null;
    }
}
function stepToNode(step, index) {
    const id = step.id;
    const name = String(step.name ?? step.type);
    if (step.type === "piece_action" || step.type === "piece_search") {
        const piece = step.piece;
        return {
            id,
            type: "action",
            appSlug: piece.name,
            operation: String(step.operation),
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: step.connectionId ?? null
        };
    }
    if (step.type === "http") {
        const p = step.props;
        return {
            id,
            type: "action",
            appSlug: "http",
            operation: "request",
            label: name,
            position: pos(index),
            config: p,
            connectionId: p.connectionId ?? null
        };
    }
    if (step.type === "ai") {
        return {
            id,
            type: "action",
            appSlug: "ai",
            operation: String(step.operation),
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: null
        };
    }
    if (step.type === "filter") {
        return {
            id,
            type: "logic",
            appSlug: "filter",
            operation: "only_continue_if",
            label: name,
            position: pos(index),
            config: graphOpFromCondition(step.condition),
            connectionId: null
        };
    }
    if (step.type === "branch") {
        return {
            id,
            type: "logic",
            appSlug: "paths",
            operation: "branch",
            label: name,
            position: pos(index),
            config: graphOpFromCondition(step.condition),
            connectionId: null
        };
    }
    if (step.type === "router") {
        return {
            id,
            type: "logic",
            appSlug: "paths",
            operation: "router",
            label: name,
            position: pos(index),
            config: {},
            connectionId: null
        };
    }
    if (step.type === "loop") {
        const p = step.props;
        return {
            id,
            type: "logic",
            appSlug: "loop",
            operation: "for_each",
            label: name,
            position: pos(index),
            config: { items: p.items, concurrency: p.concurrency },
            connectionId: null
        };
    }
    if (step.type === "delay") {
        const p = step.props;
        return {
            id,
            type: "logic",
            appSlug: "delay",
            operation: p.mode === "until" ? "until" : "for",
            label: name,
            position: pos(index),
            config: p.mode === "until" ? { at: p.untilIso } : { amount: p.seconds, unit: "seconds" },
            connectionId: null
        };
    }
    if (step.type === "approval") {
        return {
            id,
            type: "action",
            appSlug: "approval",
            operation: "wait",
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: null
        };
    }
    if (step.type === "code") {
        return {
            id,
            type: "action",
            appSlug: "code",
            operation: "run",
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: null
        };
    }
    if (step.type === "table_op") {
        const p = step.props;
        return {
            id,
            type: "action",
            appSlug: "tables",
            operation: p.op === "find" ? "find_record" : `${p.op}_record`,
            label: name,
            position: pos(index),
            config: { tableId: p.tableId, ...(typeof p.data === "object" && p.data ? p.data : {}) },
            connectionId: null
        };
    }
    if (step.type === "subflow") {
        const p = step.props;
        return {
            id,
            type: "action",
            appSlug: "subflow",
            operation: "run",
            label: name,
            position: pos(index),
            config: { automationId: p.flowId, payload: p.input },
            connectionId: null
        };
    }
    if (step.type === "agent") {
        return {
            id,
            type: "action",
            appSlug: "agents",
            operation: "run_agent",
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: null
        };
    }
    if (step.type === "form_response") {
        return {
            id,
            type: "action",
            appSlug: "forms",
            operation: "respond",
            label: name,
            position: pos(index),
            config: step.props ?? {},
            connectionId: null
        };
    }
    return {
        id,
        type: "action",
        appSlug: "http",
        operation: "request",
        label: name,
        position: pos(index),
        config: {},
        connectionId: null
    };
}
function triggerToNode(trigger) {
    if (trigger.type === "webhook") {
        return {
            id: "trigger",
            type: "trigger",
            appSlug: "webhook",
            operation: "catch_hook",
            label: "Catch Hook",
            position: pos(0),
            config: { secret: trigger.props.authMode === "hmac" ? "required" : "" },
            connectionId: null
        };
    }
    if (trigger.type === "schedule") {
        return {
            id: "trigger",
            type: "trigger",
            appSlug: "schedule",
            operation: "cron",
            label: "Schedule",
            position: pos(0),
            config: { cron: trigger.props.expression, timezone: trigger.props.timezone },
            connectionId: null
        };
    }
    if (trigger.type === "form") {
        return {
            id: "trigger",
            type: "trigger",
            appSlug: "forms",
            operation: "submitted",
            label: "Form submitted",
            position: pos(0),
            config: { fields: trigger.props.fields },
            connectionId: null
        };
    }
    if (trigger.type === "manual") {
        return {
            id: "trigger",
            type: "trigger",
            appSlug: "manual",
            operation: "button",
            label: "Manual",
            position: pos(0),
            config: trigger.props,
            connectionId: null
        };
    }
    if (trigger.type === "app_event") {
        return {
            id: "trigger",
            type: "trigger",
            appSlug: trigger.piece.name,
            operation: trigger.operation,
            label: trigger.operation,
            position: pos(0),
            config: trigger.props,
            connectionId: trigger.connectionId
        };
    }
    return {
        id: "trigger",
        type: "trigger",
        appSlug: "manual",
        operation: "button",
        label: "Trigger",
        position: pos(0),
        config: {},
        connectionId: null
    };
}
function flowDefinitionToGraph(def) {
    const nodes = [triggerToNode(def.trigger)];
    const edges = [];
    flattenSteps(def.steps, nodes, edges, "trigger");
    if (nodes.length === 1) {
        const fallback = (0, shared_1.defaultWorkflowGraph)();
        return { nodes: [nodes[0], fallback.nodes[1]], edges: fallback.edges };
    }
    return { nodes, edges };
}
function coerceWorkflowGraph(raw) {
    if (raw && typeof raw === "object" && raw.schemaVersion === 1) {
        const parsed = flow_schema_1.FlowDefinition.safeParse(raw);
        if (parsed.success)
            return flowDefinitionToGraph(parsed.data);
    }
    return (0, shared_1.normalizeWorkflowGraph)(raw);
}

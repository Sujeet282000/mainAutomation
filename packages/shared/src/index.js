"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTION_STATUSES = exports.normalizeWorkflowGraph = exports.emptyActionNode = exports.defaultWorkflowGraph = void 0;
exports.interpolate = interpolate;
exports.getPath = getPath;
exports.evaluateCondition = evaluateCondition;
var graph_1 = require("./graph");
Object.defineProperty(exports, "defaultWorkflowGraph", { enumerable: true, get: function () { return graph_1.defaultWorkflowGraph; } });
Object.defineProperty(exports, "emptyActionNode", { enumerable: true, get: function () { return graph_1.emptyActionNode; } });
Object.defineProperty(exports, "normalizeWorkflowGraph", { enumerable: true, get: function () { return graph_1.normalizeWorkflowGraph; } });
exports.EXECUTION_STATUSES = [
    "queued",
    "running",
    "waiting",
    "paused",
    "succeeded",
    "failed",
    "partially_succeeded",
    "cancelled",
    "timed_out"
];
const PATH_HEAD_ALIASES = {
    Trigger: "trigger",
    trigger: "trigger",
    Steps: "steps",
    steps: "steps",
    Vars: "vars",
    vars: "vars",
    Item: "item",
    item: "item"
};
function walkPath(root, keys) {
    return keys.reduce((acc, key) => {
        if (acc === null || acc === undefined || typeof acc !== "object")
            return undefined;
        const rec = acc;
        if (Object.prototype.hasOwnProperty.call(rec, key))
            return rec[key];
        const match = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
        return match ? rec[match] : undefined;
    }, root);
}
function interpolate(template, context) {
    if (typeof template !== "string") {
        if (Array.isArray(template))
            return template.map((v) => interpolate(v, context));
        if (template && typeof template === "object") {
            return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, interpolate(v, context)]));
        }
        return template;
    }
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path) => {
        const [head, ...pipes] = String(path).split("|").map((s) => s.trim());
        let value = getPath(context, head);
        for (const p of pipes) {
            const [fn, arg] = p.split(":");
            if (fn === "upper")
                value = String(value ?? "").toUpperCase();
            else if (fn === "lower")
                value = String(value ?? "").toLowerCase();
            else if (fn === "trim")
                value = String(value ?? "").trim();
            else if (fn === "default")
                value = value === undefined || value === null || value === "" ? arg : value;
        }
        if (value === undefined || value === null)
            return "";
        if (typeof value === "object")
            return JSON.stringify(value);
        return String(value);
    });
}
function getPath(obj, path) {
    const keys = path.split(".").map((p) => p.trim()).filter(Boolean);
    if (!keys.length)
        return undefined;
    const alias = PATH_HEAD_ALIASES[keys[0]] ?? PATH_HEAD_ALIASES[keys[0].toLowerCase()];
    if (alias) {
        const aliased = walkPath(obj, [alias, ...keys.slice(1)]);
        if (aliased !== undefined)
            return aliased;
    }
    const direct = walkPath(obj, keys);
    if (direct !== undefined)
        return direct;
    if (obj && typeof obj === "object") {
        const ctx = obj;
        if (ctx.trigger && typeof ctx.trigger === "object" && keys.length === 1) {
            const fromTrigger = walkPath(ctx.trigger, keys);
            if (fromTrigger !== undefined)
                return fromTrigger;
        }
        if (ctx.steps && typeof ctx.steps === "object") {
            const steps = ctx.steps;
            const needle = keys[0].replace(/\s+/g, "").toLowerCase();
            const stepKey = Object.keys(steps).find((k) => k.replace(/\s+/g, "").toLowerCase() === needle);
            if (stepKey)
                return keys.length === 1 ? steps[stepKey] : walkPath(steps[stepKey], keys.slice(1));
        }
    }
    return undefined;
}
function evaluateCondition(left, operator, right) {
    const l = left === undefined || left === null ? "" : String(left);
    const r = right === undefined || right === null ? "" : String(right);
    switch (operator) {
        case "equals":
            return l === r;
        case "not_equals":
            return l !== r;
        case "contains":
            return l.toLowerCase().includes(r.toLowerCase());
        case "not_contains":
            return !l.toLowerCase().includes(r.toLowerCase());
        case "starts_with":
            return l.toLowerCase().startsWith(r.toLowerCase());
        case "ends_with":
            return l.toLowerCase().endsWith(r.toLowerCase());
        case "gt":
            return Number(left) > Number(right);
        case "lt":
            return Number(left) < Number(right);
        case "gte":
            return Number(left) >= Number(right);
        case "lte":
            return Number(left) <= Number(right);
        case "exists":
            return left !== undefined && left !== null;
        case "not_exists":
            return left === undefined || left === null;
        case "empty":
            return l.length === 0;
        case "not_empty":
            return l.length > 0;
        default:
            return false;
    }
}

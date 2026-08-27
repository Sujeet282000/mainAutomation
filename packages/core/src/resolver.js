"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPath = readPath;
exports.resolveValue = resolveValue;
exports.evaluateFlowCondition = evaluateFlowCondition;
const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;
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
function walk(root, keys) {
    return keys.reduce((acc, key) => {
        if (acc === null || acc === undefined || typeof acc !== "object")
            return undefined;
        const rec = acc;
        const indexed = key.match(/^(.+?)\[(\d+)\]$/);
        if (indexed) {
            const arr = rec[indexed[1]];
            if (!Array.isArray(arr))
                return undefined;
            return arr[Number(indexed[2])];
        }
        if (Object.prototype.hasOwnProperty.call(rec, key))
            return rec[key];
        const match = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
        return match ? rec[match] : undefined;
    }, root);
}
function readPath(ctx, path) {
    const keys = path.split(".").map((p) => p.trim()).filter(Boolean);
    if (!keys.length)
        return undefined;
    const alias = PATH_HEAD_ALIASES[keys[0]] ?? PATH_HEAD_ALIASES[keys[0].toLowerCase()];
    if (alias) {
        const aliased = walk(ctx, [alias, ...keys.slice(1)]);
        if (aliased !== undefined)
            return aliased;
    }
    const direct = walk(ctx, keys);
    if (direct !== undefined)
        return direct;
    if (ctx.steps && typeof ctx.steps === "object") {
        const steps = ctx.steps;
        const needle = keys[0].replace(/\s+/g, "").toLowerCase();
        const stepKey = Object.keys(steps).find((k) => k.replace(/\s+/g, "").toLowerCase() === needle);
        if (stepKey)
            return keys.length === 1 ? steps[stepKey] : walk(steps[stepKey], keys.slice(1));
    }
    return undefined;
}
function pad(n) {
    return String(n).padStart(2, "0");
}
function formatDate(d, fmt) {
    if (Number.isNaN(d.getTime()))
        return "";
    const map = {
        YYYY: String(d.getUTCFullYear()),
        MM: pad(d.getUTCMonth() + 1),
        DD: pad(d.getUTCDate()),
        HH: pad(d.getUTCHours()),
        mm: pad(d.getUTCMinutes()),
        ss: pad(d.getUTCSeconds())
    };
    return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => map[token] ?? token);
}
const FILTERS = {
    upper: (v) => String(v ?? "").toUpperCase(),
    lower: (v) => String(v ?? "").toLowerCase(),
    trim: (v) => String(v ?? "").trim(),
    default: (v, arg) => (v === undefined || v === null || v === "" ? arg : v),
    json: (v) => JSON.stringify(v),
    number: (v) => Number(v),
    date: (v, fmt) => formatDate(new Date(String(v)), fmt ?? "YYYY-MM-DD"),
    truncate: (v, n) => String(v ?? "").slice(0, Number(n ?? 100)),
    first: (v) => (Array.isArray(v) ? v[0] : v),
    join: (v, sep) => (Array.isArray(v) ? v.join(sep ?? ", ") : v)
};
function evalToken(ctx, expr) {
    const [pathPart, ...pipes] = expr.split("|").map((s) => s.trim());
    let val = readPath(ctx, pathPart);
    for (const p of pipes) {
        const [fn, ...args] = p.split(":");
        const f = FILTERS[fn];
        if (!f)
            throw new Error(`UNKNOWN_FILTER:${fn}`);
        val = f(val, args.join(":"));
    }
    return val;
}
/** Whole-string token preserves native type. Mixed string interpolates. */
function resolveValue(value, ctx) {
    if (typeof value === "string") {
        const only = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
        if (only)
            return evalToken(ctx, only[1]);
        return value.replace(TOKEN, (_m, e) => {
            const v = evalToken(ctx, e);
            if (v === undefined || v === null)
                return "";
            return typeof v === "object" ? JSON.stringify(v) : String(v);
        });
    }
    if (Array.isArray(value))
        return value.map((v) => resolveValue(v, ctx));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]));
    }
    return value;
}
const looseEq = (a, b) => a === b || String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
function evaluateFlowCondition(c, ctx) {
    switch (c.op) {
        case "and":
            return c.operands.every((o) => evaluateFlowCondition(o, ctx));
        case "or":
            return c.operands.some((o) => evaluateFlowCondition(o, ctx));
        case "not":
            return !evaluateFlowCondition(c.operand, ctx);
    }
    const l = resolveValue(c.left, ctx);
    const r = resolveValue(c.right, ctx);
    switch (c.op) {
        case "eq":
            return looseEq(l, r);
        case "neq":
            return !looseEq(l, r);
        case "gt":
            return Number(l) > Number(r);
        case "gte":
            return Number(l) >= Number(r);
        case "lt":
            return Number(l) < Number(r);
        case "lte":
            return Number(l) <= Number(r);
        case "contains":
            return String(l).toLowerCase().includes(String(r).toLowerCase());
        case "not_contains":
            return !String(l).toLowerCase().includes(String(r).toLowerCase());
        case "starts_with":
            return String(l).startsWith(String(r));
        case "ends_with":
            return String(l).endsWith(String(r));
        case "exists":
            return l !== undefined && l !== null && l !== "";
        case "not_exists":
            return l === undefined || l === null || l === "";
        case "matches":
            return new RegExp(String(r)).test(String(l));
        case "in":
            return Array.isArray(r) && r.some((x) => looseEq(x, l));
        default:
            throw new Error(`UNKNOWN_OP:${c.op}`);
    }
}

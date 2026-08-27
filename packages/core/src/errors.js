"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineError = void 0;
exports.serialiseError = serialiseError;
class EngineError extends Error {
    category;
    retryable;
    code;
    constructor(messageOrCategory, messageOrOpts) {
        const categories = [
            "transient",
            "authentication",
            "validation",
            "fatal",
            "budget"
        ];
        const specStyle = categories.includes(messageOrCategory) && typeof messageOrOpts === "string";
        const message = specStyle ? messageOrOpts : messageOrCategory;
        const opts = specStyle
            ? { category: messageOrCategory }
            : (messageOrOpts ?? {});
        super(typeof message === "string" ? message : messageOrCategory);
        this.name = "EngineError";
        this.category = opts.category ?? "fatal";
        this.code = opts.code ?? (specStyle ? String(message).split(":")[0] : "ENGINE");
        this.retryable = opts.retryable ?? this.category === "transient";
    }
}
exports.EngineError = EngineError;
function serialiseError(err) {
    if (err instanceof EngineError) {
        return { message: err.message, code: err.code, category: err.category, retryable: err.retryable };
    }
    if (err instanceof Error)
        return { message: err.message, name: err.name };
    return { message: String(err) };
}

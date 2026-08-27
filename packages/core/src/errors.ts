export class EngineError extends Error {
  category: "transient" | "authentication" | "validation" | "fatal" | "budget";
  retryable: boolean;
  code: string;
  constructor(
    messageOrCategory: string,
    messageOrOpts?:
      | string
      | {
          category?: EngineError["category"];
          retryable?: boolean;
          code?: string;
        }
  ) {
    const categories: EngineError["category"][] = [
      "transient",
      "authentication",
      "validation",
      "fatal",
      "budget"
    ];
    const specStyle = categories.includes(messageOrCategory as EngineError["category"]) && typeof messageOrOpts === "string";
    const message = specStyle ? messageOrOpts : messageOrCategory;
    const opts = specStyle
      ? { category: messageOrCategory as EngineError["category"] }
      : ((messageOrOpts as { category?: EngineError["category"]; retryable?: boolean; code?: string }) ?? {});
    super(typeof message === "string" ? message : messageOrCategory);
    this.name = "EngineError";
    this.category = opts.category ?? "fatal";
    this.code = opts.code ?? (specStyle ? String(message).split(":")[0] : "ENGINE");
    this.retryable = opts.retryable ?? this.category === "transient";
  }
}

export function serialiseError(err: unknown) {
  if (err instanceof EngineError) {
    return { message: err.message, code: err.code, category: err.category, retryable: err.retryable };
  }
  if (err instanceof Error) return { message: err.message, name: err.name };
  return { message: String(err) };
}

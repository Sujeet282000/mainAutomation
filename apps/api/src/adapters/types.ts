export type AdapterResult = {
  output: Record<string, unknown>;
  control?: "continue" | "skip_rest" | "wait" | "branch" | "paths";
  waitMs?: number;
  hold?: boolean;
  branch?: "true" | "false";
  matchedHandles?: string[];
  loopItems?: unknown[];
};

export type AdapterContext = {
  appSlug: string;
  operation: string;
  input: Record<string, unknown>;
  auth: Record<string, unknown> | null;
  workspaceId: string;
  executionId: string;
  connectionId?: string;
  idempotencyKey?: string;
};

export type AdapterHandler = (ctx: AdapterContext) => Promise<AdapterResult>;

export type DynamicFieldsHandler = (opts: {
  operation: string;
  auth: Record<string, unknown> | null;
  input: Record<string, unknown>;
  query?: string;
  cursor?: string;
}) => Promise<Array<{ key: string; label: string; type: string; options?: { label: string; value: string; hint?: string }[] }>>;

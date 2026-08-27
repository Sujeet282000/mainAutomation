// ============================================================================
// Orchestra Part 5 — Piece SDK (packages/pieces-framework)
// Source of truth: Part 5 § "Piece SDK"
//
// The framework is a declaration layer, not a generic plugin sandbox.
// A piece declares its inputs, outputs, auth contract, side effects,
// and Copilot hints. The worker supplies a connection-derived auth value
// only while executing an operation.
// ============================================================================

import { z } from "zod";

// ── Option (for dropdowns) ──────────────────────────────────────────────────

export type Option = { label: string; value: string; disabled?: boolean };

// ── Property kinds ──────────────────────────────────────────────────────────

export type PropKind =
  | "shortText"
  | "longText"
  | "number"
  | "checkbox"
  | "staticDropdown"
  | "dynamicDropdown"
  | "json"
  | "file"
  | "array"
  | "object";

// ── Side effect classification ──────────────────────────────────────────────

export type SideEffect = "read" | "create" | "update" | "delete";

// ── HTTP client (injected by worker) ────────────────────────────────────────

export type HttpClient = {
  request<T>(input: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ status: number; headers: Headers; body: T }>;
};

// ── Key-value store (injected by worker) ────────────────────────────────────

export type KeyValueStore = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
};

// ── Prop context (for dynamic dropdowns) ────────────────────────────────────

export type PropContext<Auth = unknown> = {
  auth: Auth;
  propsValue: Record<string, unknown>;
  signal: AbortSignal;
  http?: HttpClient;
};

// ── Property definition ─────────────────────────────────────────────────────
// Every property REQUIRES an aiHint — it is the compact semantic instruction
// consumed by the Copilot catalog.

export type PropDefinition<Auth = unknown> = {
  kind: PropKind;
  displayName: string;
  description?: string;
  required?: boolean;
  aiHint: string;
  defaultValue?: unknown;
  options?: Option[];
  refresh?: (ctx: PropContext<Auth>) => Promise<Option[]>;
  item?: PropDefinition<Auth>;
  fields?: Record<string, PropDefinition<Auth>>;
};

export type Props<Auth = unknown> = Record<string, PropDefinition<Auth>>;

// ── Action context (injected by worker at execution time) ───────────────────

export type ActionContext<Auth> = PropContext<Auth> & {
  http: HttpClient;
  store: KeyValueStore;
  idempotencyKey: string;
  logger: {
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
  };
};

// ── Trigger context ─────────────────────────────────────────────────────────

export type TriggerContext<Auth> = PropContext<Auth> & {
  http: HttpClient;
  store: KeyValueStore;
  webhookUrl: string;
};

export type PollContext<Auth> = TriggerContext<Auth> & {
  cursor: unknown;
};

// ── Auth types ──────────────────────────────────────────────────────────────

export type OAuth2Auth = {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv?: string;
  pkce: true;
  accountEmail?: (auth: Record<string, unknown>) => string | undefined;
};

export type PieceAuth =
  | { type: "none" }
  | { type: "apiKey"; props: Props }
  | { type: "basic"; usernameLabel: string; passwordLabel: string }
  | OAuth2Auth
  | { type: "custom"; props: Props; validate: (auth: unknown) => Promise<void> };

// ── Action ──────────────────────────────────────────────────────────────────

export type Action<Auth> = {
  kind: "action";
  name: string;
  displayName: string;
  description: string;
  aliases: string[];
  props: Props<Auth>;
  aiHint: string;
  sampleOutput: unknown;
  outputSchema: z.ZodTypeAny;
  sideEffect: SideEffect;
  supportsIdempotency: boolean;
  run: (ctx: ActionContext<Auth>) => Promise<unknown>;
};

// ── Trigger ─────────────────────────────────────────────────────────────────

export type Trigger<Auth> = {
  kind: "trigger";
  name: string;
  displayName: string;
  description: string;
  aliases: string[];
  props: Props<Auth>;
  aiHint: string;
  sampleOutput: unknown;
  outputSchema: z.ZodTypeAny;
  type: "webhook" | "polling";
  onEnable?: (ctx: TriggerContext<Auth>) => Promise<void>;
  onDisable?: (ctx: TriggerContext<Auth>) => Promise<void>;
  onWebhook?: (
    ctx: TriggerContext<Auth> & { payload: unknown }
  ) => Promise<unknown[]>;
  poll?: (
    ctx: PollContext<Auth>
  ) => Promise<{ items: unknown[]; cursor: unknown }>;
};

// ── Piece ───────────────────────────────────────────────────────────────────

export type Piece<Auth> = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  categories: string[];
  auth: PieceAuth;
  actions: Action<Auth>[];
  triggers: Trigger<Auth>[];
};

// ── Factory functions ───────────────────────────────────────────────────────

export const createPiece = <Auth>(piece: Piece<Auth>): Piece<Auth> => piece;
export const createAction = <Auth>(action: Action<Auth>): Action<Auth> => action;
export const createTrigger = <Auth>(trigger: Trigger<Auth>): Trigger<Auth> => trigger;

// ── Property helpers (enforce aiHint requirement) ──────────────────────────

function prop<Auth>(
  kind: PropKind,
  value: Omit<PropDefinition<Auth>, "kind">
): PropDefinition<Auth> {
  if (!value.aiHint.trim()) throw new Error("PROP_AI_HINT_REQUIRED");
  return { kind, ...value };
}

export const shortText = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("shortText", value);

export const longText = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("longText", value);

export const number = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("number", value);

export const checkbox = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("checkbox", value);

export const staticDropdown = <A>(
  value: Omit<PropDefinition<A>, "kind" | "refresh">
): PropDefinition<A> => prop("staticDropdown", value);

export const dynamicDropdown = <A>(
  value: Omit<PropDefinition<A>, "kind" | "options">
): PropDefinition<A> => prop("dynamicDropdown", value);

export const json = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("json", value);

export const file = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("file", value);

export const array = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("array", value);

export const object = <A>(
  value: Omit<PropDefinition<A>, "kind">
): PropDefinition<A> => prop("object", value);

// ── Auth helpers ────────────────────────────────────────────────────────────

export const auth = {
  none: (): PieceAuth => ({ type: "none" }),
  apiKey: (props: Props): PieceAuth => ({ type: "apiKey", props }),
  basic: (usernameLabel: string, passwordLabel: string): PieceAuth => ({
    type: "basic",
    usernameLabel,
    passwordLabel,
  }),
  oauth2: (
    value: Omit<OAuth2Auth, "type" | "pkce">
  ): OAuth2Auth => ({ type: "oauth2", pkce: true, ...value }),
  custom: (
    props: Props,
    validate: (value: unknown) => Promise<void>
  ): PieceAuth => ({ type: "custom", props, validate }),
};

// ── Catalog metadata export ─────────────────────────────────────────────────
// Normalizes piece operations into the shape stored in piece_operations

export type PieceOperationRow = {
  piece_name: string;
  piece_version: string;
  operation_id: string;
  operation_kind: string;
  display_name: string;
  description: string;
  metadata: Record<string, unknown>;
  text: string;
};

export class PieceMetadataExporter {
  export(piece: Piece<unknown>): PieceOperationRow[] {
    const operations = [...piece.triggers, ...piece.actions];
    return operations.map((operation) => {
      const operationId = `${piece.name}:${operation.kind}:${operation.name}`;
      const props = Object.entries(operation.props).map(([name, value]) => ({
        name,
        kind: value.kind,
        required: Boolean(value.required),
        aiHint: value.aiHint,
      }));

      const metadata: Record<string, unknown> = {
        aliases: operation.aliases,
        props,
        outputSchema: (operation.outputSchema as any)._def?.typeName,
        sampleOutput: operation.sampleOutput,
        ...(operation.kind === "action"
          ? {
              sideEffect: (operation as Action<unknown>).sideEffect,
              supportsIdempotency: (operation as Action<unknown>)
                .supportsIdempotency,
            }
          : { triggerType: (operation as Trigger<unknown>).type }),
      };

      const text = [
        `${piece.displayName} ${operation.kind}: ${operation.displayName}.`,
        operation.description,
        operation.aiHint,
        `Aliases: ${operation.aliases.join(", ")}.`,
        `Inputs: ${props.map((item) => `${item.name}: ${item.aiHint}`).join(" ")}`,
      ].join(" ");

      return {
        piece_name: piece.name,
        piece_version: piece.version,
        operation_id: operationId,
        operation_kind: operation.kind,
        display_name: operation.displayName,
        description: operation.description,
        metadata,
        text,
      };
    });
  }
}

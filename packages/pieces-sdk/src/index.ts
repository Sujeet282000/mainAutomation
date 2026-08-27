import { z } from "zod";

export type AuthType = "oauth2" | "api_key" | "basic" | "custom" | "none";

export interface PropDef {
  kind:
    | "shortText"
    | "longText"
    | "number"
    | "checkbox"
    | "dropdown"
    | "multiSelect"
    | "json"
    | "file"
    | "dateTime";
  displayName: string;
  description?: string;
  required?: boolean;
  refreshers?: string[];
  options?: (ctx: PropContext) => Promise<Array<{ label: string; value: unknown }>>;
  aiHint?: string;
}

export interface PropContext {
  auth: unknown;
  propsValue: Record<string, unknown>;
}

export interface HttpClient {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  post(url: string, init?: { headers?: Record<string, string>; body?: unknown }): Promise<unknown>;
}

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface ActionContext<A = unknown> {
  auth: A;
  propsValue: Record<string, unknown>;
  http: HttpClient;
  idempotencyKey: string;
  store: KeyValueStore;
  logger: { info(m: string, meta?: unknown): void; warn(m: string, meta?: unknown): void };
}

export type SideEffect = "read" | "create" | "update" | "delete";

export interface ActionDef<A = unknown> {
  name: string;
  displayName: string;
  description: string;
  aliases?: string[];
  props: Record<string, PropDef>;
  outputSchema?: z.ZodTypeAny;
  sideEffect: SideEffect;
  run(ctx: ActionContext<A>): Promise<unknown>;
}

export interface TriggerLifecycleContext<A = unknown> {
  auth: A;
  webhookUrl: string;
  propsValue: Record<string, unknown>;
  store: KeyValueStore;
}

export interface WebhookContext<A = unknown> {
  auth: A;
  payload: unknown;
  headers: Record<string, string>;
}

export interface PollContext<A = unknown> {
  auth: A;
  propsValue: Record<string, unknown>;
  cursor: unknown;
}

export interface TriggerDef<A = unknown> {
  name: string;
  displayName: string;
  description: string;
  aliases?: string[];
  type: "webhook" | "polling";
  props: Record<string, PropDef>;
  sampleOutput?: unknown;
  onEnable?(ctx: TriggerLifecycleContext<A>): Promise<void>;
  onDisable?(ctx: TriggerLifecycleContext<A>): Promise<void>;
  onWebhook?(ctx: WebhookContext<A>): Promise<unknown[]>;
  poll?(ctx: PollContext<A>): Promise<{ items: unknown[]; cursor: unknown }>;
}

export interface PieceDef {
  name: string;
  displayName: string;
  version: string;
  categories: string[];
  description: string;
  auth: {
    type: AuthType;
    props?: Record<string, PropDef>;
    scopes?: string[];
    authUrl?: string;
    tokenUrl?: string;
    validate?: (auth: unknown) => Promise<boolean>;
  };
  triggers: TriggerDef[];
  actions: ActionDef[];
}

export const createPiece = (d: PieceDef): PieceDef => d;
export const createAction = <A>(d: ActionDef<A>): ActionDef<A> => d;
export const createTrigger = <A>(d: TriggerDef<A>): TriggerDef<A> => d;

export const Property = {
  ShortText: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "shortText", ...o }),
  LongText: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "longText", ...o }),
  Number: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "number", ...o }),
  Checkbox: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "checkbox", ...o }),
  Dropdown: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "dropdown", ...o }),
  MultiSelect: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "multiSelect", ...o }),
  Json: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "json", ...o }),
  File: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "file", ...o }),
  DateTime: (o: Omit<PropDef, "kind">): PropDef => ({ kind: "dateTime", ...o })
};

export async function createHttpClient(opts: { idempotencyKey: string; extraHeaders?: Record<string, string> }): Promise<HttpClient> {
  const send = async (method: string, url: string, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const headers = {
      "content-type": "application/json",
      "X-Idempotency-Key": opts.idempotencyKey,
      ...opts.extraHeaders,
      ...init?.headers
    };
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(init?.body ?? {})
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return {
    get: (url, init) => send("GET", url, init),
    post: (url, init) => send("POST", url, init)
  };
}

export function inferSideEffect(operation: string): SideEffect {
  if (/delete|remove|destroy/i.test(operation)) return "delete";
  if (/update|patch|replace/i.test(operation)) return "update";
  if (/create|send|post|append|insert|write/i.test(operation)) return "create";
  return "read";
}

import type { AdapterHandler, AdapterResult, DynamicFieldsHandler } from "./types";

const handlers = new Map<string, AdapterHandler>();
const dynamicFields = new Map<string, DynamicFieldsHandler>();

export function registerAdapter(appSlug: string, operation: string, handler: AdapterHandler) {
  handlers.set(`${appSlug}:${operation}`, handler);
}

export function registerDynamicFields(appSlug: string, handler: DynamicFieldsHandler) {
  dynamicFields.set(appSlug, handler);
}

export function getDynamicFieldsHandler(appSlug: string) {
  return dynamicFields.get(appSlug);
}

export function registerAppAdapter(appSlug: string, handler: AdapterHandler) {
  handlers.set(`${appSlug}:*`, handler);
}

export function getAdapter(appSlug: string, operation: string): AdapterHandler | undefined {
  return handlers.get(`${appSlug}:${operation}`) ?? handlers.get(`${appSlug}:*`);
}

export function listRegisteredAdapters() {
  return [...handlers.keys()].sort();
}

export async function dispatchAdapter(opts: {
  appSlug: string;
  operation: string;
  input: Record<string, unknown>;
  auth: Record<string, unknown> | null;
  workspaceId: string;
  executionId: string;
  connectionId?: string;
  idempotencyKey?: string;
}): Promise<AdapterResult> {
  const handler = getAdapter(opts.appSlug, opts.operation);
  if (!handler) {
    throw new Error(
      `No live adapter for ${opts.appSlug}.${opts.operation}. Connect the app or add a manifest handler — this step will not silently succeed.`
    );
  }
  return handler(opts);
}

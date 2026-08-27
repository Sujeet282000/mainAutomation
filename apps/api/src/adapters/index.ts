import "./core";
import "./google";
import "./whatsapp";
import "./stripe";
import "./ai";
import "./apps";
import "./tools";
import { registerCatalogFallbacks } from "./generic";
import { dispatchAdapter } from "./registry";
import type { AdapterResult } from "./types";

registerCatalogFallbacks();

export type { AdapterResult } from "./types";
export { listRegisteredAdapters, getDynamicFieldsHandler } from "./registry";
export { googleDynamicFields, testGoogleConnection } from "./google";
export { testOpenAiConnection } from "./ai";

export async function runAdapter(opts: {
  appSlug: string;
  operation: string;
  input: Record<string, unknown>;
  auth: Record<string, unknown> | null;
  workspaceId: string;
  executionId: string;
  connectionId?: string;
  idempotencyKey?: string;
}): Promise<AdapterResult> {
  return dispatchAdapter(opts);
}

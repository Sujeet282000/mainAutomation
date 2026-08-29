import { APP_CATALOG } from "../catalog/catalog";
import { getAdapter, registerAdapter } from "./registry";
import { authHeaders, requireOk } from "./http";
import type { AdapterResult } from "./types";

async function httpJson(url: string, auth: Record<string, unknown> | null, body: unknown): Promise<AdapterResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  return { output: await requireOk(res, "HTTP") };
}

export function registerCatalogFallbacks() {
  for (const app of APP_CATALOG) {
    for (const op of app.operations) {
      if (getAdapter(app.slug, op.key)) continue;
      if (op.type === "trigger") {
        registerAdapter(app.slug, op.key, async ({ input }) => ({ output: input }));
        continue;
      }
      registerAdapter(app.slug, op.key, async ({ input, auth }) => {
        const url = String(input.url ?? input.webhookUrl ?? input.endpoint ?? "");
        if (url.startsWith("http://") || url.startsWith("https://")) {
          return httpJson(url, auth, input.body ?? input);
        }
        throw new Error(
          `No native live adapter for ${app.slug}.${op.key} yet. Map a webhook URL / HTTP Request, or use a first-party app with a dedicated adapter. Copilot still drafted this catalog step.`
        );
      });
    }
  }
}

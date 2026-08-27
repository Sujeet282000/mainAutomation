import { createAction, createPiece, Property } from "@algoverge/pieces-sdk";
import { z } from "zod";

export const httpRequest = createAction({
  name: "request",
  displayName: "Custom Request",
  description: "Call any HTTP endpoint with method, headers, and body.",
  aliases: ["http request", "webhook call", "rest api"],
  sideEffect: "create",
  props: {
    method: Property.Dropdown({
      displayName: "Method",
      required: true,
      options: async () =>
        ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ label: m, value: m }))
    }),
    url: Property.ShortText({ displayName: "URL", required: true, aiHint: "Absolute https URL." }),
    headers: Property.Json({ displayName: "Headers", required: false }),
    body: Property.Json({ displayName: "Body", required: false })
  },
  outputSchema: z.unknown(),
  async run({ propsValue, http, idempotencyKey }) {
    const method = String(propsValue.method ?? "GET");
    const url = String(propsValue.url);
    const headers = (propsValue.headers as Record<string, string> | undefined) ?? {};
    if (method === "GET") return http.get(url, { headers: { ...headers, "X-Idempotency-Key": idempotencyKey } });
    return http.post(url, {
      headers: { ...headers, "X-Idempotency-Key": idempotencyKey },
      body: propsValue.body
    });
  }
});

export const httpPiece = createPiece({
  name: "http",
  displayName: "HTTP",
  version: "1.0.0",
  categories: ["core"],
  description: "Generic HTTP client for any REST API.",
  auth: { type: "none" },
  triggers: [],
  actions: [httpRequest]
});

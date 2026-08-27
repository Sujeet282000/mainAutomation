import { needsConnection, opFields, fieldKey, type CatalogApp, type CatalogOp } from "@/lib/catalog";
import type { StepData } from "./store";

export const BUILDER_STAGES = [
  { id: "app", label: "App" },
  { id: "auth", label: "Account" },
  { id: "configure", label: "Configure" },
  { id: "map", label: "Map" },
  { id: "test", label: "Test" },
  { id: "review", label: "Review" },
  { id: "publish", label: "Publish" }
] as const;

export type BuilderStageId = (typeof BUILDER_STAGES)[number]["id"];

export function mappingComplete(data: StepData, op?: CatalogOp) {
  if (!data.operation || !op) return false;
  const fields = opFields(op).filter((f) => f.required);
  if (!fields.length) return true;
  return fields.every((f) => String(data.config[fieldKey(f)] ?? "").trim() !== "");
}

export function builderStageState(opts: {
  data?: StepData;
  app?: CatalogApp;
  op?: CatalogOp;
  tested?: boolean;
  publishErrors: string[];
  published: boolean;
}): Record<BuilderStageId, "done" | "current" | "blocked"> {
  const data = opts.data;
  const hasApp = Boolean(data?.appSlug && data.operation);
  const hasAuth = !opts.app || !needsConnection(opts.app) || Boolean(data?.connectionId);
  const mapped = mappingComplete(data ?? { label: "", kind: "action", appSlug: "", operation: "", config: {} }, opts.op);
  const tested = Boolean(opts.tested);
  const reviewOk = opts.publishErrors.length === 0;

  const done = {
    app: hasApp,
    auth: hasApp && hasAuth,
    configure: hasApp && hasAuth,
    map: hasApp && hasAuth && mapped,
    test: hasApp && hasAuth && mapped && tested,
    review: reviewOk && hasApp,
    publish: opts.published
  };

  const order: BuilderStageId[] = ["app", "auth", "configure", "map", "test", "review", "publish"];
  const current = order.find((id) => !done[id]) ?? "publish";
  return Object.fromEntries(
    order.map((id) => [id, done[id] ? "done" : id === current ? "current" : "blocked"])
  ) as Record<BuilderStageId, "done" | "current" | "blocked">;
}

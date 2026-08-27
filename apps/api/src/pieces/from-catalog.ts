import type { AppManifest, AppOperation, FieldDef } from "@algoverge/shared";
import {
  createAction,
  createPiece,
  createTrigger,
  inferSideEffect,
  type ActionDef,
  type PieceDef,
  type PropDef,
  type TriggerDef
} from "@algoverge/pieces-sdk";

const KIND: Record<string, PropDef["kind"]> = {
  string: "shortText",
  text: "longText",
  number: "number",
  boolean: "checkbox",
  json: "json",
  select: "dropdown",
  dynamic: "dropdown",
  code: "longText",
  datetime: "dateTime",
  file: "file",
  mapping: "json"
};

function fieldToProp(field: FieldDef): PropDef {
  return {
    kind: KIND[field.type] ?? "shortText",
    displayName: field.label,
    required: field.required,
    refreshers: field.dependsOn,
    aiHint: field.placeholder
  };
}

function propsOf(op: AppOperation): Record<string, PropDef> {
  return Object.fromEntries((op.inputFields ?? []).map((f) => [f.key, fieldToProp(f)]));
}

export function catalogAppToPiece(app: AppManifest, runAction: ActionDef["run"]): PieceDef {
  const triggers: TriggerDef[] = app.operations
    .filter((o) => o.type === "trigger")
    .map((op) =>
      createTrigger({
        name: op.key,
        displayName: op.name,
        description: op.description ?? op.name,
        aliases: [op.name, app.name],
        type: op.triggerMode === "polling" ? "polling" : "webhook",
        props: propsOf(op),
        sampleOutput: op.outputSample
      })
    );
  const actions: ActionDef[] = app.operations
    .filter((o) => o.type !== "trigger")
    .map((op) =>
      createAction({
        name: op.key,
        displayName: op.name,
        description: op.description ?? op.name,
        aliases: [op.name, `${app.name} ${op.name}`],
        props: propsOf(op),
        sideEffect: inferSideEffect(op.key),
        run: async (ctx) =>
          runAction({
            ...ctx,
            propsValue: { ...ctx.propsValue, __piece: app.slug, __operation: op.key }
          })
      })
    );
  const rawAuth = String(app.authType ?? "none");
  const authType: PieceDef["auth"]["type"] =
    rawAuth === "oauth" || rawAuth === "oauth2" ? "oauth2" : (rawAuth as PieceDef["auth"]["type"]);
  return createPiece({
    name: app.slug,
    displayName: app.name,
    version: "1.0.0",
    categories: [app.category],
    description: app.description,
    auth: { type: authType },
    triggers,
    actions
  });
}

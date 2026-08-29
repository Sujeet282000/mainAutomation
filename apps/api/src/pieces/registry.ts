import type { ActionDef, PieceDef, TriggerDef } from "@algoverge/pieces-sdk";
import { firstPartyPieces } from "@algoverge/pieces";
import { APP_CATALOG } from "../catalog/catalog";
import { catalogAppToPiece } from "./from-catalog";

export interface OperationCard {
  piece: string;
  pieceDisplay: string;
  kind: "trigger" | "action";
  operation: string;
  display: string;
  description: string;
  aliases: string[];
  sideEffect?: string;
  requiredProps: string[];
  allProps: Record<string, { type: string; hint?: string; required: boolean }>;
  outputFields: string[];
}

export class PieceRegistry {
  private pieces = new Map<string, PieceDef>();

  register(p: PieceDef) {
    this.pieces.set(`${p.name}@${p.version}`, p);
  }

  resolve(name: string, _versionRange = "*"): PieceDef {
    const match = [...this.pieces.values()]
      .filter((p) => p.name === name)
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
    if (!match) throw new Error(`PIECE_NOT_FOUND:${name}`);
    return match;
  }

  has(name: string) {
    return [...this.pieces.values()].some((p) => p.name === name);
  }

  getAction(piece: string, op: string): ActionDef {
    const a = this.resolve(piece).actions.find((x) => x.name === op);
    if (!a) throw new Error(`ACTION_NOT_FOUND:${piece}.${op}`);
    return a;
  }

  getTrigger(piece: string, op: string): TriggerDef {
    const t = this.resolve(piece).triggers.find((x) => x.name === op);
    if (!t) throw new Error(`TRIGGER_NOT_FOUND:${piece}.${op}`);
    return t;
  }

  cards(): OperationCard[] {
    const out: OperationCard[] = [];
    for (const p of this.pieces.values()) {
      const push = (kind: "trigger" | "action", d: ActionDef | TriggerDef) =>
        out.push({
          piece: p.name,
          pieceDisplay: p.displayName,
          kind,
          operation: d.name,
          display: d.displayName,
          description: d.description,
          aliases: d.aliases ?? [],
          sideEffect: "sideEffect" in d ? d.sideEffect : undefined,
          requiredProps: Object.entries(d.props ?? {})
            .filter(([, v]) => v.required)
            .map(([k]) => k),
          allProps: Object.fromEntries(
            Object.entries(d.props ?? {}).map(([k, v]) => [
              k,
              { type: v.kind, hint: v.aiHint, required: Boolean(v.required) }
            ])
          ),
          outputFields: Object.keys((("sampleOutput" in d ? d.sampleOutput : {}) ?? {}) as object)
        });
      p.triggers.forEach((t) => push("trigger", t));
      p.actions.forEach((a) => push("action", a));
    }
    return out;
  }
}

const registry = new PieceRegistry();
for (const app of APP_CATALOG) {
  registry.register(
    catalogAppToPiece(app, async () => {
      throw new Error("PIECE_RUN_VIA_TOOL_REGISTRY");
    })
  );
}
for (const piece of firstPartyPieces) {
  registry.register(piece);
}

export const pieceRegistry = registry;

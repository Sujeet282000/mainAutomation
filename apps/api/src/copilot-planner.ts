import { z } from "zod";
import { completeAi } from "./ai-runtime";
import type { WorkflowGraph } from "@algoverge/shared";

const PlannedIntent = z.object({
  summary: z.string().min(1).max(500),
  trigger: z.object({
    phrase: z.string().min(1).max(500),
    appHint: z.string().nullable().default(null),
    kind: z.enum(["app_event", "schedule", "webhook", "form", "chat", "manual"])
  }),
  steps: z.array(z.object({
    order: z.number().int().positive(),
    phrase: z.string().min(1).max(500),
    appHint: z.string().nullable().default(null),
    intentKind: z.enum(["app_action", "ai", "agent", "http", "code", "table"])
  })).max(32),
  ambiguities: z.array(z.string().min(1).max(300)).max(16).default([])
});

export type PlannedCopilotIntent = z.infer<typeof PlannedIntent>;

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
}

function normalize(intent: PlannedCopilotIntent): PlannedCopilotIntent {
  return {
    ...intent,
    steps: [...intent.steps]
      .sort((a, b) => a.order - b.order)
      .map((step, i) => ({ ...step, order: i + 1 })),
    ambiguities: [...new Set(intent.ambiguities.map((x) => x.trim()).filter(Boolean))]
  };
}

/** AI interprets intent; catalog grounding and AgentOperation validation remain authoritative. */
export async function planCopilotIntent(opts: {
  prompt: string;
  graph?: WorkflowGraph | null;
  catalog: Array<{
    piece: string;
    pieceDisplay: string;
    operation: string;
    display: string;
    kind: "trigger" | "action";
    aliases?: string[];
  }>;
}) {
  const catalog = opts.catalog.slice(0, 180).map((c) => ({
    app: c.piece,
    appName: c.pieceDisplay,
    operation: c.operation,
    operationName: c.display,
    kind: c.kind,
    aliases: c.aliases ?? []
  }));
  const currentGraph = opts.graph
    ? {
        nodes: opts.graph.nodes.map((n) => ({ id: n.id, type: n.type, appSlug: n.appSlug, operation: n.operation, label: n.label })),
        edges: opts.graph.edges
      }
    : null;

  const result = await completeAi({
    intent: "reason",
    json: true,
    prompt: JSON.stringify({ userRequest: opts.prompt, currentGraph, catalog }),
    system: [
      "You are the planning layer for a visual automation Copilot.",
      "Understand the user's goal before selecting implementation details.",
      "Return JSON only with summary, trigger, steps, ambiguities.",
      "Each step must describe one meaningful action or control-flow intent in execution order.",
      "Use intentKind=ai for summarization, classification, extraction, generation or transformation; use agent only when the user explicitly asks an autonomous agent to act.",
      "Do not invent operation identifiers. The catalog is grounding context; appHint should be null when uncertain.",
      "Ask an ambiguity only when a missing choice materially changes the workflow. Never ask for credentials, tokens, IDs, or secrets that can be selected later by the UI.",
      "Do not output chain-of-thought. summary is a short user-safe explanation."
    ].join(" ")
  });

  if (!result.text) return null;
  try {
    const parsed = PlannedIntent.safeParse(JSON.parse(extractJson(result.text)));
    return parsed.success ? normalize(parsed.data) : null;
  } catch {
    return null;
  }
}

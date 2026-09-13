import { graphToFlowDefinition as compileGraph } from "./graph-bridge";
import type { TFlowDefinition, Step } from "./flow-schema";

type Node = { id: string; type?: string; appSlug?: string; config?: Record<string, unknown> };
type Edge = { source?: string; target?: string; sourceHandle?: string | null };
type Graph = { nodes: Node[]; edges: Edge[] };

function pathConfig(node: Node) {
  const paths = node.config?.paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is Record<string, unknown> => !!p && typeof p === "object").map((p, i) => ({
    id: String(p.id ?? `path-${i + 1}`), label: String(p.label ?? `Path ${i + 1}`),
    condition: p.condition, default: p.default === true,
  }));
}

function descendants(graph: Graph, routerId: string, handle: string) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const result: Node[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id); result.push(node);
    for (const e of graph.edges) if (e.source === id) walk(e.target ?? "");
  };
  for (const e of graph.edges) if (e.source === routerId && e.sourceHandle === handle) walk(e.target ?? "");
  return result;
}

function routeSteps(graph: Graph, router: Node, handle: string): Step[] {
  const trigger = graph.nodes.find(n => n.type === "trigger");
  if (!trigger) return [];
  const nodes = descendants(graph, router.id, handle);
  const ids = new Set(nodes.map(n => n.id));
  const internal = graph.edges.filter(e => ids.has(e.source ?? "") && ids.has(e.target ?? ""));
  const roots = nodes.filter(n => !internal.some(e => e.target === n.id));
  const subgraph: Graph = {
    nodes: [trigger, ...nodes],
    edges: [...internal, ...roots.map(n => ({ source: trigger.id, target: n.id }))],
  };
  return (compileGraph(subgraph) as TFlowDefinition).steps;
}

export function expandConfiguredRouters(definition: TFlowDefinition, graph: unknown): TFlowDefinition {
  const g = graph as Graph;
  if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) return definition;
  const rawById = new Map(g.nodes.map(n => [n.id, n]));
  const expand = (steps: Step[]): Step[] => steps.map(step => {
    const s = step as any;
    if (s.type === "router") {
      const raw = rawById.get(s.id);
      const paths = raw ? pathConfig(raw) : [];
      if (paths.length) s.branches = paths.map(p => ({
        id: p.id, label: p.label, ...(p.default ? { default: true } : {}),
        ...(p.condition !== undefined ? { condition: p.condition } : {}),
        steps: routeSteps(g, raw!, p.id),
      }));
      s.branches = (s.branches ?? []).map((b: any) => ({ ...b, steps: expand(b.steps ?? []) }));
    } else if (s.type === "branch") {
      s.onTrue = expand(s.onTrue ?? []); s.onFalse = expand(s.onFalse ?? []);
    } else if (s.type === "loop") {
      s.steps = expand(s.steps ?? []);
    }
    return s as Step;
  });
  return { ...definition, steps: expand(definition.steps) };
}

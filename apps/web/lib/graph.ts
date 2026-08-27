export type GraphNode = {
  id?: string;
  type?: string;
  appSlug?: string;
  operation?: string;
  label?: string;
};

export type GraphPayload = {
  nodes?: GraphNode[];
  edges?: Array<{ source?: string; target?: string }>;
};

function slugOf(n: GraphNode) {
  return n.appSlug ?? (n as { appSlug?: string }).appSlug ?? "";
}

export function summarizeGraph(graph?: GraphPayload | null) {
  const nodes = graph?.nodes ?? [];
  const trigger = nodes.find((n) => n.type === "trigger") ?? nodes[0];
  const actions = nodes.filter((n) => n !== trigger);
  const apps = [...new Set(nodes.map((n) => slugOf(n)).filter(Boolean))];
  const triggerSlug = slugOf(trigger ?? {});
  return {
    triggerLabel: trigger?.label ?? (triggerSlug === "" ? "No trigger" : triggerSlug),
    actionLabels: actions.map((n) => n.label ?? n.operation ?? slugOf(n) ?? "Step"),
    apps,
    steps: nodes.length,
    path: nodes.map((n) => n.label ?? slugOf(n) ?? "Step").join(" → ")
  };
}

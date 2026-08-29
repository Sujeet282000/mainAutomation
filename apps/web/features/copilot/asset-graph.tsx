"use client";

import { useMemo } from "react";
import ReactFlow, { Background, BackgroundVariant, MiniMap, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Bot, Calculator, Database, FileText, Grid3X3, Layers, MessageSquare, Plug, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────────────────── */

type AssetType = "workflow" | "table" | "form" | "agent" | "chatbot" | "interface" | "canvas" | "connection" | "trigger" | "action" | "code" | "http" | "ai" | "condition" | "delay";

type AssetNode = {
  id: string;
  type: AssetType;
  label: string;
  appSlug?: string;
  description?: string;
  status?: "ready" | "pending" | "error";
};

type AssetEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: "data" | "trigger" | "dependency";
};

type AssetGraph = {
  nodes: AssetNode[];
  edges: AssetEdge[];
  summary?: string;
  confidence?: number;
};

/* ── Node styling ─────────────────────────────────────────────────────── */

const ASSET_CONFIG: Record<AssetType, { bg: string; border: string; dot: string; icon: typeof Zap; label: string }> = {
  workflow: { bg: "bg-violet-50", border: "border-violet-300", dot: "bg-violet-500", icon: Zap, label: "Workflow" },
  table: { bg: "bg-blue-50", border: "border-blue-300", dot: "bg-blue-500", icon: Database, label: "Table" },
  form: { bg: "bg-teal-50", border: "border-teal-300", dot: "bg-teal", icon: FileText, label: "Form" },
  agent: { bg: "bg-emerald-50", border: "border-emerald-300", dot: "bg-emerald-500", icon: Bot, label: "Agent" },
  chatbot: { bg: "bg-cyan-50", border: "border-cyan-300", dot: "bg-cyan-500", icon: MessageSquare, label: "Chatbot" },
  interface: { bg: "bg-orange-50", border: "border-orange-300", dot: "bg-orange-500", icon: Grid3X3, label: "Interface" },
  canvas: { bg: "bg-pink-50", border: "border-pink-300", dot: "bg-pink-500", icon: Layers, label: "Canvas" },
  connection: { bg: "bg-gray-50", border: "border-gray-300", dot: "bg-gray-400", icon: Plug, label: "Connection" },
  trigger: { bg: "bg-violet-50", border: "border-violet-300", dot: "bg-violet-500", icon: Zap, label: "Trigger" },
  action: { bg: "bg-teal-50", border: "border-teal-300", dot: "bg-teal", icon: Sparkles, label: "Action" },
  code: { bg: "bg-amber-50", border: "border-amber-300", dot: "bg-amber-500", icon: Calculator, label: "Code" },
  http: { bg: "bg-sky-50", border: "border-sky-300", dot: "bg-sky-500", icon: Zap, label: "HTTP" },
  ai: { bg: "bg-purple-50", border: "border-purple-300", dot: "bg-purple-500", icon: Bot, label: "AI" },
  condition: { bg: "bg-amber-50", border: "border-amber-300", dot: "bg-amber-500", icon: Zap, label: "Condition" },
  delay: { bg: "bg-slate-50", border: "border-slate-300", dot: "bg-slate-400", icon: Zap, label: "Delay" },
};

/* ── Custom React Flow Node ───────────────────────────────────────────── */

function AssetNodeComponent({ data, selected }: { data: AssetNode & { _config: typeof ASSET_CONFIG[AssetType] }; selected?: boolean }) {
  const cfg = data._config;
  return (
    <div className={cn(
      "w-[200px] rounded-xl border-2 px-3 py-2.5 shadow-sm transition-all",
      cfg.bg, cfg.border,
      selected && "ring-2 ring-teal ring-offset-2",
      data.status === "error" && "border-danger/50"
    )}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">{cfg.label}</span>
        {data.status === "pending" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
        {data.status === "ready" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-teal" />}
        {data.status === "error" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-danger" />}
      </div>
      <div className="text-sm font-semibold text-ink leading-tight">{data.label}</div>
      {data.appSlug && <div className="mt-1 truncate text-[10px] text-ink-muted">{data.appSlug}</div>}
      {data.description && <div className="mt-1 line-clamp-2 text-[10px] text-ink-muted">{data.description}</div>}
    </div>
  );
}

const nodeTypes = { assetNode: AssetNodeComponent };

/* ── Main component ───────────────────────────────────────────────────── */

export function AssetGraphVisualization({ graph, compact = false }: { graph: AssetGraph; compact?: boolean }) {
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = graph.nodes.map((n, i) => ({
      id: n.id,
      type: "assetNode",
      position: { x: (i % 4) * 240 + 40, y: Math.floor(i / 4) * 160 + 40 },
      data: { ...n, _config: ASSET_CONFIG[n.type] ?? ASSET_CONFIG.action },
    }));

    const rfEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: e.type === "trigger",
      style: {
        stroke: e.type === "data" ? "#14b8a6" : e.type === "trigger" ? "#8b5cf6" : "#94a3b8",
        strokeWidth: 2,
      },
      label: e.label,
      labelStyle: { fontSize: 10, fill: "#64748b" },
      labelBgStyle: { fill: "white", fillOpacity: 0.9 },
    }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph]);

  if (compact) {
    // Compact view: just show node pills in a row
    return (
      <div className="flex flex-wrap gap-2">
        {graph.nodes.map((n) => {
          const cfg = ASSET_CONFIG[n.type] ?? ASSET_CONFIG.action;
          const Icon = cfg.icon;
          return (
            <div key={n.id} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs", cfg.bg, cfg.border)}>
              <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
              <Icon className="h-3 w-3" />
              <span className="font-medium">{n.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-muted/10 overflow-hidden" style={{ height: 400 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
        <MiniMap
          className="!bottom-2 !right-2 !rounded-lg !border !border-line !bg-elevated"
          nodeColor={(n) => ASSET_CONFIG[n.data?.type as AssetType]?.dot ?? "#94a3b8"}
          maskColor="rgba(0,0,0,0.08)"
        />
      </ReactFlow>
    </div>
  );
}

/* ── Helper: Build graph from AutomationPlan ───────────────────────────── */

export function buildGraphFromPlan(plan: {
  steps?: Array<{
    id: string;
    type?: string;
    label?: string;
    appSlug?: string | null;
    description?: string;
    connectionRequired?: boolean;
    connectionId?: string | null;
    dependsOn?: string[];
  }>;
  connections?: Array<{ stepId: string; appSlug: string; connectionId: string; status: string }>;
}): AssetGraph {
  const nodes: AssetNode[] = (plan.steps ?? []).map((s) => ({
    id: s.id,
    type: (s.type as AssetType) ?? "action",
    label: s.label ?? s.id,
    appSlug: s.appSlug ?? undefined,
    description: s.description,
    status: s.connectionRequired && !s.connectionId ? "pending" : "ready",
  }));

  const edges: AssetEdge[] = [];
  for (const step of plan.steps ?? []) {
    for (const dep of step.dependsOn ?? []) {
      edges.push({
        id: `${dep}-${step.id}`,
        source: dep,
        target: step.id,
        type: "data",
      });
    }
  }

  // Add connection nodes
  const connSet = new Set<string>();
  for (const conn of plan.connections ?? []) {
    const key = `${conn.appSlug}-${conn.connectionId}`;
    if (connSet.has(key)) continue;
    connSet.add(key);
    nodes.push({
      id: `conn-${conn.connectionId}`,
      type: "connection",
      label: conn.appSlug,
      appSlug: conn.appSlug,
      status: conn.status === "connected" ? "ready" : "pending",
    });
  }

  return {
    nodes,
    edges,
  };
}

/* ── Legend ────────────────────────────────────────────────────────────── */

export function AssetGraphLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[10px] text-ink-muted">
      {(["workflow", "table", "form", "agent", "connection"] as const).map((type) => {
        const cfg = ASSET_CONFIG[type];
        const Icon = cfg.icon;
        return (
          <span key={type} className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
            <Icon className="h-2.5 w-2.5" />
            {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

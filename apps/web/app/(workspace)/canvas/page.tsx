"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useReactFlow,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { Maximize2, Network, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────────────────── */

type CanvasNodeData = {
  label: string;
  kind: "trigger" | "action" | "logic" | "text" | "table" | "form" | "agent" | "chatbot" | "interface" | "workflow";
  appSlug?: string;
  operation?: string;
  description?: string;
};

type Block = { type: string; tableId?: string | null; formId?: string | null; automationId?: string | null };

type Canvas = {
  id: string;
  name: string;
  graph: { nodes: Array<{ id: string; label: string; kind?: string; appSlug?: string; operation?: string; description?: string; x?: number; y?: number }>; edges: Array<{ id?: string; source: string; target: string; sourceHandle?: string }> };
  created_at?: string;
};

/* ── Custom Node ──────────────────────────────────────────────────────── */

const KIND_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  trigger: { bg: "bg-violet-50", border: "border-violet-300", dot: "bg-violet-500" },
  action: { bg: "bg-teal-50", border: "border-teal-300", dot: "bg-teal" },
  logic: { bg: "bg-amber-50", border: "border-amber-300", dot: "bg-amber-500" },
  text: { bg: "bg-gray-50", border: "border-gray-300", dot: "bg-gray-400" },
  table: { bg: "bg-blue-50", border: "border-blue-300", dot: "bg-blue-500" },
  form: { bg: "bg-emerald-50", border: "border-emerald-300", dot: "bg-emerald-500" },
  agent: { bg: "bg-purple-50", border: "border-purple-300", dot: "bg-purple-500" },
  chatbot: { bg: "bg-cyan-50", border: "border-cyan-300", dot: "bg-cyan-500" },
  interface: { bg: "bg-orange-50", border: "border-orange-300", dot: "bg-orange-500" },
  workflow: { bg: "bg-teal-50", border: "border-teal-300", dot: "bg-teal" },
};

function CanvasNodeComponent({ data, selected }: { data: CanvasNodeData; selected?: boolean }) {
  const colors = KIND_COLORS[data.kind] ?? KIND_COLORS.action;
  return (
    <div className={cn(
      "w-[220px] rounded-xl border-2 px-3 py-2.5 shadow-sm transition-all",
      colors.bg, colors.border,
      selected && "ring-2 ring-teal ring-offset-2"
    )}>
      {/* Handles make boxes connectable by dragging between them. */}
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400" />
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", colors.dot)} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">{data.kind}</span>
      </div>
      <div className="text-sm font-semibold text-ink">{data.label || "Untitled"}</div>
      {data.appSlug && <div className="mt-1 truncate text-[10px] text-ink-muted">{data.appSlug}{data.operation ? ` → ${data.operation}` : ""}</div>}
      {data.description && <div className="mt-1 line-clamp-2 text-[10px] text-ink-muted">{data.description}</div>}
      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400" />
    </div>
  );
}

const nodeTypes = { canvasNode: CanvasNodeComponent };

/* ── Editor (inside ReactFlowProvider) ────────────────────────────────── */

function CanvasEditor({
  canvasId, canvasName, setCanvasName, initialNodes, initialEdges, onClose, onSave, saving,
}: {
  canvasId: string;
  canvasName: string;
  setCanvasName: (n: string) => void;
  initialNodes: Node<CanvasNodeData>[];
  initialEdges: Edge[];
  onClose: () => void;
  onSave: (nodes: Node<CanvasNodeData>[], edges: Edge[]) => void;
  saving: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const { fitView } = useReactFlow();
  const router = useRouter();

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, type: "smoothstep", animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 } }, eds));
  }, [setEdges]);

  const addNode = useCallback((kind: CanvasNodeData["kind"], label: string) => {
    const id = `${kind}-${Date.now()}`;
    setNodes((nds) => [...nds, {
      id, type: "canvasNode",
      position: { x: 250, y: 100 + nds.length * 180 },
      data: { label, kind },
    }]);
  }, [setNodes]);

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-line bg-elevated px-4 py-2">
        <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
        <Network className="h-4 w-4 text-pink-500" />
        <Input className="max-w-[200px] border-transparent bg-transparent text-sm font-semibold" value={canvasName} onChange={(e) => setCanvasName(e.target.value)} />
        <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-700">Canvas</span>
        <div className="flex-1" />
        <div className="relative">
          <Button size="sm" variant="secondary" onClick={() => setShowAddMenu((v) => !v)}>
            <Plus className="mr-1 h-3 w-3" /> Add box
          </Button>
          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-line bg-elevated p-1 shadow-card">
                {(["action", "trigger", "logic", "text", "table", "form", "agent", "chatbot"] as const).map((kind) => (
                  <button key={kind} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => { addNode(kind, kind.charAt(0).toUpperCase() + kind.slice(1)); setShowAddMenu(false); }}>
                    <span className={cn("h-2 w-2 rounded-full", KIND_COLORS[kind]?.dot)} />
                    {kind.charAt(0).toUpperCase() + kind.slice(1)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={deleteSelected} title="Delete selected"><Trash2 className="h-3.5 w-3.5" /></Button>
        <Button
          size="sm"
          variant="outline"
          title="Convert this diagram into a draft workflow"
          onClick={async () => {
            try {
              // Persist the latest canvas state first so the server converts what you see.
              await new Promise<void>((resolve) => { onSave(nodes, edges); resolve(); });
              const d = await api<{ automation: { id: string } }>(`/canvases/${canvasId}/convert`, { method: "POST" });
              toast.success("Workflow created from canvas");
              router.push(`/automations/${d.automation.id}/editor`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Convert failed");
            }
          }}
        >
          <Workflow className="mr-1 h-3.5 w-3.5" /> Turn into workflow
        </Button>
        <Button size="sm" onClick={() => fitView({ padding: 0.2 })} title="Fit view"><Maximize2 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" onClick={() => onSave(nodes, edges)} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      <div className="flex-1">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode="Delete" className="bg-muted/10">
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
          <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-line !bg-elevated !shadow-md" />
          <MiniMap className="!bottom-4 !right-4 !rounded-xl !border !border-line !bg-elevated !shadow-md" nodeColor={(n) => KIND_COLORS[n.data?.kind as string]?.dot ?? "#94a3b8"} maskColor="rgba(0,0,0,0.08)" />
        </ReactFlow>
      </div>
    </div>
  );
}

/* ── System Map: live graph of real workspace assets and their links ─── */

type SystemAsset =
  | { kind: "workflow"; id: string; name: string; status?: string }
  | { kind: "table"; id: string; name: string }
  | { kind: "form"; id: string; name: string; tableId?: string | null; automationId?: string | null }
  | { kind: "interface"; id: string; name: string; pages?: Array<Block> }
  | { kind: "agent"; id: string; name: string }
  | { kind: "chatbot"; id: string; name: string; agentId?: string | null };

function SystemMap() {
  const router = useRouter();
  const autos = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string; status: string }> }>("/automations") });
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string }> }>("/tables") });
  const forms = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: Array<{ id: string; name: string; table_id?: string | null; automation_id?: string | null }> }>("/forms") });
  const ifaces = useQuery({ queryKey: ["interfaces"], queryFn: () => api<{ interfaces: Array<{ id: string; name: string; pages?: Array<Block> }> }>("/interfaces") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Array<{ id: string; name: string }> }>("/agents") });
  const bots = useQuery({ queryKey: ["chatbots"], queryFn: () => api<{ chatbots: Array<{ id: string; name: string; agent_id?: string | null }> }>("/chatbots") });

  const loading = autos.isLoading || tables.isLoading || forms.isLoading || ifaces.isLoading || agents.isLoading || bots.isLoading;
  const error = autos.error || tables.error || forms.error || ifaces.error || agents.error || bots.error;

  const { mapNodes, mapEdges } = useMemo(() => {
    const nodes: Node<CanvasNodeData>[] = [];
    const edges: Edge[] = [];
    const COL = { workflow: 0, form: 300, interface: 300, table: 600, agent: 900, chatbot: 900 } as Record<string, number>;
    const colCount: Record<string, number> = {};
    const push = (a: SystemAsset) => {
      const col = COL[a.kind] ?? 0;
      const row = colCount[col] ?? 0;
      colCount[col] = row + 1;
      nodes.push({
        id: `${a.kind}:${a.id}`, type: "canvasNode", draggable: true,
        position: { x: col, y: 40 + row * 130 },
        data: { label: a.name, kind: a.kind, description: a.kind === "workflow" && (a as { status?: string }).status === "on" ? "● live" : undefined },
      });
    };
    (autos.data?.automations ?? []).forEach((a) => push({ kind: "workflow", id: a.id, name: a.name, status: a.status }));
    (forms.data?.forms ?? []).forEach((f) => push({ kind: "form", id: f.id, name: f.name.replace(/^form:/, ""), tableId: f.table_id, automationId: f.automation_id }));
    (ifaces.data?.interfaces ?? []).forEach((i) => push({ kind: "interface", id: i.id, name: i.name, pages: i.pages }));
    (tables.data?.tables ?? []).forEach((t) => push({ kind: "table", id: t.id, name: t.name }));
    (agents.data?.agents ?? []).forEach((a) => push({ kind: "agent", id: a.id, name: a.name }));
    (bots.data?.chatbots ?? []).forEach((b) => push({ kind: "chatbot", id: b.id, name: b.name, agentId: b.agent_id }));

    const link = (srcKind: string, srcId: string, dstKind: string, dstId: string) => {
      const s = `${srcKind}:${srcId}`; const t = `${dstKind}:${dstId}`;
      if (nodes.some((n) => n.id === s) && nodes.some((n) => n.id === t)) {
        edges.push({ id: `${s}->${t}`, source: s, target: t, type: "smoothstep", animated: true, style: { stroke: "#94a3b8", strokeWidth: 1.5 } });
      }
    };
    (forms.data?.forms ?? []).forEach((f) => {
      if (f.table_id) link("form", f.id, "table", f.table_id);
      if (f.automation_id) link("form", f.id, "workflow", f.automation_id);
    });
    (ifaces.data?.interfaces ?? []).forEach((i) => {
      for (const b of i.pages ?? []) {
        if (b.type === "table" && b.tableId) link("interface", i.id, "table", b.tableId);
        if (b.type === "form" && b.formId) link("interface", i.id, "form", b.formId);
        if (b.type === "button" && b.automationId) link("interface", i.id, "workflow", b.automationId);
      }
    });
    (bots.data?.chatbots ?? []).forEach((b) => {
      if (b.agent_id) link("chatbot", b.id, "agent", b.agent_id);
    });
    return { mapNodes: nodes, mapEdges: edges };
  }, [autos.data, tables.data, forms.data, ifaces.data, agents.data, bots.data]);

  const [nodes, , onNodesChange] = useNodesState(mapNodes);
  const [, setEdges, onEdgesChange] = useEdgesState(mapEdges);
  // Re-seed when data loads.
  const [seededFor, setSeededFor] = useState("");
  const seedKey = `${mapNodes.length}-${mapEdges.length}`;
  if (seededFor !== seedKey && !loading) {
    setSeededFor(seedKey);
    nodes.splice(0, nodes.length, ...mapNodes);
    setEdges(mapEdges);
  }

  const open = useCallback(
    (_: React.MouseEvent, node: Node<CanvasNodeData>) => {
      const id = node.id.split(":")[1] ?? "";
      const dest: Record<string, string> = { workflow: `/automations/${id}/editor`, table: "/tables", form: "/forms", interface: "/interfaces", agent: "/agents", chatbot: "/chatbots" };
      router.push(dest[node.data.kind] ?? "/");
    },
    [router],
  );

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-danger">Failed to load workspace assets for the map.</p>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => { void autos.refetch(); void tables.refetch(); void forms.refetch(); void ifaces.refetch(); void agents.refetch(); void bots.refetch(); }}>
          <RefreshCw className="mr-1 h-3 w-3" /> Retry
        </Button>
      </Card>
    );
  }
  if (loading) return <p className="py-16 text-center text-sm text-ink-muted">Mapping your workspace…</p>;

  return (
    <div className="h-[calc(100vh-190px)] min-h-[480px] overflow-hidden rounded-2xl border border-line bg-muted/10">
      <ReactFlow
        nodes={nodes}
        edges={mapEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={open}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        nodesConnectable={false}
        className="bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
        <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-line !bg-elevated !shadow-md" />
        <MiniMap className="!bottom-4 !right-4 !rounded-xl !border !border-line !bg-elevated !shadow-md" nodeColor={(n) => KIND_COLORS[n.data?.kind as string]?.dot ?? "#94a3b8"} maskColor="rgba(0,0,0,0.08)" />
      </ReactFlow>
    </div>
  );
}

/* ── Page (outer shell) ───────────────────────────────────────────────── */

function CanvasPageInner() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["canvases"], queryFn: () => api<{ canvases: Canvas[] }>("/canvases") });
  const autos = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations") });
  const [mode, setMode] = useState<"map" | "canvases">("map");
  const [open, setOpen] = useState<Canvas | null>(null);
  const [createName, setCreateName] = useState("");
  const [fromZap, setFromZap] = useState("");
  const [saving, setSaving] = useState(false);

  function toRfNodes(c: Canvas): Node<CanvasNodeData>[] {
    return (c.graph?.nodes ?? []).map((n) => ({
      id: n.id, type: "canvasNode",
      position: { x: n.x ?? 80, y: n.y ?? 40 },
      data: { label: n.label, kind: (n.kind ?? "action") as CanvasNodeData["kind"], appSlug: n.appSlug, operation: n.operation, description: n.description },
    }));
  }

  function toRfEdges(c: Canvas): Edge[] {
    return (c.graph?.edges ?? []).map((e, i) => ({
      id: e.id ?? `e-${i}`, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
      type: "smoothstep", animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 },
    }));
  }

  async function handleSave(c: Canvas, nodes: Node<CanvasNodeData>[], edges: Edge[]) {
    setSaving(true);
    try {
      const graph = {
        nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, kind: n.data.kind, appSlug: n.data.appSlug, operation: n.data.operation, description: n.data.description, x: n.position.x, y: n.position.y })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
      };
      await api(`/canvases/${c.id}`, { method: "PATCH", body: JSON.stringify({ graph }) });
      qc.invalidateQueries({ queryKey: ["canvases"] });
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Canvas" description="Live system map of your workspace plus visual diagrams for planning." actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5">
            <button className={cn("rounded-md px-3 py-1.5 text-xs font-medium", mode === "map" ? "bg-muted text-ink" : "text-ink-muted")} onClick={() => setMode("map")}>System map</button>
            <button className={cn("rounded-md px-3 py-1.5 text-xs font-medium", mode === "canvases" ? "bg-muted text-ink" : "text-ink-muted")} onClick={() => setMode("canvases")}>My canvases</button>
          </div>
          <PageInfo title="Canvas" description="System map shows every workflow, table, form, agent and interface in your workspace and how they connect. Canvases are free-form diagrams for planning." tips={["Click a node in the system map to jump to that asset.", "Lines show real connections: form → table, form → workflow, interface → assets, chatbot → agent.", "Use canvases for documentation and planning."]} />
          <Button onClick={async () => {
            const name = createName.trim() || "System map";
            try {
              const d = await api<{ canvas: Canvas }>("/canvases", { method: "POST", body: JSON.stringify(fromZap ? { name, sourceAutomationId: fromZap } : { name }) });
              setCreateName(""); setFromZap(""); qc.invalidateQueries({ queryKey: ["canvases"] });
              if (d.canvas) setOpen({ ...d.canvas, graph: d.canvas.graph ?? { nodes: [], edges: [] } });
            } catch { /* handled */ }
          }}><Plus className="mr-1 h-3.5 w-3.5" />New canvas</Button>
        </div>
      } />

      {mode === "map" && <SystemMap />}

      {mode === "canvases" && !list.isLoading && !list.data?.canvases.length && (
        <EmptyState icon={<Network className="h-10 w-10" />} title="No canvases yet" description="Create a visual diagram from a workflow or start blank." />
      )}

      {mode === "canvases" && list.data?.canvases && list.data.canvases.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3">
          <Input className="max-w-[200px]" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Canvas name" />
          <select className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs" value={fromZap} onChange={(e) => setFromZap(e.target.value)}>
            <option value="">Blank canvas</option>
            {(autos.data?.automations ?? []).map((a) => <option key={a.id} value={a.id}>From: {a.name}</option>)}
          </select>
        </Card>
      )}

      <div className={cn("ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3", mode === "map" && "hidden")}>
        {(list.data?.canvases ?? []).map((c) => (
          <Card key={c.id} className="group cursor-pointer transition-all hover:shadow-md hover:border-pink-400/40" onClick={() => setOpen(c)}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold">{c.name}</h3>
                <p className="text-[11px] text-ink-muted">{c.graph?.nodes?.length ?? 0} nodes · {(c.graph?.edges?.length ?? 0)} connections</p>
              </div>
              <button className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger" onClick={async (e) => {
                e.stopPropagation(); if (confirm(`Delete "${c.name}"?`)) { await api(`/canvases/${c.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["canvases"] }); }
              }}><Trash2 className="h-3 w-3" /></button>
            </div>
          </Card>
        ))}
      </div>

      {open && (
        <ReactFlowProvider>
          <CanvasEditor
            canvasId={open.id} canvasName={open.name} setCanvasName={(n) => setOpen((prev) => prev ? { ...prev, name: n } : prev)}
            initialNodes={toRfNodes(open)} initialEdges={toRfEdges(open)} onClose={() => setOpen(null)} saving={saving}
            onSave={(nodes, edges) => handleSave(open, nodes, edges)}
          />
        </ReactFlowProvider>
      )}
    </div>
  );
}

export default function CanvasPage() {
  return <CanvasPageInner />;
}



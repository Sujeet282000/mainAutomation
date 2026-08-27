"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { isGoogleApp } from "@/lib/catalog";
import { Input } from "./ui/input";

type AppManifest = {
  slug: string;
  name: string;
  category: string;
  authType?: string;
  operations: Array<{
    key: string;
    name: string;
    type: "trigger" | "action" | "search";
    inputFields?: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      options?: { label: string; value: string }[];
    }>;
  }>;
};

type ConnectionRow = { id: string; name: string; app_slug: string };

function toGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as { kind?: string }).kind ?? "action",
      appSlug: (n.data as { appSlug?: string }).appSlug,
      operation: (n.data as { operation?: string }).operation,
      label: (n.data as { label?: string }).label ?? n.id,
      position: n.position,
      config: (n.data as { config?: Record<string, unknown> }).config ?? {},
      connectionId: (n.data as { connectionId?: string | null }).connectionId ?? null
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null
    }))
  };
}

function StepNode({ data, selected }: NodeProps) {
  const isPath = data.appSlug === "paths";
  return (
    <div
      className={`min-w-[180px] rounded-xl border px-3 py-2 text-sm ${
        selected ? "border-accent bg-[#1a2342]" : "border-line bg-[#12182c]"
      }`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="text-[10px] uppercase text-muted">{data.kind}</div>
      <div className="font-medium">{data.label}</div>
      <div className="text-xs text-muted">
        {data.appSlug}.{data.operation}
      </div>
      {isPath ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: "30%" }} />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: "70%" }} />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}

const nodeTypes = { step: StepNode };

export function WorkflowBuilder({
  initial,
  onSave,
  onPublish,
  onRun
}: {
  initial: { nodes?: unknown[]; edges?: unknown[] };
  onSave: (graph: unknown) => Promise<void>;
  onPublish: () => Promise<void>;
  onRun: () => Promise<void>;
}) {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [registered, setRegistered] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState("all");

  useEffect(() => {
    Promise.all([api("/apps"), api("/connections"), api("/adapters")])
      .then(([a, c, d]) => {
        setApps(a.apps ?? []);
        setConnections(c.connections ?? []);
        setRegistered(d.adapters ?? []);
      })
      .catch(() => undefined);
  }, []);

  const startNodes: Node[] = (initial.nodes as Array<Record<string, unknown>> | undefined)?.length
    ? (initial.nodes as Array<Record<string, unknown>>).map((n) => ({
        id: String(n.id),
        type: "step",
        position: (n.position as { x: number; y: number }) ?? { x: 80, y: 80 },
        data: {
          label: n.label,
          kind: n.type,
          appSlug: n.appSlug,
          operation: n.operation,
          config: (n.config as Record<string, unknown>) ?? {},
          connectionId: n.connectionId ?? null
        }
      }))
    : [
        {
          id: "trigger",
          type: "step",
          position: { x: 80, y: 80 },
          data: {
            label: "Manual trigger",
            kind: "trigger",
            appSlug: "manual",
            operation: "button",
            config: {},
            connectionId: null
          }
        }
      ];
  const startEdges: Edge[] = ((initial.edges as Array<{ id: string; source: string; target: string; sourceHandle?: string }>) ?? []).map(
    (e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      animated: true
    })
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(startNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(startEdges);

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)), [setEdges]);

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedApp = apps.find((a) => a.slug === selected?.data.appSlug);
  const selectedOp = selectedApp?.operations.find((o) => o.key === selected?.data.operation);
  const categories = useMemo(() => ["all", ...new Set(apps.map((a) => a.category))], [apps]);
  const visibleApps = apps
    .filter((a) => category === "all" || a.category === category)
    .map((a) => ({
      ...a,
      operations: a.operations.filter(
        (op) => registered.includes(`${a.slug}:${op.key}`) || registered.includes(`${a.slug}:*`)
      )
    }))
    .filter((a) => a.operations.length > 0);

  function addOp(app: AppManifest, op: AppManifest["operations"][number]) {
    const id = `${app.slug}-${op.key}-${Date.now()}`;
    const kind = op.type === "trigger" ? "trigger" : op.type === "search" ? "action" : op.type === "action" && app.category === "logic" ? "logic" : "action";
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "step",
        position: { x: 80, y: 80 + ns.length * 110 },
        data: { label: op.name, kind, appSlug: app.slug, operation: op.key, config: {}, connectionId: null }
      }
    ]);
    setEdges((es) => {
      const last = nodes[nodes.length - 1];
      if (!last) return es;
      return [...es, { id: `e-${last.id}-${id}`, source: last.id, target: id }];
    });
    setSelectedId(id);
  }

  function patchSelected(data: Record<string, unknown>) {
    if (!selectedId) return;
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...data } } : n)));
  }

  function patchConfig(key: string, value: unknown) {
    if (!selected) return;
    const config = { ...((selected.data.config as Record<string, unknown>) ?? {}), [key]: value };
    patchSelected({ config });
  }

  return (
    <div className="grid grid-cols-[260px_1fr_280px] gap-3" style={{ height: "calc(100vh - 160px)" }}>
      <Card className="overflow-auto">
        <div className="mb-2 text-sm text-muted">1. Trigger → 2. Actions</div>
        <select
          className="mb-3 w-full rounded-lg border border-line bg-[#0e1428] px-2 py-1 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-3">
          {visibleApps.map((app) => (
            <div key={app.slug}>
              <div className="mb-1 text-xs font-semibold text-muted">{app.name}</div>
              {app.operations.map((op) => (
                <Button
                  key={`${app.slug}-${op.key}`}
                  variant="secondary"
                  className="mb-1 w-full justify-start"
                  onClick={() => addOp(app, op)}
                >
                  {op.type}: {op.name}
                </Button>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={() => onSave(toGraph(nodes, edges))}>Save draft</Button>
          <Button variant="secondary" onClick={onPublish}>
            Publish
          </Button>
          <Button variant="ghost" onClick={onRun}>
            Test run
          </Button>
        </div>
      </Card>
      <div className="overflow-hidden rounded-2xl border border-line">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      <Card className="overflow-auto">
        <div className="mb-3 text-sm text-muted">Step settings</div>
        {!selected && <p className="text-sm text-muted">Select a node to map fields. Use {"{{trigger.body}}"} in text fields.</p>}
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-medium">{String(selected.data.label)}</div>
            {selectedApp?.authType && selectedApp.authType !== "none" && (
              <label className="text-xs text-muted">
                Connection
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-[#0e1428] px-2 py-2 text-sm"
                  value={String(selected.data.connectionId ?? "")}
                  onChange={(e) => patchSelected({ connectionId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {connections
                    .filter((c) => c.app_slug === selected.data.appSlug || (isGoogleApp(c.app_slug) && isGoogleApp(selected.data.appSlug)))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(selectedOp?.inputFields ?? []).map((field) => (
              <label key={field.key} className="text-xs text-muted">
                {field.label}
                {field.options ? (
                  <select
                    className="mt-1 w-full rounded-lg border border-line bg-[#0e1428] px-2 py-2 text-sm"
                    value={String((selected.data.config as Record<string, unknown>)?.[field.key] ?? "")}
                    onChange={(e) => patchConfig(field.key, e.target.value)}
                  >
                    <option value="">Select</option>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="mt-1"
                    value={String((selected.data.config as Record<string, unknown>)?.[field.key] ?? "")}
                    onChange={(e) => patchConfig(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

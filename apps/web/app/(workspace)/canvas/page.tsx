"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type CanvasNode = {
  id: string;
  label: string;
  kind?: string;
  appSlug?: string;
  operation?: string;
  x?: number;
  y?: number;
  position?: { x?: number; y?: number };
};
type CanvasEdge = { id?: string; source: string; target: string };
type Canvas = { id: string; name: string; graph: { nodes?: CanvasNode[]; edges?: CanvasEdge[] } };

function nodeXY(n: CanvasNode, i: number) {
  const x = Number(n.x ?? n.position?.x ?? 80);
  const y = Number(n.y ?? n.position?.y ?? 40 + i * 160);
  return { x: Number.isFinite(x) ? x : 80, y: Number.isFinite(y) ? y : 40 + i * 160 };
}

export default function CanvasPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["canvases"], queryFn: () => api<{ canvases: Canvas[] }>("/canvases") });
  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations")
  });
  const [name, setName] = useState("System map");
  const [fromZap, setFromZap] = useState("");
  const [open, setOpen] = useState<Canvas | null>(null);
  const [err, setErr] = useState("");

  const diagram = useMemo(() => {
    const nodes = (open?.graph?.nodes ?? []).map((n, i) => ({ ...n, ...nodeXY(n, i) }));
    const edges = open?.graph?.edges ?? [];
    const w = Math.max(640, ...nodes.map((n) => n.x + 280), 640);
    const h = Math.max(360, ...nodes.map((n) => n.y + 120), 360);
    return { nodes, edges, w, h };
  }, [open]);

  return (
    <div>
      <PageHeader
        title="Canvas"
        description="Process diagramming — independent from the Zap editor. Generate boxes from a workflow’s trigger and actions."
      />
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <Card className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="rounded-lg border border-line bg-elevated px-2 text-sm" value={fromZap} onChange={(e) => setFromZap(e.target.value)}>
          <option value="">Blank canvas</option>
          {(autos.data?.automations ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              From: {a.name}
            </option>
          ))}
        </select>
        <Button
          onClick={async () => {
            setErr("");
            try {
              const d = await api<{ canvas: Canvas }>("/canvases", {
                method: "POST",
                body: JSON.stringify(
                  fromZap ? { name, sourceAutomationId: fromZap } : { name }
                )
              });
              qc.invalidateQueries({ queryKey: ["canvases"] });
              if (d.canvas) setOpen({ ...d.canvas, graph: d.canvas.graph ?? { nodes: [], edges: [] } });
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Create failed");
            }
          }}
        >
          Create canvas
        </Button>
      </Card>
      {!list.data?.canvases.length && !list.isLoading && (
        <EmptyState icon={<Network className="h-10 w-10" />} title="No canvases" description="Canvas is documentation and planning — it does not run tasks." />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(list.data?.canvases ?? []).map((c) => (
          <Card key={c.id} className="cursor-pointer" onClick={() => setOpen(c)}>
            <h3 className="font-semibold">{c.name}</h3>
            <p className="text-sm text-ink-muted">{c.graph?.nodes?.length ?? 0} boxes</p>
          </Card>
        ))}
      </div>
      {open && (
        <Card className="mt-4">
          <h3 className="mb-3 font-semibold">{open.name}</h3>
          <div className="overflow-auto rounded-lg border border-dashed border-line bg-muted/40">
            <svg width={diagram.w} height={diagram.h} className="block min-h-[360px] w-full">
              {diagram.edges.map((e, i) => {
                const s = diagram.nodes.find((n) => n.id === e.source);
                const t = diagram.nodes.find((n) => n.id === e.target);
                if (!s || !t) return null;
                return (
                  <line
                    key={e.id ?? `${e.source}-${e.target}-${i}`}
                    x1={s.x + 130}
                    y1={s.y + 36}
                    x2={t.x + 130}
                    y2={t.y + 8}
                    stroke="rgb(148 163 184)"
                    strokeWidth="2"
                  />
                );
              })}
            </svg>
            <div className="relative -mt-[var(--h)]" style={{ marginTop: -diagram.h, height: diagram.h, minHeight: 360 }}>
              {diagram.nodes.map((n) => (
                <div
                  key={n.id}
                  className="absolute w-[260px] rounded-xl border border-line bg-elevated px-3 py-2 text-sm shadow-sm"
                  style={{ left: n.x, top: n.y }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    {n.kind === "trigger" ? "Trigger" : n.kind === "logic" ? "Logic" : "Action"}
                  </div>
                  <div className="font-medium">{n.label || (n.kind === "trigger" ? "Trigger" : "Action")}</div>
                  {(n.appSlug || n.operation) && (
                    <div className="truncate text-xs text-ink-muted">
                      {[n.appSlug, n.operation].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              ))}
              {!diagram.nodes.length && <p className="p-6 text-sm text-ink-muted">Empty diagram. Generate from a workflow to populate trigger and action boxes.</p>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

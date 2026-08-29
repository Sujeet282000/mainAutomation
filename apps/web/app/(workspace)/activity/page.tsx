"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, Clock3, LayoutGrid, List, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCardGrid, SkeletonStatGrid, SkeletonTableRow } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Run = {
  id: string;
  status: string;
  automation_name?: string;
  created_at: string;
  trigger_type?: string;
  automation_id?: string;
  finished_at?: string;
  error?: { message?: string };
};

function duration(r: Run) {
  if (!r.finished_at) return "—";
  const ms = new Date(r.finished_at).getTime() - new Date(r.created_at).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ActivityPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"table" | "cards">("table");
  const list = useQuery({
    queryKey: ["executions"],
    queryFn: () => api<{ executions: Run[] }>("/executions"),
  });

  const items = useMemo(() => {
    return (list.data?.executions ?? []).filter((r) => {
      const hay = `${r.automation_name ?? ""} ${r.status} ${r.trigger_type ?? ""}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (status !== "all" && r.status !== status) return false;
      return true;
    });
  }, [list.data, q, status]);

  const counts = useMemo(() => {
    const all = list.data?.executions ?? [];
    return {
      all: all.length,
      succeeded: all.filter((r) => r.status === "succeeded").length,
      failed: all.filter((r) => r.status === "failed").length,
      running: all.filter((r) => r.status === "running" || r.status === "queued").length,
    };
  }, [list.data]);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Run log: every trigger, status, duration, and error in this workspace."
        actions={
          <Button variant="secondary" size="sm" onClick={() => { list.refetch(); toast.success("Refreshing runs…"); }} disabled={list.isFetching}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", list.isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {list.isLoading ? (
        <SkeletonStatGrid count={4} />
      ) : (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          {[
            { key: "all", label: "All runs", value: counts.all, icon: Activity, tone: "text-ink" },
            { key: "succeeded", label: "Succeeded", value: counts.succeeded, icon: CheckCircle2, tone: "text-ok" },
            { key: "failed", label: "Failed", value: counts.failed, icon: XCircle, tone: "text-danger" },
            { key: "running", label: "In flight", value: counts.running, icon: Clock3, tone: "text-info" },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatus(c.key === "running" ? "running" : c.key)}
              className={cn(
                "rounded-2xl border border-line bg-elevated p-4 text-left shadow-sm transition hover:border-violet-300",
                status === c.key || (c.key === "running" && (status === "running" || status === "queued"))
                  ? "ring-2 ring-violet-500/30"
                  : ""
              )}
            >
              <c.icon className={cn("mb-2 h-4 w-4", c.tone)} />
              <div className="text-2xl font-semibold tracking-tight">{c.value}</div>
              <div className="text-xs text-ink-muted">{c.label}</div>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search workflow, trigger, or status" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="h-9 rounded-lg border border-line bg-elevated px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["all", "succeeded", "failed", "running", "queued", "waiting", "cancelled"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-1 rounded-lg border border-line p-1">
          <button type="button" className={cn("rounded-md p-1.5", view === "table" && "bg-muted")} onClick={() => setView("table")} aria-label="Table view"><List className="h-4 w-4" /></button>
          <button type="button" className={cn("rounded-md p-1.5", view === "cards" && "bg-muted")} onClick={() => setView("cards")} aria-label="Card view"><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      {list.isError && (
        <div className="mb-3 rounded-xl border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm font-medium text-danger">Failed to load runs</p>
          <p className="mt-1 text-xs text-danger/70">{(list.error as Error).message}</p>
        </div>
      )}

      {list.isLoading && view === "cards" && <SkeletonCardGrid count={6} />}
      {list.isLoading && view === "table" && (
        <div className="rounded-2xl border border-line bg-elevated">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} columns={5} />)}
        </div>
      )}

      {!list.isLoading && !items.length && (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="No runs yet"
          description="Publish a workflow and fire its trigger, or use Test workflow in the editor."
        />
      )}

      {view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <Link key={r.id} href={`/activity/${r.id}`} className="rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.automation_name ?? "Run"}</p>
                  <p className="mt-1 text-xs text-ink-muted">{r.trigger_type ?? "manual"} · {new Date(r.created_at).toLocaleString()}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-muted">
                <span>{duration(r)}</span>
                <span className="font-medium text-violet-700">Open run →</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-elevated">
          <div className="grid grid-cols-[1.5fr_110px_120px_90px_1fr] gap-2 border-b border-line bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <span>Workflow</span>
            <span>Status</span>
            <span>Trigger</span>
            <span>Duration</span>
            <span>When</span>
          </div>
          {items.map((r) => (
            <Link
              key={r.id}
              href={`/activity/${r.id}`}
              className="grid grid-cols-[1.5fr_110px_120px_90px_1fr] items-center gap-2 border-b border-line px-4 py-3 text-sm last:border-0 hover:bg-muted/60"
            >
              <span className="truncate font-medium">{r.automation_name ?? "Run"}</span>
              <StatusBadge status={r.status} />
              <span className="truncate text-ink-muted">{r.trigger_type ?? "manual"}</span>
              <span className="text-ink-muted">{duration(r)}</span>
              <span className="text-ink-muted">{new Date(r.created_at).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

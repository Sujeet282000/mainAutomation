"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Activity, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock3, LayoutGrid, List, RefreshCw, Search, XCircle } from "lucide-react";
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
  duration_ms?: number;
  error?: { message?: string };
};

function duration(r: Run) {
  if (r.duration_ms) return r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`;
  if (!r.finished_at) return "—";
  const ms = new Date(r.finished_at).getTime() - new Date(r.created_at).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const CANCELLABLE = new Set(["queued", "running", "paused", "waiting"]);

export default function ActivityPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"table" | "cards">("table");
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);

  const cursor = pageCursors[pageCursors.length - 1];

  const list = useQuery({
    queryKey: ["executions", { q, status, cursor }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("search", q.trim());
      if (status !== "all") params.set("status", status);
      if (cursor) params.set("before", cursor);
      return api<{ executions: Run[]; pagination?: { hasMore?: boolean; nextBefore?: string | null } }>(`/executions?${params.toString()}`);
    },
  });

  const items = useMemo(() => list.data?.executions ?? [], [list.data]);
  const pagination = list.data?.pagination;

  // Deep-link filter: /activity?flow=<id> scopes the list to one workflow
  // (used by the per-workflow run badges on the automations page).
  const flowFilter = useSearchParams().get("flow");
  const filteredItems = useMemo(
    () => (flowFilter ? items.filter((r: { automation_id?: string }) => r.automation_id === flowFilter) : items),
    [items, flowFilter],
  );

  // Authoritative per-workflow totals (all runs, not just this page) when the
  // list is scoped to one workflow via ?flow=.
  const flowStatsQuery = useQuery({
    queryKey: ["automation-run-stats", flowFilter],
    enabled: Boolean(flowFilter),
    queryFn: () => api<{ totals: { total: number; succeeded: number; failed: number; avgDurationMs: number | null }; lastStatus: string | null; lastRunAt: string | null; lastFailure: { runId: string; at: string; error: unknown } | null }>(`/automations/${flowFilter}/run-stats`),
    retry: false,
  });
  const flowName = flowFilter ? filteredItems.find((r: Run) => r.automation_id === flowFilter)?.automation_name : undefined;

  // Stats are computed from the current page — the canonical server-side
  // aggregation endpoint will replace these when wired to daily rollups.
  const counts = useMemo(() => {
    return {
      all: items.length,
      succeeded: items.filter((r) => r.status === "succeeded").length,
      failed: items.filter((r) => r.status === "failed").length,
      running: items.filter((r) => r.status === "running" || r.status === "queued").length,
    };
  }, [items]);

  async function cancelRun(run: Run) {
    try {
      await api(`/executions/${run.id}/cancel`, { method: "POST" });
      toast.success("Run cancelled");
      qc.invalidateQueries({ queryKey: ["executions"] });
    } catch (err) {
      toast.error("Cancel failed", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  }

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
            { key: "all", label: "This page", value: counts.all, icon: Activity, tone: "text-ink" },
            { key: "succeeded", label: "Succeeded", value: counts.succeeded, icon: CheckCircle2, tone: "text-ok" },
            { key: "failed", label: "Failed", value: counts.failed, icon: XCircle, tone: "text-danger" },
            { key: "running", label: "In flight", value: counts.running, icon: Clock3, tone: "text-info" },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => { setStatus(c.key === "running" ? "running" : c.key === "all" ? "all" : c.key); setPageCursors([null]); }}
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
        <form
          className="relative max-w-sm flex-1"
          onSubmit={(e) => { e.preventDefault(); setPageCursors([null]); void list.refetch(); }}
        >
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search runs and error text (server-side)" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select
          className="h-9 rounded-lg border border-line bg-elevated px-2 text-sm"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPageCursors([null]); }}
        >
          {["all", "succeeded", "failed", "running", "queued", "waiting", "paused", "cancelled"].map((s) => (
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

      {!list.isLoading && !filteredItems.length && (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="No runs yet"
          description="Publish a workflow and fire its trigger, or use Test workflow in the editor."
        />
      )}

      {flowFilter && (
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Workflow activity</p>
              <p className="truncate text-sm font-medium">{flowName ?? "Selected workflow"}</p>
            </div>
            {flowStatsQuery.isLoading ? (
              <p className="text-xs text-ink-muted">Loading totals…</p>
            ) : flowStatsQuery.data ? (
              <>
                <span className="text-sm text-ink-muted"><b className="text-ink">{flowStatsQuery.data.totals.total}</b> total runs</span>
                <span className="text-sm text-ok"><b>{flowStatsQuery.data.totals.succeeded}</b> succeeded</span>
                <span className="text-sm text-danger"><b>{flowStatsQuery.data.totals.failed}</b> failed</span>
                {flowStatsQuery.data.totals.avgDurationMs != null && (
                  <span className="text-sm text-ink-muted">avg <b className="text-ink">{(flowStatsQuery.data.totals.avgDurationMs / 1000).toFixed(1)}s</b></span>
                )}
                {flowStatsQuery.data.lastRunAt && (
                  <span className="text-xs text-ink-muted">last run {new Date(flowStatsQuery.data.lastRunAt).toLocaleString()} {flowStatsQuery.data.lastStatus ? `· ${flowStatsQuery.data.lastStatus}` : ""}</span>
                )}
                {flowStatsQuery.data.lastFailure && (
                  <a className="text-sm font-medium text-violet-700 hover:underline" href={`/activity/${flowStatsQuery.data.lastFailure.runId}`}>Inspect last failure →</a>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.automation_name ?? "Run"}</p>
                  <p className="mt-1 text-xs text-ink-muted">{r.trigger_type ?? "manual"} · {new Date(r.created_at).toLocaleString()}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.status === "failed" && r.error?.message && <p className="mt-2 line-clamp-2 text-xs text-danger">{r.error.message}</p>}
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-muted">
                <span>{duration(r)}</span>
                <span className="flex items-center gap-2">
                  {CANCELLABLE.has(r.status) && (
                    <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted hover:text-danger" onClick={() => void cancelRun(r)}>
                      <Ban className="h-3 w-3" /> Cancel
                    </button>
                  )}
                  <Link href={`/activity/${r.id}`} className="font-medium text-violet-700">Open run →</Link>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-elevated">
          <div className="grid grid-cols-[1.5fr_110px_120px_90px_1fr_70px] gap-2 border-b border-line bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <span>Workflow</span>
            <span>Status</span>
            <span>Trigger</span>
            <span>Duration</span>
            <span>When</span>
            <span />
          </div>
          {filteredItems.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1.5fr_110px_120px_90px_1fr_70px] items-center gap-2 border-b border-line px-4 py-3 text-sm last:border-0 hover:bg-muted/60"
            >
              <Link href={`/activity/${r.id}`} className="truncate font-medium hover:text-violet-700">{r.automation_name ?? "Run"}</Link>
              <StatusBadge status={r.status} />
              <span className="truncate text-ink-muted">{r.trigger_type ?? "manual"}</span>
              <span className="text-ink-muted">{duration(r)}</span>
              <span className="text-ink-muted">{new Date(r.created_at).toLocaleString()}</span>
              <span className="text-right">
                {CANCELLABLE.has(r.status) && (
                  <button type="button" title="Cancel run" className="rounded-md p-1.5 text-ink-muted hover:bg-muted hover:text-danger" onClick={() => void cancelRun(r)}>
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {(pagination?.hasMore || pageCursors.length > 1) && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={pageCursors.length <= 1 || list.isFetching}
            onClick={() => setPageCursors((p) => p.slice(0, -1))}
          >
            <ChevronUp className="mr-1 h-3.5 w-3.5" /> Newer
          </Button>
          <span className="text-xs text-ink-muted">Page {pageCursors.length}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!pagination?.hasMore || list.isFetching}
            onClick={() => setPageCursors((p) => [...p, pagination?.nextBefore ?? null])}
          >
            Older <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

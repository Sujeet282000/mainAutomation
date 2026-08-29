"use client";

import { useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock,
  RefreshCw, TrendingUp, TrendingDown, XCircle, Zap, Timer, BarChart3
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCardGrid, SkeletonStatGrid } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Automation = { id: string; name: string; status: string; updated_at?: string };
type Execution = {
  id: string; status: string; automation_name?: string; automation_id?: string;
  created_at: string; finished_at?: string; trigger_type?: string;
  error?: { message?: string };
};

// ── Bar Chart ─────────────────────────────────────────────────────────────
function BarChart({ data }: { data: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2" style={{ height: 140 }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <span className={cn("text-[10px] font-semibold", d.value > 0 ? "text-ink" : "text-ink-muted")}>{d.value}</span>
          <div
            className={cn("w-full rounded-t-lg transition-all duration-700 ease-out", d.value > 0 ? (d.color ?? "bg-gradient-to-t from-violet-600 to-violet-400") : "bg-muted")}
            style={{ height: `${Math.max((d.value / max) * 90, d.value > 0 ? 6 : 2)}%` }}
          />
          <span className="text-[10px] font-medium text-ink-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────
function DonutChart({ segments, size = 120 }: { segments: Array<{ value: number; color: string; label: string }>; size?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - 20) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map((seg, i) => {
            const pct = (seg.value / total) * circ;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color}
                strokeWidth={14} strokeDasharray={`${pct} ${circ - pct}`} strokeDashoffset={-offset}
                strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }} />
            );
            offset += pct;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink">{total}</span>
          <span className="text-[10px] text-ink-muted">runs</span>
        </div>
      </div>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2.5 text-xs">
            <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: seg.color }} />
            <span className="min-w-[80px] text-ink-muted">{seg.label}</span>
            <span className="font-bold text-ink">{seg.value}</span>
            <span className="text-ink-muted">({total > 0 ? Math.round((seg.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trend indicator ───────────────────────────────────────────────────────
function Trend({ value, label }: { value: number; label?: string }) {
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", up ? "text-ok" : value < 0 ? "text-danger" : "text-ink-muted")}>
      {up ? <TrendingUp className="h-3 w-3" /> : value < 0 ? <TrendingDown className="h-3 w-3" /> : null}
      {Math.abs(value)}%{label && <span className="ml-0.5 font-normal text-ink-muted">{label}</span>}
    </span>
  );
}

// ── Duration formatting ───────────────────────────────────────────────────
function formatDuration(start: string, end?: string): string {
  if (!end) return "\u2014";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function WorkflowAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["executions"] });
      qc.invalidateQueries({ queryKey: ["automations"] });
    }, 30_000);
    return () => clearInterval(interval);
  }, [qc]);

  const autosQ = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Automation[] }>( "/automations") });
  const runsQ = useQuery({ queryKey: ["executions"], queryFn: () => api<{ executions: Execution[] }>("/executions") });

  const isLoading = runsQ.isLoading || autosQ.isLoading;

  const workflow = useMemo(() => {
    const autos = autosQ.data?.automations ?? [];
    return autos.find((a) => a.id === id);
  }, [autosQ.data, id]);

  const stats = useMemo(() => {
    const runs = (runsQ.data?.executions ?? []).filter((r) => r.automation_id === id);
    const succeeded = runs.filter((r) => r.status === "succeeded").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const running = runs.filter((r) => r.status === "running" || r.status === "queued").length;
    const successRate = runs.length > 0 ? Math.round((succeeded / runs.length) * 100) : 0;

    // Runs per day (last 14 days)
    const now = Date.now();
    const dayMs = 86400000;
    const runsPerDay = Array.from({ length: 14 }, (_, i) => {
      const dayStart = now - (13 - i) * dayMs;
      const dayEnd = dayStart + dayMs;
      const dayRuns = runs.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        succeeded: dayRuns.filter((r) => r.status === "succeeded").length,
        failed: dayRuns.filter((r) => r.status === "failed").length,
        total: dayRuns.length,
      };
    });

    // Trend: this week vs last week
    const thisWeekRuns = runs.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= now - 7 * dayMs;
    }).length;
    const lastWeekRuns = runs.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= now - 14 * dayMs && t < now - 7 * dayMs;
    }).length;
    const weeklyTrend = lastWeekRuns > 0 ? Math.round(((thisWeekRuns - lastWeekRuns) / lastWeekRuns) * 100) : thisWeekRuns > 0 ? 100 : 0;

    // Average duration
    const durations = runs.filter((r) => r.finished_at).slice(0, 50)
      .map((r) => new Date(r.finished_at!).getTime() - new Date(r.created_at).getTime());
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const avgDurationStr = avgDuration > 0 ? `${(avgDuration / 1000).toFixed(1)}s` : "\u2014";

    // Recent runs (last 20)
    const recentRuns = runs.slice(0, 20);

    // Errors
    const errors = runs.filter((r) => r.status === "failed" && r.error?.message).slice(0, 5);

    return {
      totalRuns: runs.length, succeeded, failed, running, successRate,
      runsPerDay, weeklyTrend, avgDurationStr, recentRuns, errors,
    };
  }, [runsQ.data, id]);

  const dayLabels14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  return (
    <div className="pb-10">
      <PageHeader
        title={workflow?.name ?? "Workflow Analytics"}
        description={workflow ? `Performance overview for "${workflow.name}"` : "Loading..."}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition">
              <ArrowLeft className="h-3.5 w-3.5" /> All analytics
            </Link>
            <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> Live
            </span>
            <Button variant="secondary" size="sm" onClick={() => { qc.invalidateQueries(); toast.success("Data refreshed"); }}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <SkeletonStatGrid count={5} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="mb-6 grid gap-3 sm:grid-cols-5">
            <Card>
              <div className="flex items-center gap-2 text-ink-muted"><Activity className="h-4 w-4 text-violet-600" /> Total Runs</div>
              <div className="mt-2 text-2xl font-bold">{stats.totalRuns}</div>
              <Trend value={stats.weeklyTrend} label="vs last wk" />
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink-muted"><CheckCircle2 className="h-4 w-4 text-ok" /> Succeeded</div>
              <div className="mt-2 text-2xl font-bold text-ok">{stats.succeeded}</div>
              <p className="text-[11px] text-ink-muted">{stats.successRate}% success rate</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink-muted"><XCircle className="h-4 w-4 text-danger" /> Failed</div>
              <div className="mt-2 text-2xl font-bold text-danger">{stats.failed}</div>
              <p className="text-[11px] text-ink-muted">{stats.totalRuns > 0 ? Math.round((stats.failed / stats.totalRuns) * 100) : 0}% failure rate</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink-muted"><Timer className="h-4 w-4 text-amber-500" /> Avg Duration</div>
              <div className="mt-2 text-2xl font-bold">{stats.avgDurationStr}</div>
              <p className="text-[11px] text-ink-muted">per execution</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink-muted"><Zap className="h-4 w-4 text-teal" /> Status</div>
              <div className="mt-2 text-2xl font-bold capitalize">{workflow?.status ?? "\u2014"}</div>
              <p className="text-[11px] text-ink-muted">{stats.running} in queue</p>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="mb-6 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Runs over time</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">Last 14 days of executions</p>
                </div>
                <Trend value={stats.weeklyTrend} label="vs last wk" />
              </div>
              <BarChart
                data={dayLabels14.map((label, i) => ({
                  label,
                  value: stats.runsPerDay[i].total,
                  color: stats.runsPerDay[i].failed > 0
                    ? "bg-gradient-to-t from-danger to-danger/60"
                    : stats.runsPerDay[i].succeeded > 0
                      ? "bg-gradient-to-t from-ok to-ok/60"
                      : undefined,
                }))}
              />
              <div className="mt-3 flex items-center gap-4 text-[10px] text-ink-muted">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ok" /> Succeeded</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> Failed</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted" /> No runs</span>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <div className="mb-5">
                <p className="text-sm font-semibold">Status breakdown</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">All-time outcomes</p>
              </div>
              <DonutChart
                segments={[
                  { value: stats.succeeded, color: "#059669", label: "Succeeded" },
                  { value: stats.failed, color: "#dc2626", label: "Failed" },
                  { value: stats.running, color: "#2563eb", label: "In progress" },
                ]}
                size={130}
              />
            </Card>
          </div>

          {/* Recent Runs */}
          <Card className="mb-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10"><BarChart3 className="h-3.5 w-3.5 text-violet-600" /></div>
                <div>
                  <p className="text-sm font-semibold">Recent Runs</p>
                  <p className="text-[11px] text-ink-muted">Last {stats.recentRuns.length} executions</p>
                </div>
              </div>
              <Link href={`/activity?workflow=${id}`} className="text-[11px] font-medium text-violet-600 hover:underline">View all <ArrowRight className="inline h-3 w-3" /></Link>
            </div>
            {stats.recentRuns.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Activity className="mb-2 h-6 w-6 text-ink-muted/30" />
                <p className="text-xs text-ink-muted">No runs yet for this workflow</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-muted/50">
                      <th className="px-3 py-2 font-medium text-ink-muted">Status</th>
                      <th className="px-3 py-2 font-medium text-ink-muted">Trigger</th>
                      <th className="px-3 py-2 font-medium text-ink-muted">Duration</th>
                      <th className="px-3 py-2 font-medium text-ink-muted">Started</th>
                      <th className="px-3 py-2 font-medium text-ink-muted">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentRuns.map((r) => (
                      <tr key={r.id} className="border-b border-line/50 hover:bg-muted/30">
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2 text-ink-muted capitalize">{r.trigger_type ?? "manual"}</td>
                        <td className="px-3 py-2 font-mono text-ink-muted">{formatDuration(r.created_at, r.finished_at)}</td>
                        <td className="px-3 py-2 text-ink-muted">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-danger/80">{r.error?.message ?? "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Errors */}
          {stats.errors.length > 0 && (
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-danger/10"><AlertTriangle className="h-3.5 w-3.5 text-danger" /></div>
                <div>
                  <p className="text-sm font-semibold">Recent Failures</p>
                  <p className="text-[11px] text-ink-muted">{stats.errors.length} error{stats.errors.length > 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="space-y-2">
                {stats.errors.map((r) => (
                  <Link key={r.id} href={`/activity/${r.id}`} className="group block rounded-xl border border-danger/10 bg-danger/[0.03] p-3 transition hover:border-danger/30 hover:bg-danger/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-ink-muted">{new Date(r.created_at).toLocaleString()}</span>
                      <StatusBadge status="failed" />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-danger/80">{r.error?.message}</p>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

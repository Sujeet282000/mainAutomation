"use client";

import { useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowRight, CheckCircle2, Clock,
  Download, Globe, Plug, RefreshCw, TrendingUp, TrendingDown, Workflow, XCircle, Zap, BarChart3, Timer, Target
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
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
type Connection = { id: string; name: string; status: string; appSlug?: string; app_slug?: string };
type Table = { id: string; name: string; record_count?: number };
type FormRow = { id: string; name: string; slug: string };
type Agent = { id: string; name: string; status: string };
type AnalyticsSummary = {
  daily: Array<{ day: string; runs: number; succeeded: number; failed: number; active_workflows: number; avg_ms: number | null }>;
  triggers: Array<{ trigger_kind: string; runs: number }>;
  slowSteps: Array<{ step_id: string; step_type: string; flow_name: string; avg_ms: number; max_ms: number; runs: number }>;
  failures: Array<{ id: string; created_at: string; automation_name: string; error: { message?: string } }>;
  latency: { p50: number | null; p95: number | null; p99: number | null };
};


// ── Stacked Bar Chart (succeeded vs failed per day, with hover tooltip) ──────
function StackedBarChart({ data, height = 150 }: { data: Array<{ label: string; succeeded: number; failed: number }>; height?: number }) {
  const max = Math.max(...data.map((d) => d.succeeded + d.failed), 1);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const total = d.succeeded + d.failed;
          return (
            <div key={i} className="group flex flex-1 cursor-default flex-col items-center gap-1.5" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className={cn("text-[10px] font-semibold transition-opacity", total > 0 ? "text-ink" : "text-ink-muted", hover !== null && hover !== i && "opacity-40")}>{total}</span>
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-lg"
                style={{ height: `${total > 0 ? Math.max((total / max) * 88, 6) : 2}%` }}
              >
                {d.succeeded > 0 && (
                  <div
                    className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-700 group-hover:brightness-110"
                    style={{ height: `${(d.succeeded / total) * 100}%` }}
                  />
                )}
                {d.failed > 0 && (
                  <div
                    className="w-full bg-gradient-to-t from-red-600 to-red-400 transition-all duration-700 group-hover:brightness-110"
                    style={{ height: `${(d.failed / total) * 100}%` }}
                  />
                )}
              </div>
              <span className={cn("text-[10px] font-medium transition-colors", hover === i ? "text-ink" : "text-ink-muted")}>{d.label}</span>
            </div>
          );
        })}
      </div>
      {hover !== null && data[hover] && data[hover].succeeded + data[hover].failed > 0 && (
        <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-card">
          <span className="font-semibold">{data[hover].label}</span>
          <span className="text-ink-muted"> — </span>
          <span className="font-medium text-ok">{data[hover].succeeded} ok</span>
          {data[hover].failed > 0 && (
            <>
              <span className="text-ink-muted"> · </span>
              <span className="font-medium text-danger">{data[hover].failed} failed</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Area Line Chart (SVG trend: total runs area + dashed failure line) ───────
function AreaLineChart({ data, height = 200 }: { data: Array<{ label: string; runs: number; failed: number }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, padL = 36, padR = 10, padT = 14, padB = 24;
  const max = Math.max(...data.map((d) => d.runs), 4);
  const x = (i: number) => padL + (i / Math.max(data.length - 1, 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const step = data.length > 1 ? (W - padL - padR) / (data.length - 1) : W;
  const runsPts = data.map((d, i) => `${x(i)},${y(d.runs)}`).join(" ");
  const areaPts = `${padL},${y(0)} ${runsPts} ${x(data.length - 1)},${y(0)}`;
  const failPts = data.map((d, i) => `${x(i)},${y(d.failed)}`).join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: height + 40 }}>
        {[0, max / 2, max].map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-ink-muted opacity-25" strokeDasharray={t === 0 ? undefined : "3 4"} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} className="fill-current text-ink-muted">{Math.round(t)}</text>
          </g>
        ))}
        <polygon points={areaPts} fill="#7c3aed" fillOpacity={0.12} className="transition-all duration-700" />
        <polyline points={runsPts} fill="none" stroke="#7c3aed" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={failPts} fill="none" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.runs)} r={hover === i ? 4 : 2.5} fill="#7c3aed" className="transition-all" />
        ))}
        {data.map((d, i) =>
          d.failed > 0 ? (
            <circle key={`f${i}`} cx={x(i)} cy={y(d.failed)} r={hover === i ? 3.5 : 2} fill="#dc2626" className="transition-all" />
          ) : null
        )}
        {data.map((_, i) => (
          <rect key={`h${i}`} x={x(i) - step / 2} y={0} width={Math.max(step, 8)} height={H} fill="transparent" style={{ cursor: "default" }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        {data.map((d, i) => (
          (data.length <= 8 || i % 2 === 0) && (
            <text key={`x${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} className={cn("fill-current", hover === i ? "text-ink" : "text-ink-muted")}>{d.label}</text>
          )
        ))}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-card"
          style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 6), 72)}%` }}
        >
          <span className="font-semibold">{data[hover].label}</span>
          <span className="text-ink-muted"> — {data[hover].runs} run{data[hover].runs === 1 ? "" : "s"}</span>
          <span className="font-medium text-ok"> · {data[hover].runs - data[hover].failed} ok</span>
          {data[hover].failed > 0 && <span className="font-medium text-danger"> · {data[hover].failed} failed</span>}
        </div>
      )}
    </div>
  );
}

// ── Donut Chart (SVG, with hover tooltip) ────────────────────────────────────
function DonutChart({ segments, size = 120 }: { segments: Array<{ value: number; color: string; label: string }>; size?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const [hover, setHover] = useState<string | null>(null);
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
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={hover === seg.label ? 17 : 14}
                strokeDasharray={`${pct} ${circ - pct}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1), stroke-width 0.15s", cursor: "default", opacity: hover && hover !== seg.label ? 0.45 : 1 }}
                onMouseEnter={() => setHover(seg.label)}
                onMouseLeave={() => setHover(null)}
              />
            );
            offset += pct;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {hover ? (
            <>
              <span className="text-lg font-bold text-ink">{Math.round(((segments.find((s) => s.label === hover)?.value ?? 0) / total) * 100)}%</span>
              <span className="text-[10px] text-ink-muted">{hover}</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-ink">{total}</span>
              <span className="text-[10px] text-ink-muted">runs</span>
            </>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className={cn("flex items-center gap-2.5 text-xs transition-opacity", hover && hover !== seg.label && "opacity-40")} onMouseEnter={() => setHover(seg.label)} onMouseLeave={() => setHover(null)}>
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

// ── Mini Sparkline ───────────────────────────────────────────────────────
function Sparkline({ values, color = "#7c3aed", height = 28, width = 64 }: { values: number[]; color?: string; height?: number; width?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const fillPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polygon points={fillPoints} fill={color} fillOpacity={0.1} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const dayLabelsStatic = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Trend indicator ─────────────────────────────────────────────────────
function Trend({ value, label }: { value: number; label?: string }) {
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", up ? "text-ok" : value < 0 ? "text-danger" : "text-ink-muted")}>
      {up ? <TrendingUp className="h-3 w-3" /> : value < 0 ? <TrendingDown className="h-3 w-3" /> : null}
      {Math.abs(value)}%{label && <span className="ml-0.5 font-normal text-ink-muted">{label}</span>}
    </span>
  );
}

// ── CSV Export ──────────────────────────────────────────────────────────
function exportCSV(stats: ReturnType<typeof computeStats>) {
  const rows = [
    ["Metric", "Value"],
    ["Workflows", String(stats.totalAutomations)],
    ["Active Workflows", String(stats.onAutos)],
    ["Total Runs", String(stats.totalRuns)],
    ["Succeeded", String(stats.succeeded)],
    ["Failed", String(stats.failed)],
    ["Success Rate", stats.totalRuns > 0 ? `${Math.round((stats.succeeded / stats.totalRuns) * 100)}%` : "0%"],
    ["Avg Duration", stats.avgDurationStr],
    ["Connections", String(stats.totalConnections)],
    ["Active Connections", String(stats.connected)],
    ["Tables", String(stats.totalTables)],
    ["Forms", String(stats.totalForms)],
    ["Agents", String(stats.totalAgents)],
    [""],
    ["Top Workflows"],
    ["Name", "Runs", "Succeeded", "Failed"],
    ...stats.topWorkflows.map((wf) => [wf.name, String(wf.count), String(wf.succeeded), String(wf.failed)]),
    [""],
    ["Recent Errors"],
    ["Workflow", "Error", "Date"],
    ...stats.recentErrors.map((r: any) => [r.automation_name ?? "Run", r.error?.message ?? "", new Date(r.created_at).toLocaleString()]),
  ];
  const csv = rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, "\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast.success("CSV exported");
}

// ── PDF Export (print-optimized) ─────────────────────────────────────────
function exportPDF(stats: ReturnType<typeof computeStats>) {
  const win = window.open("", "_blank");
  if (!win) { toast.error("Pop-up blocked"); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Analytics Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 12px; color: #666; }
  .card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .card .sub { font-size: 11px; color: #999; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { background: #f8fafc; font-weight: 600; }
  h2 { font-size: 16px; margin: 24px 0 12px; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>Workspace Analytics Report</h1>
<p class="subtitle">Generated ${new Date().toLocaleString()}</p>

<div class="grid">
  <div class="card"><div class="label">Workflows</div><div class="value">${stats.totalAutomations}</div><div class="sub">${stats.onAutos} active</div></div>
  <div class="card"><div class="label">Total Runs</div><div class="value">${stats.totalRuns}</div><div class="sub">${stats.successRate}% success</div></div>
  <div class="card"><div class="label">Failed</div><div class="value">${stats.failed}</div><div class="sub">${stats.totalRuns > 0 ? Math.round((stats.failed / stats.totalRuns) * 100) : 0}% rate</div></div>
  <div class="card"><div class="label">Connections</div><div class="value">${stats.totalConnections}</div><div class="sub">${stats.connected} active</div></div>
  <div class="card"><div class="label">Tables</div><div class="value">${stats.totalTables}</div></div>
  <div class="card"><div class="label">Forms</div><div class="value">${stats.totalForms}</div></div>
</div>

<h2>Top Workflows</h2>
<table><thead><tr><th>Name</th><th>Runs</th><th>Succeeded</th><th>Failed</th></tr></thead><tbody>
${stats.topWorkflows.map((wf) => `<tr><td>${wf.name}</td><td>${wf.count}</td><td>${wf.succeeded}</td><td>${wf.failed}</td></tr>`).join("\n")}
${stats.topWorkflows.length === 0 ? "<tr><td colspan=4 style='text-align:center;color:#999'>No runs yet</td></tr>" : ""}
</tbody></table>

${stats.recentErrors.length > 0 ? `<h2>Recent Failures</h2>
<table><thead><tr><th>Workflow</th><th>Error</th><th>Date</th></tr></thead><tbody>
${stats.recentErrors.map((r: any) => `<tr><td>${r.automation_name ?? "Run"}</td><td>${r.error?.message ?? ""}</td><td>${new Date(r.created_at).toLocaleString()}</td></tr>`).join("\n")}
</tbody></table>` : ""}

</body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 500);
  toast.success("PDF report opened");
}

// ── Stats computation (extracted for reuse by export functions) ───────────
function computeStats(autosQ: any, runsQ: any, connsQ: any, tablesQ: any, formsQ: any, agentsQ: any) {
  const autos = autosQ?.data?.automations ?? [];
  const runs = runsQ?.data?.executions ?? [];
  const conns = connsQ?.data?.connections ?? [];
  const tables = tablesQ?.data?.tables ?? [];
  const forms = formsQ?.data?.forms ?? [];
  const agents = agentsQ?.data?.agents ?? [];
  const succeeded = runs.filter((r: any) => r.status === "succeeded").length;
  const failed = runs.filter((r: any) => r.status === "failed").length;
  const running = runs.filter((r: any) => r.status === "running" || r.status === "queued").length;
  const successRate = runs.length > 0 ? Math.round((succeeded / runs.length) * 100) : 0;
  const now = Date.now(); const dayMs = 86400000;
  const runsPerDay = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i) * dayMs; const dayEnd = dayStart + dayMs;
    return runs.filter((r: any) => { const t = new Date(r.created_at).getTime(); return t >= dayStart && t < dayEnd; }).length;
  });
  const thisWeek = runsPerDay.slice(-7).reduce((a: number, b: number) => a + b, 0);
  const lastWeekRuns = runs.filter((r: any) => { const t = new Date(r.created_at).getTime(); return t >= now - 14 * dayMs && t < now - 7 * dayMs; }).length;
  const weeklyTrend = lastWeekRuns > 0 ? Math.round(((thisWeek - lastWeekRuns) / lastWeekRuns) * 100) : thisWeek > 0 ? 100 : 0;
  const onAutos = autos.filter((a: any) => a.status === "on").length;
  const draftAutos = autos.filter((a: any) => a.status === "draft").length;
  const offAutos = autos.filter((a: any) => a.status === "off").length;
  const connected = conns.filter((c: any) => c.status === "connected").length;
  const needsReconnect = conns.filter((c: any) => c.status !== "connected").length;
  const durations = runs.filter((r: any) => r.finished_at).slice(0, 50).map((r: any) => new Date(r.finished_at!).getTime() - new Date(r.created_at).getTime());
  const avgDuration = durations.length > 0 ? durations.reduce((a: number, b: number) => a + b, 0) / durations.length : 0;
  const avgDurationStr = avgDuration > 0 ? `${(avgDuration / 1000).toFixed(1)}s` : "\u2014";
  const recentErrors = runs.filter((r: any) => r.status === "failed" && r.error?.message).slice(0, 4);
  const runsByWorkflow: Record<string, { name: string; id: string; count: number; succeeded: number; failed: number; sparkline: number[] }> = {};
  for (const r of runs) {
    const key = r.automation_id ?? "unknown";
    if (!runsByWorkflow[key]) runsByWorkflow[key] = { name: r.automation_name ?? "Unknown", id: key, count: 0, succeeded: 0, failed: 0, sparkline: [] };
    runsByWorkflow[key].count++;
    if (r.status === "succeeded") runsByWorkflow[key].succeeded++;
    if (r.status === "failed") runsByWorkflow[key].failed++;
  }
  for (const wf of Object.values(runsByWorkflow)) {
    const wfRuns = runs.filter((r: any) => (r.automation_id ?? "unknown") === wf.id).slice(0, 10);
    wf.sparkline = wfRuns.map((r: any) => (r.status === "succeeded" ? 1 : r.status === "failed" ? -1 : 0));
  }
  const topWorkflows = Object.values(runsByWorkflow).sort((a, b) => b.count - a.count).slice(0, 5);
  return {
    totalRuns: runs.length, succeeded, failed, running, successRate,
    runsPerDay, weeklyTrend, onAutos, draftAutos, offAutos,
    connected, needsReconnect, avgDurationStr, recentErrors, topWorkflows,
    totalAutomations: autos.length, totalConnections: conns.length,
    totalTables: tables.length, totalForms: forms.length, totalAgents: agents.length,
  };
}

// ── Main Page ────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const qc = useQueryClient();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      qc.invalidateQueries({ queryKey: ["executions"] });
      qc.invalidateQueries({ queryKey: ["connections"] });
    }, 30_000);
    return () => clearInterval(interval);
  }, [qc]);

  const autosQ = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Automation[] }>("/automations") });
  const runsQ = useQuery({ queryKey: ["executions", { stats: true }], queryFn: () => api<{ executions: Execution[] }>("/executions?limit=50"), refetchInterval: 30_000 });
  const connsQ = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: Connection[] }>("/connections") });
  const tablesQ = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Table[] }>("/tables") });
  const formsQ = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: FormRow[] }>("/forms") });
  const agentsQ = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/agents") });
  const summaryQ = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: () => api<AnalyticsSummary>("/analytics/summary?days=14"),
    refetchInterval: 60_000,
  });

  const isLoading = autosQ.isLoading || runsQ.isLoading;

  const stats = useMemo(() => computeStats(autosQ, runsQ, connsQ, tablesQ, formsQ, agentsQ), [autosQ.data, runsQ.data, connsQ.data, tablesQ.data, formsQ.data, agentsQ.data]);

  // Headline run metrics come from the server aggregate (14d window), not from
  // a recent-runs page slice — accurate regardless of run volume.
  const summaryTotals = useMemo(() => {
    const daily = summaryQ.data?.daily ?? [];
    const runs = daily.reduce((a: number, d) => a + Number(d.runs ?? 0), 0);
    const succeeded = daily.reduce((a: number, d) => a + Number(d.succeeded ?? 0), 0);
    const failed = daily.reduce((a: number, d) => a + Number(d.failed ?? 0), 0);
    const withAvg = daily.filter((d) => d.avg_ms);
    const avgMs = withAvg.length ? Math.round(withAvg.reduce((a: number, d) => a + Number(d.avg_ms ?? 0), 0) / withAvg.length) : 0;
    return {
      runs,
      succeeded,
      failed,
      inFlight: Math.max(runs - succeeded - failed, 0),
      successRate: runs > 0 ? Math.round((succeeded / runs) * 100) : 0,
      avgDurationStr: avgMs > 0 ? `${(avgMs / 1000).toFixed(1)}s` : "\u2014",
    };
  }, [summaryQ.data]);

  // Server-computed daily series — stacked succeeded/failed per day.
  const weekStack = useMemo(() => {
    const daily = summaryQ.data?.daily ?? [];
    if (daily.length === 0) {
      return stats.runsPerDay.map((v, i) => ({ label: dayLabelsStatic[i], succeeded: v, failed: 0 }));
    }
    return daily.slice(-7).map((d) => ({
      label: new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }),
      succeeded: d.succeeded,
      failed: d.failed,
    }));
  }, [summaryQ.data, stats.runsPerDay]);

  // 14-day trend series for the activity chart (server aggregate).
  const trend14 = useMemo(() => {
    const daily = summaryQ.data?.daily ?? [];
    return daily.map((d) => ({
      label: new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      runs: d.runs,
      failed: d.failed,
    }));
  }, [summaryQ.data]);

  return (
    <div className="pb-10">
      <PageHeader
        title="Analytics"
        description="Real-time overview of your workspace. Data refreshes every 30 seconds."
        actions={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> Live
            </span>
            <Button variant="secondary" size="sm" onClick={() => exportCSV(stats)}>
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportPDF(stats)}>
              <Download className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { qc.invalidateQueries(); toast.success("Data refreshed"); }}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <SkeletonStatGrid count={6} />
      ) : (
        <>
          {/* ═══ KPI CARDS ═══ */}
          <div className="ws-stagger mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Workflows", value: stats.totalAutomations, icon: Workflow, color: "bg-violet-600", textColor: "text-violet-600", sub: `${stats.onAutos} live` },
              { label: "Runs (14d)", value: summaryTotals.runs, icon: Activity, color: "bg-blue-600", textColor: "text-blue-600", sub: `${summaryTotals.successRate}% success`, trend: stats.weeklyTrend },
              { label: "Succeeded (14d)", value: summaryTotals.succeeded, icon: CheckCircle2, color: "bg-ok", textColor: "text-ok", sub: `of ${summaryTotals.runs} total` },
              { label: "Failed (14d)", value: summaryTotals.failed, icon: XCircle, color: "bg-danger", textColor: "text-danger", sub: summaryTotals.runs > 0 ? `${Math.round((summaryTotals.failed / summaryTotals.runs) * 100)}% rate` : "0% rate" },
              { label: "Connections", value: stats.totalConnections, icon: Plug, color: "bg-teal", textColor: "text-teal", sub: `${stats.connected} active` },
              { label: "Avg Duration", value: summaryTotals.avgDurationStr, icon: Timer, color: "bg-amber-500", textColor: "text-amber-600", sub: "server-computed", hideTrend: true },
            ].map((kpi) => (
              <Card key={kpi.label} className="group relative overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
                <div className={cn("absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-10 transition group-hover:opacity-20", kpi.color)} />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", kpi.color + "/10")}>
                      <kpi.icon className={cn("h-4 w-4", kpi.textColor)} />
                    </div>
                    {kpi.trend !== undefined && !kpi.hideTrend && <Trend value={kpi.trend} label="vs last wk" />}
                  </div>
                  <div className="mt-3 text-2xl font-bold tracking-tight">{kpi.value}</div>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{kpi.label}</p>
                  <p className="text-[10px] text-ink-muted">{kpi.sub}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* ═══ CHARTS ROW ═══ */}
          <div className="mb-6 grid gap-4 lg:grid-cols-5">
            {/* Bar chart — runs per day (wider) */}
            <Card className="lg:col-span-3">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Runs this week</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">Daily execution count across all workflows</p>
                </div>
                <Trend value={stats.weeklyTrend} label="vs last wk" />
              </div>
              <StackedBarChart data={weekStack} />
              <div className="mt-3 flex items-center gap-4 text-[10px] text-ink-muted">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Succeeded</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-500" /> Failed</span>
              </div>
            </Card>

            {/* Donut chart — status distribution (narrower) */}
            <Card className="lg:col-span-2">
              <div className="mb-5">
                <p className="text-sm font-semibold">Status breakdown</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">All-time run outcomes</p>
              </div>
              <DonutChart
                segments={[
                  { value: summaryTotals.succeeded, color: "#059669", label: "Succeeded" },
                  { value: summaryTotals.failed, color: "#dc2626", label: "Failed" },
                  { value: summaryTotals.inFlight, color: "#2563eb", label: "In progress" },
                  { value: Math.max(summaryTotals.runs - summaryTotals.succeeded - summaryTotals.failed - summaryTotals.inFlight, 0), color: "#cbd5e1", label: "Other" },
                ]}
                size={130}
              />
            </Card>
          </div>

          {/* ═══ HEALTH + TOP WORKFLOWS ROW ═══ */}
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            {/* Workflow health */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10"><Zap className="h-3.5 w-3.5 text-violet-600" /></div>
                <div><p className="text-sm font-semibold">Workflow Health</p></div>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Live", count: stats.onAutos, color: "bg-ok", textColor: "text-ok", icon: "●" },
                  { label: "Drafts", count: stats.draftAutos, color: "bg-amber-500", textColor: "text-amber-600", icon: "◐" },
                  { label: "Off", count: stats.offAutos, color: "bg-ink-muted/40", textColor: "text-ink-muted", icon: "○" },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-ink-muted"><span className="text-[8px]">{row.icon}</span> {row.label}</span>
                      <span className={cn("font-bold tabular-nums", row.textColor)}>{row.count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full transition-all duration-700 ease-out", row.color)}
                        style={{ width: `${stats.totalAutomations > 0 ? (row.count / stats.totalAutomations) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/automations" className="mt-4 flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700">
                Manage workflows <ArrowRight className="h-3 w-3" />
              </Link>
            </Card>

            {/* Connection health */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal/10"><Globe className="h-3.5 w-3.5 text-teal" /></div>
                <div><p className="text-sm font-semibold">Connections</p></div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">Active</span>
                    <span className="font-bold text-ok tabular-nums">{stats.connected}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-ok transition-all duration-700"
                      style={{ width: `${stats.totalConnections > 0 ? (stats.connected / stats.totalConnections) * 100 : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">Needs attention</span>
                    <span className={cn("font-bold tabular-nums", stats.needsReconnect > 0 ? "text-warn" : "text-ink-muted")}>{stats.needsReconnect}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-warn transition-all duration-700"
                      style={{ width: `${stats.totalConnections > 0 ? (stats.needsReconnect / stats.totalConnections) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { value: stats.totalTables, label: "Tables", color: "bg-teal/10 text-teal" },
                  { value: stats.totalForms, label: "Forms", color: "bg-blue-500/10 text-blue-600" },
                  { value: stats.totalAgents, label: "Agents", color: "bg-violet-600/10 text-violet-600" },
                ].map((item) => (
                  <div key={item.label} className={cn("rounded-lg p-2 text-center", item.color.split(" ")[0])}>
                    <p className={cn("text-lg font-bold", item.color.split(" ")[1])}>{item.value}</p>
                    <p className="text-[10px] text-ink-muted">{item.label}</p>
                  </div>
                ))}
              </div>
              <Link href="/connections" className="mt-4 flex items-center gap-1 text-[11px] font-medium text-teal hover:text-teal/80">
                Manage connections <ArrowRight className="h-3 w-3" />
              </Link>
            </Card>

            {/* Top workflows */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/10"><BarChart3 className="h-3.5 w-3.5 text-blue-600" /></div>
                <div><p className="text-sm font-semibold">Top Workflows</p></div>
              </div>
              {stats.topWorkflows.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-center">
                  <Target className="mb-2 h-6 w-6 text-ink-muted/30" />
                  <p className="text-xs text-ink-muted">No runs yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.topWorkflows.map((wf, i) => (
                    <Link key={i} href={`/analytics/${wf.id}`} className="group flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-muted/50">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-ink-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium group-hover:text-violet-600">{wf.name}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-muted">
                          <span>{wf.count} runs</span>
                          <span className="text-ok">{wf.succeeded}✓</span>
                          {wf.failed > 0 && <span className="text-danger">{wf.failed}✗</span>}
                        </div>
                      </div>
                      {wf.sparkline.length >= 2 && (
                        <Sparkline
                          values={wf.sparkline.map((v) => v === 1 ? 1 : 0)}
                          color={wf.failed > 0 ? "#dc2626" : "#059669"}
                        />
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ═══ RUN ACTIVITY TREND (14 days, server aggregate) ═══ */}
          <Card className="mb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10"><Activity className="h-3.5 w-3.5 text-violet-600" /></div>
                <div>
                  <p className="text-sm font-semibold">Run activity (14 days)</p>
                  <p className="text-[11px] text-ink-muted">Daily execution volume with failure overlay</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-ink-muted">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" /> Total runs</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Failed</span>
                <Link href="/activity" className="font-medium text-violet-600 hover:underline">All runs →</Link>
              </div>
            </div>
            {trend14.length === 0 ? (
              <p className="py-10 text-center text-xs text-ink-muted">No run data in the last 14 days</p>
            ) : (
              <AreaLineChart data={trend14} />
            )}
          </Card>

          {/* ═══ LATENCY + TRIGGER MIX + SLOWEST STEPS ═══ */}
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            {/* Latency percentiles */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10"><Timer className="h-3.5 w-3.5 text-amber-600" /></div>
                <div>
                  <p className="text-sm font-semibold">Run latency (7d)</p>
                  <p className="text-[11px] text-ink-muted">Percentiles across all workflows</p>
                </div>
              </div>
              <div className="space-y-3">
                {([
                  { label: "Median (p50)", ms: summaryQ.data?.latency?.p50, color: "bg-ok" },
                  { label: "p95", ms: summaryQ.data?.latency?.p95, color: "bg-amber-500" },
                  { label: "Tail (p99)", ms: summaryQ.data?.latency?.p99, color: "bg-danger" },
                ] as const).map((row) => {
                  const maxMs = Math.max(summaryQ.data?.latency?.p99 ?? 0, 1);
                  return (
                    <div key={row.label} className="group">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink-muted">{row.label}</span>
                        <span className="font-bold tabular-nums">{row.ms != null ? `${(row.ms / 1000).toFixed(row.ms < 10_000 ? 2 : 1)}s` : "—"}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full transition-all duration-700 group-hover:brightness-110", row.color)}
                          style={{ width: `${row.ms != null ? Math.min((row.ms / maxMs) * 100, 100) : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Trigger mix donut */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/10"><Globe className="h-3.5 w-3.5 text-blue-600" /></div>
                <div>
                  <p className="text-sm font-semibold">What starts your runs (30d)</p>
                  <p className="text-[11px] text-ink-muted">Executions by trigger type</p>
                </div>
              </div>
              {(summaryQ.data?.triggers?.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">No runs in the last 30 days</p>
              ) : (
                <div className="space-y-3">
                  {(summaryQ.data?.triggers ?? []).slice(0, 5).map((t, i) => {
                    const maxT = Math.max(...(summaryQ.data?.triggers ?? []).map((x) => x.runs), 1);
                    const colors = ["bg-blue-600", "bg-violet-600", "bg-emerald-600", "bg-amber-500", "bg-slate-400"];
                    return (
                      <div key={t.trigger_kind} className="group">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize text-ink-muted">{t.trigger_kind.replace(/_/g, " ")}</span>
                          <span className="font-bold tabular-nums">{t.runs}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full transition-all duration-700 group-hover:brightness-110", colors[i % 5])}
                            style={{ width: `${(t.runs / maxT) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Slowest steps */}
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10"><Clock className="h-3.5 w-3.5 text-violet-600" /></div>
                <div>
                  <p className="text-sm font-semibold">Slowest steps (7d)</p>
                  <p className="text-[11px] text-ink-muted">Where execution time goes</p>
                </div>
              </div>
              {(summaryQ.data?.slowSteps?.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">No step data yet</p>
              ) : (
                <div className="space-y-2.5">
                  {summaryQ.data!.slowSteps.map((s) => {
                    const maxAvg = Math.max(...summaryQ.data!.slowSteps.map((x) => x.avg_ms), 1);
                    return (
                      <div key={`${s.flow_name}-${s.step_id}`} className="group" title={`${s.flow_name} → ${s.step_id}: avg ${(s.avg_ms / 1000).toFixed(2)}s, max ${(s.max_ms / 1000).toFixed(2)}s over ${s.runs} runs`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-ink-muted">{s.flow_name} · {s.step_id}</span>
                          <span className="shrink-0 font-bold tabular-nums">{(s.avg_ms / 1000).toFixed(2)}s</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-700 group-hover:brightness-110"
                            style={{ width: `${(s.avg_ms / maxAvg) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ═══ QUICK ACTIONS ═══ */}
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted"><Zap className="h-3.5 w-3.5 text-ink-muted" /></div>
              <p className="text-sm font-semibold">Quick Actions</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "View all runs", desc: "Activity log", href: "/activity", icon: Activity, color: "hover:border-blue-300 hover:bg-blue-500/5" },
                { label: "Manage workflows", desc: `${stats.totalAutomations} total`, href: "/automations", icon: Workflow, color: "hover:border-violet-300 hover:bg-violet-500/5" },
                { label: "Check connections", desc: `${stats.connected} active`, href: "/connections", icon: Plug, color: "hover:border-teal/300 hover:bg-teal/5" },
                { label: "Browse apps", desc: "Explore catalog", href: "/apps", icon: Globe, color: "hover:border-amber-300 hover:bg-amber-500/5" },
              ].map((a) => (
                <Link key={a.href} href={a.href} className={cn("group flex items-center gap-3 rounded-xl border border-line p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-sm", a.color)}>
                  <a.icon className="h-4 w-4 text-ink-muted group-hover:text-ink" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="text-[10px] text-ink-muted">{a.desc}</span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

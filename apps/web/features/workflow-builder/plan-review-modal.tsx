"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Check, ChevronDown, ChevronUp, Database, FileText, Grid3X3, Layers, Loader2, MessageSquare, Plug, Sparkles, User, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CopilotPlanResult } from "@/lib/copilot";
import { AssetGraphVisualization, buildGraphFromPlan } from "@/features/copilot/asset-graph";

type PlanStep = { label: string; type: "trigger" | "action" | "logic" | "table" | "form" | "agent" | "chatbot" | "interface" | "canvas"; app: string };

type AssetType = "workflow" | "table" | "form" | "interface" | "canvas" | "agent" | "chatbot" | "system" | "modify" | "unknown";

type AssetDependency = { assetType: string; name: string; reason: string };

const ASSET_ICONS: Record<string, typeof Zap> = {
  workflow: Zap,
  table: Database,
  form: FileText,
  interface: Grid3X3,
  canvas: Layers,
  agent: Bot,
  chatbot: MessageSquare,
  system: Layers,
};

const ASSET_COLORS: Record<string, string> = {
  workflow: "bg-violet-600",
  table: "bg-blue-600",
  form: "bg-teal-600",
  interface: "bg-orange-600",
  canvas: "bg-pink-600",
  agent: "bg-emerald-600",
  chatbot: "bg-cyan-600",
  system: "bg-gradient-to-br from-violet-600 to-blue-600",
};

function AssetTypeBadge({ type, label }: { type: string; label?: string }) {
  const Icon = ASSET_ICONS[type] ?? Sparkles;
  const color = ASSET_COLORS[type] ?? "bg-muted";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white", color)}>
      <Icon className="h-2.5 w-2.5" />
      {label ?? type}
    </span>
  );
}

export function PlanReviewModal({ open, plan, loading, error, onConfirm, onCancel, onEdit, onClarify }: { open: boolean; plan: CopilotPlanResult | null; loading: boolean; error: string | null; onConfirm: () => void; onCancel: () => void; onEdit: () => void; onClarify?: (answers: Record<string, string>) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  if (!open) return null;
  // Support both legacy preview and enhanced AutomationPlan IR from the copilot-plan-builder
  const enhancedPlan = plan?.preview && typeof plan.preview === 'object' && 'steps' in (plan.preview as Record<string, unknown>) ? null : (plan as any)?.plan ?? null;
  const epSteps = enhancedPlan?.steps ?? [];
  const legacySteps: PlanStep[] = (plan?.preview?.steps ?? []) as PlanStep[];
  const steps: PlanStep[] = epSteps.length > 0 ? epSteps.map((s: any) => ({ label: s.label, type: s.type, app: s.appSlug ?? '' })) : legacySteps;
  const appsUsed = plan?.preview?.apps_used ?? epSteps.filter((s: any) => s.appSlug).map((s: any) => ({ name: s.label.split(' — ')[0] ?? s.appSlug, slug: s.appSlug }));
  const missingConns = plan?.preview?.missing_connections ?? (enhancedPlan?.attentionItems ?? []).filter((a: any) => a.kind === 'connect').map((a: any) => a.message);
  const missingInfo = plan?.preview?.missing_information ?? enhancedPlan?.missingInformation ?? [];
  const confidence = enhancedPlan?.confidence ?? plan?.preview?.confidence ?? plan?.confidence ?? 0;
  const summary = enhancedPlan?.summary ?? plan?.preview?.summary ?? plan?.reply ?? "";
  const rejectedOps = plan?.rejected_operations ?? []; const needsConfirmation = plan?.needs_confirmation ?? []; const questions = plan?.clarificationQuestions ?? [];

  // Detect asset type from plan metadata
  const assetType: AssetType = (plan as any)?.assetType ?? (steps.some((s) => s.type === "table") ? "system" : "workflow");
  const assetDependencies: AssetDependency[] = (plan as any)?.dependencies ?? [];
  const allRequiredAnswered = questions.filter((q) => q.required).every((q) => clarificationAnswers[q.question]?.trim());
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-[2px]">
    <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-line bg-elevated shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="relative overflow-hidden border-b border-line px-6 py-5"><div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 via-transparent to-blue-500/10" /><div className="relative flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><Sparkles className="h-5 w-5" /></span><div className="flex-1"><div className="flex items-center gap-2"><h2 className="text-base font-semibold">Plan & Review</h2><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-700">COPILOT</span></div><p className="mt-1 text-xs text-ink-muted">Review the plan, then let Copilot build the draft.</p></div><button type="button" className="rounded-xl p-2 text-ink-muted transition hover:bg-muted hover:text-ink" onClick={onCancel} aria-label="Close"><X className="h-4 w-4" /></button></div></div>
      {loading && !plan && <div className="flex flex-col items-center gap-4 px-6 py-14"><div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600"><span className="absolute inset-0 animate-ping rounded-2xl bg-violet-400/20" /><Sparkles className="relative h-6 w-6 animate-pulse" /></div><div className="text-center"><p className="text-sm font-semibold">Copilot is preparing your plan</p><p className="mt-1 text-xs text-ink-muted">Understanding apps, fields, connections, and workflow logic…</p></div><div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 animate-pulse rounded-full bg-violet-600" /></div></div>}
      {error && <div className="px-6 py-6"><div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /><div><p className="text-sm font-medium text-danger">Could not generate plan</p><p className="mt-1 text-xs text-ink-muted">{error}</p></div></div></div>}
      {plan && !loading && <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
        <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 to-transparent p-4"><div className="flex gap-3"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600/10 text-violet-600"><Bot className="h-4 w-4" /></span><div className="flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold text-violet-900">Here&apos;s what I understood</p><AssetTypeBadge type={assetType} /></div><p className="mt-1.5 text-sm leading-relaxed text-ink">{summary}</p></div></div></div>
        {questions.length > 0 && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4"><p className="text-sm font-semibold text-amber-900">A few details before building</p><div className="mt-3 space-y-3">{questions.map((q, qi) => <div key={qi}><p className="text-xs font-medium text-ink">{q.question}</p>{q.options?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{q.options.map((opt) => <button key={opt} type="button" className={cn("rounded-full border px-2.5 py-1 text-[11px] transition", clarificationAnswers[q.question] === opt ? "border-amber-500 bg-amber-100 font-medium text-amber-800" : "border-line bg-white text-ink hover:border-amber-300")} onClick={() => setClarificationAnswers((p) => ({ ...p, [q.question]: opt }))}>{clarificationAnswers[q.question] === opt && <Check className="mr-1 inline h-2.5 w-2.5" />}{opt}</button>)}</div> : <input type="text" className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2 text-xs outline-none focus:border-amber-400" placeholder="Type your answer…" value={clarificationAnswers[q.question] ?? ""} onChange={(e) => setClarificationAnswers((p) => ({ ...p, [q.question]: e.target.value }))} />}</div>)}</div></div>}
        {confidence > 0 && <div className="mt-4 rounded-xl bg-muted/50 p-3"><div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-medium text-ink-muted">Plan confidence</span><span className="text-[10px] font-semibold text-ink">{Math.round(confidence * 100)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-all", confidence >= .8 ? "bg-ok" : confidence >= .5 ? "bg-warn" : "bg-danger")} style={{ width: `${Math.round(confidence * 100)}%` }} /></div></div>}
        {assetDependencies.length > 0 && <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><p className="text-xs font-semibold text-blue-800"><Layers className="mr-1 inline h-3 w-3" />Asset dependencies</p><p className="mt-1 text-[11px] text-blue-600">This plan creates multiple interconnected assets:</p><div className="mt-3 space-y-2">{assetDependencies.map((dep, i) => { const Icon = ASSET_ICONS[dep.assetType] ?? Sparkles; return <div key={i} className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white/60 px-3 py-2"><span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white text-[9px] font-bold", ASSET_COLORS[dep.assetType] ?? "bg-muted")}><Icon className="h-3 w-3" /></span><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-ink">{dep.name}</p><p className="text-[10px] text-ink-muted">{dep.reason}</p></div><AssetTypeBadge type={dep.assetType} /></div>; })}</div></div>}
        {steps.length > 0 && <div className="mt-5"><button type="button" className="flex w-full items-center justify-between text-sm font-semibold" onClick={() => setExpanded((v) => !v)}><span>Workflow steps <span className="text-ink-muted">({steps.length})</span></span>{expanded ? <ChevronUp className="h-4 w-4 text-ink-muted" /> : <ChevronDown className="h-4 w-4 text-ink-muted" />}</button>{expanded && <div className="mt-3 rounded-2xl border border-line bg-muted/20 p-3">{steps.map((step, i) => <div key={i} className="flex items-center gap-2 py-1.5"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white", step.type === "trigger" ? "bg-violet-600" : step.type === "logic" ? "bg-amber-500" : "bg-blue-600")}>{step.type === "trigger" ? <Zap className="h-3 w-3" /> : step.type === "logic" ? <Bot className="h-3 w-3" /> : i + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-ink">{step.label}</p><p className="text-[10px] text-ink-muted">{step.app}</p></div>{i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-ink-muted" />}</div>)}</div>}</div>}
        {appsUsed.length > 0 && <div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Apps & connections</p><div className="mt-2 flex flex-wrap gap-1.5">{appsUsed.map((app: { name: string; slug: string }) => <span key={app.slug} className="rounded-full border border-line bg-muted px-2.5 py-1 text-xs text-ink">{app.name}</span>)}</div></div>}
        {missingConns.length > 0 && <div className="mt-4 rounded-2xl border border-warn/30 bg-warn/5 p-4"><p className="text-xs font-semibold text-warn"><Plug className="mr-1 inline h-3 w-3" />Needs your attention</p><ul className="mt-2 space-y-1">{missingConns.map((item: string) => <li key={item} className="text-xs text-ink">• {item}</li>)}</ul></div>}
        {enhancedPlan?.connections?.length ? (
          <div className="mt-3 rounded-2xl border border-line bg-muted/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Connection status</p>
            <div className="mt-2 space-y-1">
              {enhancedPlan.connections.map((conn: any, ci: number) => (
                <div key={ci} className="flex items-center gap-2 text-[11px]">
                  {conn.status === 'connected' ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ok/10"><Check className="h-2.5 w-2.5 text-ok" /></span>
                  ) : (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-warn/10"><Plug className="h-2.5 w-2.5 text-warn" /></span>
                  )}
                  <span className="text-ink-muted">{conn.appSlug}</span>
                  <span className={conn.status === 'connected' ? 'text-ok' : 'text-warn'}>{conn.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {/* Asset graph visualization for multi-asset plans */}
        {enhancedPlan?.steps && enhancedPlan.steps.length > 1 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Asset graph</p>
            <AssetGraphVisualization
              graph={buildGraphFromPlan({
                steps: enhancedPlan.steps.map((s: any) => ({
                  id: s.id,
                  type: s.type,
                  label: s.label,
                  appSlug: s.appSlug,
                  description: s.description,
                  connectionRequired: s.connectionRequired,
                  connectionId: s.connectionId,
                  dependsOn: s.dependsOn,
                })),
                connections: enhancedPlan.connections,
              })}
              compact
            />
          </div>
        )}
        {missingInfo.length > 0 && <div className="mt-3 rounded-2xl border border-line bg-muted/40 p-4"><p className="text-xs font-semibold">Still needed</p><ul className="mt-2 space-y-1">{missingInfo.map((item: string) => <li key={item} className="text-xs text-ink-muted">• {item}</li>)}</ul></div>}
        {rejectedOps.length > 0 && <div className="mt-3 rounded-2xl border border-danger/30 bg-danger/5 p-4"><p className="text-xs font-semibold text-danger"><AlertTriangle className="mr-1 inline h-3 w-3" />Some steps could not be created</p><ul className="mt-2 space-y-1">{rejectedOps.map((item, i) => <li key={i} className="text-xs text-ink"><b>{String((item.operation as Record<string, unknown>)?.kind ?? "operation")}:</b> {item.reason}</li>)}</ul></div>}
        {needsConfirmation.length > 0 && <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4"><p className="text-xs font-semibold text-amber-800"><AlertTriangle className="mr-1 inline h-3 w-3" />These steps need your approval</p><ul className="mt-2 space-y-1">{needsConfirmation.map((op, i) => <li key={i} className="text-xs text-amber-700">• {op.kind === "remove_node" ? "Remove a step" : op.kind}</li>)}</ul></div>}
      </div>}
      <div className="flex items-center justify-between border-t border-line bg-muted/20 px-6 py-4"><p className="text-[10px] text-ink-muted">Review first · Copilot won&apos;t publish or sign in</p><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onEdit}>Edit request</Button>{questions.length > 0 && onClarify && <Button size="sm" variant="secondary" onClick={() => onClarify(clarificationAnswers)} disabled={loading}>Update plan</Button>}<Button size="sm" onClick={onConfirm} disabled={loading || !plan || !allRequiredAnswered} className="bg-violet-600 text-white hover:bg-violet-700">{loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}{questions.length > 0 && !allRequiredAnswered ? "Answer details" : "Approve & build"}</Button></div></div>
    </div>
  </div>;
}

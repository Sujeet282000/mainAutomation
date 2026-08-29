"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Bot, CheckCircle2, CircleAlert, FileInput, Info, LayoutTemplate, Plug, Sparkles, Table2, Workflow, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { generateCopilotDraft, persistCopilotSession, planCopilotWorkflow, type CopilotPlanResult } from "@/lib/copilot";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { SkeletonCardGrid, SkeletonStatGrid } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PlanReviewModal } from "@/features/workflow-builder/plan-review-modal";
import { DashboardIdeaModal } from "@/components/copilot/dashboard-idea-modal";

export default function DashboardPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState<"analyzing" | "planning" | "creating" | null>(null);
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState<"idle" | "trigger" | "action">("idle");
  const [triggerHint, setTriggerHint] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planData, setPlanData] = useState<CopilotPlanResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const activeRequestRef = useRef(0);

  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string; status: string }> }>("/automations"),
  });
  const runs = useQuery({
    queryKey: ["executions"],
    queryFn: () => api<{ executions: Array<{ id: string; status: string; automation_name?: string; created_at: string }> }>("/executions"),
  });
  const billing = useQuery({
    queryKey: ["billing"],
    queryFn: () => api<{ plan?: string; usage?: Array<{ metric: string; quantity: string }> }>("/billing"),
  });
  const tables = useQuery({
    queryKey: ["tables"],
    queryFn: () => api<{ tables: Array<{ id: string; record_count?: number }> }>("/tables"),
  });
  const forms = useQuery({
    queryKey: ["forms"],
    queryFn: () => api<{ forms: Array<{ id: string; submission_count?: number }> }>("/forms"),
  });
  const totalRecords = (tables.data?.tables ?? []).reduce((sum, t) => sum + (t.record_count ?? 0), 0);
  const totalSubmissions = (forms.data?.forms ?? []).reduce((sum, f) => sum + (f.submission_count ?? 0), 0);
  const loading = autos.isLoading || runs.isLoading;
  const failed = autos.isError || runs.isError;
  const onCount = (autos.data?.automations ?? []).filter((a) => a.status === "on").length;
  const failedRuns = (runs.data?.executions ?? []).filter((r) => r.status === "failed").length;
  const drafts = (autos.data?.automations ?? []).filter((a) => a.status === "draft");

  /** Step 1: Analyze the user's request and show a plan */
  async function analyzeRequest(text: string) {
    const next = text.trim();
    if (!next) return;
    const thisRequest = ++activeRequestRef.current;
    setPendingPrompt(next);
    setPlanOpen(true);
    setPlanLoading(true);
    setPlanError(null);
    setPlanData(null);
    try {
      const result = await planCopilotWorkflow({ prompt: next, requestId: `req_${thisRequest}_${Date.now()}` });
      if (thisRequest === activeRequestRef.current) {
        setPlanData(result);
        toast.success("Analysis complete", { description: `Found ${result.preview?.steps?.length ?? 0} steps for your workflow` });
      }
    } catch (err) {
      if (thisRequest === activeRequestRef.current) {
        const errMsg = err instanceof Error ? err.message : "Could not analyze your request";
        setPlanError(errMsg);
        toast.error("Analysis failed", { description: errMsg });
      }
    } finally {
      if (thisRequest === activeRequestRef.current) setPlanLoading(false);
    }
  }

  /** Step 2: Build the workflow from the analyzed plan */
  async function buildFromPrompt(text: string) {
    const next = text.trim();
    if (!next) return;
    const vague = next.split(/\s+/).length < 6 && !/\b(when|if|every|gmail|slack|webhook|form)\b/i.test(next);
    if (vague && ask === "idle") {
      setPrompt(next);
      setAsk("trigger");
      setMsg("Tell Copilot what starts this, then what should happen.");
      return;
    }
    setBuilding(true);
    setBuildStage("creating");
    setPlanOpen(false);
    setMsg("");
    toast.info("Building workflow…", { description: "Creating your automation from the analyzed plan" });
    try {
      if (planData?.sessionId && planData?.graph) {
        // Use the analyzed plan's graph — the full pipeline already ran
        const created = await api<{ automation: { id: string } }>("/automations", {
          method: "POST",
          body: JSON.stringify({ name: next.slice(0, 60) || "Copilot draft", graph: planData.graph, origin: "copilot" }),
        });
        const flowId = created.automation.id;
        try {
          await api<{ ok: boolean; graph?: unknown }>(`/copilot/sessions/${planData.sessionId}/approve`, {
            method: "POST",
            body: JSON.stringify({ flowId }),
          });
          persistCopilotSession(planData.sessionId, flowId).catch(() => undefined);
        } catch { /* approval is best-effort */ }
        toast.success("Workflow created!", { description: `${next.slice(0, 40)}… is ready in the editor` });
        router.push(`/automations/${flowId}/editor?idea=${encodeURIComponent(next)}`);
        return;
      }
      // Fallback: run the full SSE-based copilot pipeline
      setBuildStage("analyzing");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const d = await generateCopilotDraft({ prompt: next, mode: "auto_build" }, undefined, controller.signal);
      clearTimeout(timeout);
      setBuildStage("creating");
      const created = await api<{ automation: { id: string } }>("/automations", {
        method: "POST",
        body: JSON.stringify({ name: next.slice(0, 60) || "Copilot draft", graph: d.graph, origin: "copilot" }),
      });
      persistCopilotSession(d.sessionId, created.automation.id).catch(() => undefined);
      toast.success("Workflow created!", { description: `Ready in the editor` });
      router.push(`/automations/${created.automation.id}/editor?idea=${encodeURIComponent(next)}`);
    } catch (err) {
      const errorMsg = err instanceof DOMException && err.name === "AbortError"
        ? "Copilot took too long. The AI service may be overloaded — try a simpler request."
        : err instanceof Error ? err.message : "Could not create workflow";
      setMsg(errorMsg);
      toast.error("Workflow creation failed", { description: errorMsg });
    } finally {
      setBuilding(false);
      setBuildStage(null);
    }
  }

  return (
    <div>
      <PlanReviewModal
        open={planOpen}
        plan={planData}
        loading={planLoading}
        error={planError}
        onConfirm={() => buildFromPrompt(pendingPrompt)}
        onCancel={() => { setPlanOpen(false); setPlanData(null); }}
        onEdit={() => { setPlanOpen(false); setPlanData(null); }}
        onClarify={async (answers) => {
          const enriched = [pendingPrompt, ...Object.entries(answers).filter(([, a]) => a?.trim()).map(([q, a]) => `${q}: ${a.trim()}`)].join(". ");
          setPendingPrompt(enriched);
          await analyzeRequest(enriched);
        }}
      />

      {/* Info modal */}
      {infoOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setInfoOpen(false)}>
          <div className="w-full max-w-md rounded-3xl border border-line bg-elevated p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600"><Sparkles className="h-5 w-5" /></span>
              <div className="flex-1"><h2 className="font-semibold">About Copilot</h2><p className="text-xs text-ink-muted">How the workflow assistant works</p></div>
              <button type="button" onClick={() => setInfoOpen(false)} className="rounded-xl p-2 text-ink-muted hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 space-y-3 text-sm leading-relaxed text-ink">
              <p>Copilot <strong>analyzes</strong> your request first — it identifies the trigger, actions, apps, and field mappings — then shows you a plan.</p>
              <p>Review the plan, then confirm to create the workflow. You can also clarify details before building.</p>
              <p className="text-xs text-ink-muted">Copilot is AI and can make mistakes. It cannot sign in or publish.</p>
            </div>
            <div className="mt-5 flex justify-end"><Button size="sm" onClick={() => setInfoOpen(false)}>Got it</Button></div>
          </div>
        </div>
      )}

      {/* Building overlay with stages */}
      {building && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-ink/35 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-elevated p-7 text-center shadow-2xl">
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600 text-white">
              <span className="absolute inset-0 animate-ping rounded-2xl bg-violet-400/30" />
              <Sparkles className="relative h-7 w-7 animate-pulse" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">Building your workflow</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {buildStage === "analyzing" && "Analyzing your request and mapping apps…"}
              {buildStage === "planning" && "Creating a step-by-step plan…"}
              {buildStage === "creating" && "Building workflow steps and preparing the editor…"}
            </p>
            <div className="mt-5 space-y-2 text-left text-xs">
              <div className="flex items-center gap-2 rounded-xl bg-muted p-2.5">
                <CheckCircle2 className="h-4 w-4 text-ok" /> Request analyzed
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-muted p-2.5">
                {buildStage === "creating" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <Spinner size={16} />}
                {buildStage === "creating" ? "Plan ready" : "Building plan…"}
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-muted p-2.5 text-ink-muted">
                {buildStage === null ? "○ Preparing editor" : <><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> Preparing editor</>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copilot hero */}
      <section className="mb-6 overflow-hidden rounded-3xl border border-line bg-elevated shadow-card">
        <div className="relative overflow-hidden px-6 pb-6 pt-5">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><Sparkles className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">Copilot</span>
                <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[9px] font-semibold text-ok">READY</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-2xl font-semibold">What would you like to automate?</h1>
                <button type="button" title="About Copilot" aria-label="About Copilot" onClick={() => setInfoOpen(true)} className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-muted hover:text-violet-600 dark:hover:bg-muted dark:hover:text-violet-300"><Info className="h-4 w-4" /></button>
                <DashboardIdeaModal onSelect={(idea) => { setPrompt(idea); void analyzeRequest(idea); }} />
              </div>
            </div>
          </div>
          <form
            className="relative mt-5 rounded-2xl border border-line bg-muted/30 p-3 transition focus-within:border-violet-400"
            onSubmit={(e) => { e.preventDefault(); void analyzeRequest(prompt); }}
          >
            <textarea
              className="min-h-[88px] w-full resize-none bg-transparent text-sm outline-none"
              placeholder="Describe what you want to automate… e.g. 'When a new Gmail arrives, summarize it with AI and send to Slack'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-relaxed text-ink-muted">
                Copilot analyzes your request, builds a plan, then creates the workflow. Review before anything runs.
              </p>
              <Button type="submit" disabled={building || planLoading || !prompt.trim()}>
                {building ? "Building…" : planLoading ? "Analyzing…" : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Analyze & Build</>}
              </Button>
            </div>
          </form>
          {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
          {ask !== "idle" && (
            <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
              <p className="text-xs font-medium text-violet-800">{ask === "trigger" ? "What starts this workflow?" : "Then what should happen?"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(ask === "trigger"
                  ? [["New Gmail", "When a new Gmail arrives"], ["On a schedule", "Every morning at 9am"], ["A webhook", "When a webhook is received"], ["A form submit", "When a form is submitted"]]
                  : [["Add a Sheets row", `${triggerHint}, add a Google Sheets row`], ["Notify Slack", `${triggerHint}, send a Slack message`], ["Send email", `${triggerHint}, send an email`], ["Call HTTP", `${triggerHint}, POST the data to an HTTP endpoint`]]
                ).map(([label, idea]) => (
                  <button key={label} type="button" className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs text-violet-800 hover:border-violet-400"
                    onClick={() => { if (ask === "trigger") { setTriggerHint(idea); setPrompt(idea); setAsk("action"); } else { setAsk("idle"); void analyzeRequest(idea); } }}
                  >{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Stats */}
      {loading && <SkeletonStatGrid count={6} />}
      {failed && <p className="mb-4 text-sm text-danger">{(autos.error as Error)?.message ?? "Could not load workspace."}</p>}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Card><div className="flex items-center gap-2 text-ink-muted"><Workflow className="h-4 w-4 text-violet-600" /> Workflows</div><div className="mt-2 text-2xl font-semibold">{autos.data?.automations.length ?? 0}</div><p className="mt-1 text-[11px] text-ink-muted">{onCount} active</p></Card>
          <Card><div className="flex items-center gap-2 text-ink-muted"><Activity className="h-4 w-4 text-violet-600" /> Runs</div><div className="mt-2 text-2xl font-semibold">{runs.data?.executions.length ?? 0}</div><Link href="/activity" className="mt-1 inline-flex items-center gap-1 text-[11px] text-violet-700">View all <ArrowRight className="h-3 w-3" /></Link></Card>
          <Card><div className="flex items-center gap-2 text-ink-muted"><Table2 className="h-4 w-4 text-teal" /> Tables</div><div className="mt-2 text-2xl font-semibold">{tables.data?.tables.length ?? 0}</div><p className="mt-1 text-[11px] text-ink-muted">{totalRecords} records</p></Card>
          <Card><div className="flex items-center gap-2 text-ink-muted"><FileInput className="h-4 w-4 text-blue-500" /> Forms</div><div className="mt-2 text-2xl font-semibold">{forms.data?.forms.length ?? 0}</div><p className="mt-1 text-[11px] text-ink-muted">{totalSubmissions} submissions</p></Card>
          <Card><div className="flex items-center gap-2 text-ink-muted"><Plug className="h-4 w-4 text-violet-600" /> Plan</div><div className="mt-2 text-2xl font-semibold capitalize">{billing.data?.plan ?? "—"}</div></Card>
          <Card><div className="flex items-center gap-2 text-ink-muted"><CircleAlert className="h-4 w-4 text-danger" /> Attention</div><div className="mt-2 text-2xl font-semibold">{failedRuns}</div><Link href="/activity?status=failed" className="mt-1 inline-flex items-center gap-1 text-[11px] text-violet-700">Review <ArrowRight className="h-3 w-3" /></Link></Card>
        </div>
      )}

      {/* Workspace health + quick start */}
      <div className="mt-7 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-semibold">Workspace health</p><p className="mt-1 text-xs text-ink-muted">A quick read on what needs your attention.</p></div>
            <CheckCircle2 className="h-5 w-5 text-ok" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Live workflows</p><p className="mt-1 text-xl font-semibold">{onCount}</p></div>
            <div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Drafts</p><p className="mt-1 text-xl font-semibold">{drafts.length}</p></div>
            <div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Failed runs</p><p className="mt-1 text-xl font-semibold text-danger">{failedRuns}</p></div>
          </div>
        </Card>
        <Card>
          <p className="text-sm font-semibold">Quick start</p>
          <div className="mt-3 grid gap-2">
            <Link href="/automations/new" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Workflow className="h-4 w-4 text-violet-600" /> Open workflow builder</Link>
            <Link href="/templates" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><LayoutTemplate className="h-4 w-4 text-violet-600" /> Start from a template</Link>
            <Link href="/connections" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Plug className="h-4 w-4 text-violet-600" /> Connect an account</Link>
            <Link href="/analytics" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Activity className="h-4 w-4 text-violet-600" /> View analytics</Link>
            <Link href="/apps" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Plug className="h-4 w-4 text-violet-600" /> Browse apps</Link>
            <Link href="/tables" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Table2 className="h-4 w-4 text-violet-600" /> Create workspace data</Link>
            <Link href="/ai" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Sparkles className="h-4 w-4 text-violet-600" /> Open Copilot</Link>
            <Link href="/agents" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Bot className="h-4 w-4 text-violet-600" /> Create an AI agent</Link>
          </div>
        </Card>
      </div>

      {/* Drafts to finish */}
      {drafts.length > 0 && (
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Finish setup</h2>
            <Link href="/automations" className="text-xs text-violet-700">View all workflows</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.slice(0, 3).map((a) => (
              <Link key={a.id} href={`/automations/${a.id}/editor`} className="group rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-xl bg-violet-100 p-2 text-violet-700"><Workflow className="h-5 w-5" /></div>
                  <span className="text-xs text-ink-muted">Draft</span>
                </div>
                <h3 className="mt-4 truncate font-semibold">{a.name}</h3>
                <p className="mt-1 text-xs text-ink-muted">Connect your steps and publish this workflow.</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-700">Continue setup <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Latest activity */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">Latest activity</h2>
      {runs.isLoading && <SkeletonCardGrid count={3} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(runs.data?.executions ?? []).slice(0, 8).map((r) => (
          <Link key={r.id} href={`/activity/${r.id}`} className="group rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-semibold">{r.automation_name ?? "Run"}</p><p className="mt-1 text-xs text-ink-muted">{new Date(r.created_at).toLocaleString()}</p></div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs">
              <span className="text-ink-muted">Workflow execution</span>
              <span className="font-medium text-violet-700">Open run <ArrowRight className="ml-1 inline h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

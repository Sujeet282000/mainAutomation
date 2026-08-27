"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Bot, CheckCircle2, CircleAlert, LayoutTemplate, Plug, Sparkles, Table2, Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { generateCopilotDraft, persistCopilotSession } from "@/lib/copilot";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState<"idle" | "trigger" | "action">("idle");
  const [triggerHint, setTriggerHint] = useState("");
  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string; status: string }> }>("/automations")
  });
  const runs = useQuery({
    queryKey: ["executions"],
    queryFn: () =>
      api<{ executions: Array<{ id: string; status: string; automation_name?: string; created_at: string }> }>("/executions")
  });
  const billing = useQuery({
    queryKey: ["billing"],
    queryFn: () => api<{ plan?: string; usage?: Array<{ metric: string; quantity: string }> }>("/billing")
  });

  const loading = autos.isLoading || runs.isLoading;
  const failed = autos.isError || runs.isError;
  const onCount = (autos.data?.automations ?? []).filter((a) => a.status === "on").length;
  const failedRuns = (runs.data?.executions ?? []).filter((r) => r.status === "failed").length;
  const drafts = (autos.data?.automations ?? []).filter((a) => a.status === "draft");

  async function buildFromPrompt(text: string) {
    const next = text.trim();
    if (!next) return;
    const vague = next.split(/\s+/).length < 6 && !/\b(when|if|every|gmail|slack|webhook|form)\b/i.test(next);
    if (vague && ask === "idle") {
      setPrompt(next);
      setAsk("trigger");
      setMsg("Tell Copilot what starts this, then what should happen. You can still type a full sentence and Build.");
      return;
    }
    setBuilding(true);
    setMsg("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const d = await generateCopilotDraft({ prompt: next, mode: "auto_build" }, undefined, controller.signal);
      clearTimeout(timeout);
      const created = await api<{ automation: { id: string } }>("/automations", {
        method: "POST",
        body: JSON.stringify({ name: next.slice(0, 60) || "Copilot draft", graph: d.graph, origin: "copilot" })
      });
      // Fire-and-forget persist — don't block navigation
      persistCopilotSession(d.sessionId, created.automation.id).catch(() => undefined);
      router.push(`/automations/${created.automation.id}/editor?idea=${encodeURIComponent(next)}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMsg("Copilot took too long. The workflow may still have been created — check your workflows.");
      } else {
        setMsg(err instanceof Error ? err.message : "Could not create workflow");
      }
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div>
      <section className="mb-6 overflow-hidden rounded-3xl border border-line bg-elevated p-6 shadow-card">
        <p className="inline-flex items-center gap-2 text-xs font-medium text-violet-700">
          <Sparkles className="h-4 w-4" /> Copilot
        </p>
        <h1 className="mt-2 text-2xl font-semibold">What should this workflow do?</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Describe a trigger and actions. Copilot outlines the draft, reuses a connected account when one exists, and maps fields it is confident about. You still connect missing apps, test, and publish.
        </p>
        <form
          className="mt-4 rounded-2xl border border-line bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void buildFromPrompt(prompt);
          }}
        >
          <textarea
            className="min-h-[88px] w-full resize-none bg-transparent text-sm outline-none"
            placeholder="Chat with Copilot — for example: When a Gmail arrives, add a Google Sheets row"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[10px] text-ink-muted">Copilot is AI and can make mistakes. It cannot sign in or publish.</p>
            <Button type="submit" disabled={building || !prompt.trim()}>
              {building ? "Working…" : "Build"}
            </Button>
          </div>
        </form>
        {msg && <p className="mt-2 text-sm text-ink-muted">{msg}</p>}
        {ask !== "idle" && (
          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3">
            <p className="text-xs font-medium text-violet-800">
              {ask === "trigger" ? "What starts this workflow?" : "Then what should happen?"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(ask === "trigger"
                ? [
                    ["New Gmail", "When a new Gmail arrives"],
                    ["On a schedule", "Every morning at 9am"],
                    ["A webhook", "When a webhook is received"],
                    ["A form submit", "When a form is submitted"],
                    ["I'll pick in the builder", prompt || "Start a blank workflow"]
                  ]
                : [
                    ["Add a Sheets row", `${triggerHint}, add a Google Sheets row`],
                    ["Notify Slack", `${triggerHint}, send a Slack message`],
                    ["Send email", `${triggerHint}, send an email`],
                    ["Call HTTP", `${triggerHint}, POST the data to an HTTP endpoint`],
                    ["Open the builder", triggerHint || prompt]
                  ]
              ).map(([label, idea]) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs text-violet-800 hover:border-violet-400"
                  onClick={() => {
                    if (ask === "trigger") {
                      setTriggerHint(idea);
                      setPrompt(idea);
                      setAsk("action");
                      return;
                    }
                    setAsk("idle");
                    void buildFromPrompt(idea);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "When a Gmail arrives, add a Google Sheets row",
            "Every morning, summarize today’s Calendar in Slack",
            "Catch a webhook and POST it to HTTP"
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:border-violet-300 hover:text-violet-700"
              onClick={() => setPrompt(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>
      {failed && <p className="mb-4 text-sm text-danger">{(autos.error as Error)?.message ?? "Could not load workspace."}</p>}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2 text-ink-muted">
            <Workflow className="h-4 w-4 text-violet-600" /> Workflows
          </div>
          <div className="mt-2 text-3xl font-semibold">{loading ? "—" : autos.data?.automations.length ?? 0}</div>
          <p className="mt-1 text-xs text-ink-muted">{onCount} published</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-ink-muted">
            <Activity className="h-4 w-4 text-violet-600" /> Recent runs
          </div>
          <div className="mt-2 text-3xl font-semibold">{loading ? "—" : runs.data?.executions.length ?? 0}</div>
          <Link href="/activity" className="mt-1 inline-flex items-center gap-1 text-xs text-violet-700">
            Open activity <ArrowRight className="h-3 w-3" />
          </Link>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-ink-muted">
            <Plug className="h-4 w-4 text-violet-600" /> Plan
          </div>
          <div className="mt-2 text-3xl font-semibold capitalize">{billing.data?.plan ?? "—"}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-ink-muted"><CircleAlert className="h-4 w-4 text-danger" /> Needs attention</div>
          <div className="mt-2 text-3xl font-semibold">{failedRuns}</div>
          <Link href="/activity?status=failed" className="mt-1 inline-flex items-center gap-1 text-xs text-violet-700">Review failures <ArrowRight className="h-3 w-3" /></Link>
        </Card>
      </div>
      <div className="mt-7 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Workspace health</p><p className="mt-1 text-xs text-ink-muted">A quick read on what needs your attention.</p></div><CheckCircle2 className="h-5 w-5 text-ok" /></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Live workflows</p><p className="mt-1 text-xl font-semibold">{onCount}</p></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Drafts</p><p className="mt-1 text-xl font-semibold">{drafts.length}</p></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-ink-muted">Failed runs</p><p className="mt-1 text-xl font-semibold text-danger">{failedRuns}</p></div></div>
        </Card>
        <Card><p className="text-sm font-semibold">Quick start</p><div className="mt-3 grid gap-2"><Link href="/automations/new" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Workflow className="h-4 w-4 text-violet-600" /> Open workflow builder</Link><Link href="/templates" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><LayoutTemplate className="h-4 w-4 text-violet-600" /> Start from a template</Link><Link href="/connections" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Plug className="h-4 w-4 text-violet-600" /> Connect an account</Link><Link href="/apps" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Plug className="h-4 w-4 text-violet-600" /> Browse apps</Link><Link href="/tables" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Table2 className="h-4 w-4 text-violet-600" /> Create workspace data</Link><Link href="/ai" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Sparkles className="h-4 w-4 text-violet-600" /> Open Copilot</Link><Link href="/agents" className="flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm hover:bg-muted"><Bot className="h-4 w-4 text-violet-600" /> Create an AI agent</Link></div></Card>
      </div>
      {drafts.length > 0 && <section className="mt-7"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Finish setup</h2><Link href="/automations" className="text-xs text-violet-700">View all workflows</Link></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{drafts.slice(0, 3).map((a) => <Link key={a.id} href={`/automations/${a.id}/editor`} className="group rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card"><div className="flex items-start justify-between gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-700"><Workflow className="h-5 w-5" /></div><span className="text-xs text-ink-muted">Draft</span></div><h3 className="mt-4 truncate font-semibold">{a.name}</h3><p className="mt-1 text-xs text-ink-muted">Connect your steps and publish this workflow.</p><span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-700">Continue setup <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></Link>)}</div></section>}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">Latest activity</h2>
      {runs.isLoading && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(runs.data?.executions ?? []).slice(0, 8).map((r) => (
          <Link key={r.id} href={`/activity/${r.id}`} className="group rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{r.automation_name ?? "Run"}</p><p className="mt-1 text-xs text-ink-muted">{new Date(r.created_at).toLocaleString()}</p></div><StatusBadge status={r.status} /></div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs"><span className="text-ink-muted">Workflow execution</span><span className="font-medium text-violet-700">Open run <ArrowRight className="ml-1 inline h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></div>
          </Link>
        ))}
      </div>
    </div>
  );
}

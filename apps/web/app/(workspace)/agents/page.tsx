"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, Play,
  Plus, ScrollText, Settings, Shield, ShieldCheck, Trash2, Wrench, XCircle, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

// ── Types (mirror the API surface) ───────────────────────────────────────────

type AgentTool = { appSlug: string; operation: string; connectionId?: string | null };
type Agent = {
  id: string;
  name: string;
  instructions?: string;
  knowledge?: string;
  model?: string | null;
  status?: string;
  automationId?: string | null;
  tools?: AgentTool[];
  approvalRequired?: boolean;
  maxActions?: number;
  triggerMode?: string;
};
type AppConn = { id: string; name: string; appSlug?: string; app_slug?: string; status: string };
type CatalogApp = { slug: string; name: string; authType?: string; operations: Array<{ key: string; name: string; type: string }> };
type ModelOption = { value: string; label: string; provider: string; available: boolean };
type AgentRun = {
  id: string;
  status: string;
  input_message: string;
  reply: string;
  rounds: number;
  stop_reason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string | null;
  created_at: string;
};
type RunEvent = { seq: number; type: string; at: string; data: Record<string, unknown> };
type AgentApproval = {
  id: string;
  agent_id: string;
  app_slug: string;
  operation: string;
  input: Record<string, unknown>;
  status: string;
  created_at: string;
};

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-ok/10 text-ok" },
  ok: { label: "Completed", cls: "bg-ok/10 text-ok" },
  running: { label: "Running", cls: "bg-violet-100 text-violet-700" },
  awaiting_approval: { label: "Awaiting approval", cls: "bg-amber-100 text-amber-700" },
  failed: { label: "Failed", cls: "bg-danger/10 text-danger" },
  blocked: { label: "Blocked", cls: "bg-danger/10 text-danger" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-ink-muted" },
  budget_exhausted: { label: "Budget reached", cls: "bg-amber-100 text-amber-700" },
};

function runStatus(s: string) {
  return RUN_STATUS[s] ?? { label: s, cls: "bg-muted text-ink-muted" };
}

// ── Tool picker ──────────────────────────────────────────────────────────────

function ToolPicker({ value, connections, catalog, onChange }: {
  value: AgentTool[];
  connections: AppConn[];
  catalog: CatalogApp[];
  onChange: (tools: AgentTool[]) => void;
}) {
  const [appSlug, setAppSlug] = useState("");
  const [opKey, setOpKey] = useState("");
  const byApp = useMemo(() => {
    const app = catalog.find((a) => a.slug === appSlug);
    return app?.operations.filter((o) => o.type !== "trigger") ?? [];
  }, [appSlug, catalog]);
  const appsWithConn = useMemo(
    () => catalog.filter((a) => (a.authType ?? "none") === "none" || connections.some((c) => (c.appSlug ?? c.app_slug) === a.slug)),
    [catalog, connections],
  );

  const add = () => {
    if (!appSlug || !opKey) return;
    if (value.some((t) => t.appSlug === appSlug && t.operation === opKey)) return;
    const conn = connections.find((c) => (c.appSlug ?? c.app_slug) === appSlug);
    onChange([...value, { appSlug, operation: opKey, connectionId: conn?.id ?? null }]);
    setAppSlug("");
    setOpKey("");
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2 text-xs text-ink-muted">
          No tools yet — the agent can answer questions but cannot act. Add allow-listed actions so it can work in your apps.
        </p>
      )}
      {value.map((t, i) => (
        <div key={`${t.appSlug}:${t.operation}:${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs">
          <Wrench className="h-3.5 w-3.5 text-violet-600" />
          <span className="font-medium text-ink">{t.appSlug}</span>
          <span className="text-ink-muted">· {t.operation}</span>
          {!t.connectionId && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">No account</span>}
          <button
            type="button"
            className="ml-auto rounded p-1 text-ink-muted hover:bg-muted hover:text-danger"
            aria-label={`Remove tool ${t.appSlug} ${t.operation}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <select
          className="flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs"
          value={appSlug}
          onChange={(e) => { setAppSlug(e.target.value); setOpKey(""); }}
          aria-label="Tool app"
        >
          <option value="">Choose app…</option>
          {appsWithConn.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>
        <select
          className="flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs"
          value={opKey}
          onChange={(e) => setOpKey(e.target.value)}
          disabled={!appSlug}
          aria-label="Tool action"
        >
          <option value="">Choose action…</option>
          {byApp.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" type="button" onClick={add} disabled={!appSlug || !opKey}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {appSlug && !connections.some((c) => (c.appSlug ?? c.app_slug) === appSlug) && (catalog.find((a) => a.slug === appSlug)?.authType ?? "none") !== "none" && (
        <p className="text-[11px] text-amber-600">This app has no connected account — connect it on the Connections page, or the tool will fail at run time.</p>
      )}
    </div>
  );
}

// ── Trace viewer (renders durable agent_run_events) ─────────────────────────

const EVENT_META: Record<string, { icon: typeof Zap; cls: string }> = {
  run_start: { icon: Play, cls: "text-violet-600" },
  round_start: { icon: Zap, cls: "text-violet-500" },
  model_response: { icon: Bot, cls: "text-violet-600" },
  tool_call_start: { icon: Wrench, cls: "text-teal" },
  tool_result: { icon: Check, cls: "text-ok" },
  tool_skipped: { icon: XCircle, cls: "text-ink-muted" },
  budget_exceeded: { icon: Clock, cls: "text-amber-600" },
  approval_required: { icon: Shield, cls: "text-amber-600" },
  run_complete: { icon: CheckCircle2, cls: "text-ok" },
  run_error: { icon: XCircle, cls: "text-danger" },
};

function TraceViewer({ runId, agentId }: { runId: string; agentId: string }) {
  const q = useQuery({
    queryKey: ["agent-run", agentId, runId],
    queryFn: () => api<{ run: AgentRun; events: RunEvent[] }>(`/agents/${agentId}/runs/${runId}`),
  });
  if (q.isLoading) return <div className="flex items-center gap-2 p-3 text-xs text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading trace…</div>;
  if (q.isError || !q.data) return <p className="p-3 text-xs text-danger">Could not load the trace for this run.</p>;
  const events = q.data.events ?? [];
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-muted/20 p-3">
      {events.length === 0 && <p className="text-xs text-ink-muted">No events recorded for this run.</p>}
      {events.map((ev) => {
        const meta = EVENT_META[ev.type] ?? { icon: Circle, cls: "text-ink-muted" };
        const Icon = meta.icon;
        const d = ev.data ?? {};
        let detail = "";
        if (ev.type === "model_response") detail = String(d.text ?? "").slice(0, 220);
        else if (ev.type === "tool_call_start") detail = `Calling ${d.name}`;
        else if (ev.type === "tool_result") detail = d.ok ? `${d.name} succeeded` : `${d.name} failed: ${String((d.error as { message?: string })?.message ?? "error")}`;
        else if (ev.type === "budget_exceeded") detail = `Budget reached: ${d.reason}`;
        else if (ev.type === "run_complete") detail = `Finished (${d.stopReason}) after ${d.rounds} round(s)`;
        else if (ev.type === "round_start") detail = `Round ${Number(d.round) + 1}`;
        return (
          <div key={ev.seq} className="flex items-start gap-2 text-xs">
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-elevated", meta.cls)}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{ev.type.replace(/_/g, " ")}</p>
              {detail && <p className="break-words text-ink-muted">{detail}</p>}
              <p className="text-[10px] text-ink-muted/70">{new Date(ev.at).toLocaleTimeString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Circle(props: { className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full bg-current", props.className)} />;
}

// ── Run history panel ────────────────────────────────────────────────────────

function RunHistory({ agent }: { agent: Agent }) {
  const q = useQuery({
    queryKey: ["agent-runs", agent.id],
    queryFn: () => api<{ runs: AgentRun[] }>(`/agents/${agent.id}/runs?limit=50`),
    refetchInterval: 15000,
  });
  const [openRun, setOpenRun] = useState<string | null>(null);
  const runs = q.data?.runs ?? [];
  if (q.isLoading) return <div className="flex items-center gap-2 p-3 text-xs text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading runs…</div>;
  if (!runs.length) {
    return <p className="rounded-lg border border-dashed border-line bg-muted/30 px-3 py-4 text-center text-xs text-ink-muted">No runs yet — send the agent a message to see its history here.</p>;
  }
  return (
    <div className="space-y-2">
      {runs.map((r) => {
        const st = runStatus(r.status);
        const open = openRun === r.id;
        return (
          <div key={r.id} className="rounded-xl border border-line bg-elevated">
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left" onClick={() => setOpenRun(open ? null : r.id)}>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", st.cls)}>{st.label}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.input_message || "(empty)"}</span>
              <span className="shrink-0 text-[10px] text-ink-muted">
                {r.rounds} round{r.rounds === 1 ? "" : "s"} · {r.usage?.outputTokens ? `${r.usage.outputTokens} out tok · ` : ""}{new Date(r.created_at).toLocaleString()}
              </span>
              {open ? <ChevronUp className="h-3.5 w-3.5 text-ink-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />}
            </button>
            {open && (
              <div className="border-t border-line px-3 py-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Agent reply</p>
                <p className="whitespace-pre-wrap text-xs text-ink">{r.reply || "—"}{r.error ? ` (${r.error})` : ""}</p>
                <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Run trace</p>
                <TraceViewer runId={r.id} agentId={agent.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Approvals panel ──────────────────────────────────────────────────────────

function AgentApprovals({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["agent-approvals", agent.id],
    queryFn: () => api<{ approvals: AgentApproval[] }>(`/agents/${agent.id}/approvals`),
    refetchInterval: 10000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const approvals = (q.data?.approvals ?? []).filter((a) => a.status === "pending");
  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    try {
      await api(`/agent-approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision }) });
      qc.invalidateQueries({ queryKey: ["agent-approvals", agent.id] });
    } finally {
      setBusy(null);
    }
  };
  if (!approvals.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-muted/30 px-3 py-4 text-xs text-ink-muted">
        <ShieldCheck className="h-4 w-4 text-ok" /> No pending approvals. With approval mode on, the agent must ask before every tool call.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {approvals.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-300/40 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-ink">
            {a.app_slug} · {a.operation}
          </p>
          <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-muted p-2 text-[10px] text-ink-muted">{JSON.stringify(a.input, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy === a.id} onClick={() => decide(a.id, "approved")}><ShieldCheck className="mr-1 h-3 w-3" /> Approve & run</Button>
            <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => decide(a.id, "rejected")}>Reject</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Config editor ────────────────────────────────────────────────────────────

function AgentConfigEditor({ agent, onSaved, onClose }: {
  agent: Agent;
  onSaved: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions ?? "");
  const [knowledge, setKnowledge] = useState(agent.knowledge ?? "");
  const [model, setModel] = useState(agent.model ?? "auto");
  const [tools, setTools] = useState<AgentTool[]>(agent.tools ?? []);
  const [approvalRequired, setApprovalRequired] = useState(agent.approvalRequired ?? false);
  const [maxActions, setMaxActions] = useState(agent.maxActions ?? 8);
  const [triggerMode, setTriggerMode] = useState(agent.triggerMode ?? "manual");
  const [automationId, setAutomationId] = useState(agent.automationId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const connectionsQ = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: AppConn[] }>("/connections") });
  const catalogQ = useQuery({ queryKey: ["sdk-apps"], queryFn: () => api<{ apps: CatalogApp[] }>("/sdk/apps") });
  const modelsQ = useQuery({ queryKey: ["model-options"], queryFn: () => api<{ options: ModelOption[] }>("/ai/model-options") });
  const automationsQ = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations") });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          instructions,
          knowledge,
          model: model === "auto" ? null : model,
          tools,
          approvalRequired,
          maxActions,
          triggerMode,
          automationId: automationId || null,
        }),
      });
      qc.invalidateQueries({ queryKey: ["agents"] });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-bg">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500"><Settings className="h-4 w-4 text-white" /></div>
            <span className="font-semibold">Agent settings</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={saving} onClick={save}>{saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}{saving ? "Saving…" : "Save"}</Button>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl space-y-5">
            {error && <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>}
            <Card className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Identity</p>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
            </Card>
            <Card className="space-y-2">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Behavior</p>
              <textarea className="min-h-[90px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Describe the agent's job, tone, and rules…" />
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Knowledge</p>
              <textarea className="min-h-[70px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder="Paste notes, docs, or facts the agent should know…" />
            </Card>
            <Card className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Model</p>
              <select className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm" value={model} onChange={(e) => setModel(e.target.value)}>
                {(modelsQ.data?.options ?? [{ value: "auto", label: "Auto (best available)", available: true }]).map((o) => (
                  <option key={o.value} value={o.value} disabled={!o.available}>{o.label}{o.available ? "" : " (key not configured)"}</option>
                ))}
              </select>
            </Card>
            <Card className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Tools (allow-list)</p>
              <ToolPicker value={tools} connections={connectionsQ.data?.connections ?? []} catalog={catalogQ.data?.apps ?? []} onChange={setTools} />
            </Card>
            <Card className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Guardrails & budgets</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} className="h-4 w-4 rounded border-line" />
                Require human approval before every tool call
              </label>
              <label className="flex items-center gap-2 text-sm">
                Max tool actions per run
                <input type="number" min={1} max={24} value={maxActions} onChange={(e) => setMaxActions(Number(e.target.value) || 8)} className="w-20 rounded-lg border border-line bg-elevated px-2 py-1 text-sm" />
              </label>
            </Card>
            <Card className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Workflow connection</p>
              <label className="flex items-center gap-2 text-sm">
                Trigger mode
                <select className="rounded-lg border border-line bg-elevated px-2 py-1 text-sm" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)}>
                  <option value="manual">Manual (chat only)</option>
                  <option value="monitor">Monitor</option>
                  <option value="event">Event-driven</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                Run workflow after successful runs
                <select className="max-w-[260px] flex-1 rounded-lg border border-line bg-elevated px-2 py-1 text-sm" value={automationId} onChange={(e) => setAutomationId(e.target.value)}>
                  <option value="">None</option>
                  {(automationsQ.data?.automations ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent detail (test chat + runs + approvals) ─────────────────────────────

function AgentDetail({ agent, onClose, onEdit }: { agent: Agent; onClose: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<"test" | "runs" | "approvals">("test");
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<Array<{ role: "user" | "agent"; text: string; status?: string }>>([]);
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();

  const send = async () => {
    const msg = message.trim();
    if (!msg || running) return;
    setMessage("");
    setLog((l) => [...l, { role: "user", text: msg }]);
    setRunning(true);
    try {
      const d = await api<{ reply: string; status: string; runId: string }>(`/agents/${agent.id}/run`, { method: "POST", body: JSON.stringify({ message: msg }) });
      setLog((l) => [...l, { role: "agent", text: d.reply, status: d.status }]);
      qc.invalidateQueries({ queryKey: ["agent-runs", agent.id] });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "The agent could not run.";
      const friendly = /NO_MODEL_PROVIDER|MODEL_PROVIDER_FAILED/i.test(raw)
        ? "All AI model providers failed. Check your provider API keys and billing, then try again."
        : /agent_activity_cap/.test(raw)
          ? "The workspace monthly agent activity cap was reached. Raise it in AI settings."
          : /agent_off/.test(raw)
            ? "This agent is switched off. Turn it on in settings."
            : raw;
      setLog((l) => [...l, { role: "agent", text: friendly, status: "failed" }]);
    } finally {
      setRunning(false);
    }
  };

  const isOff = agent.status === "off";

  return (
    <div className="fixed inset-0 z-50 flex bg-bg">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500"><Bot className="h-4 w-4 text-white" /></div>
            <div>
              <span className="font-semibold">{agent.name}</span>
              <p className="text-[11px] text-ink-muted">
                {agent.tools?.length ?? 0} tool{(agent.tools?.length ?? 0) === 1 ? "" : "s"} · {agent.approvalRequired ? "approval required" : "autonomous"}{isOff ? " · OFF" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit}><Settings className="mr-1 h-3 w-3" /> Settings</Button>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-line px-6">
          {([["test", "Test"], ["runs", `Run history`], ["approvals", "Approvals"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={cn("border-b-2 px-3 py-2 text-xs font-medium transition-colors", tab === key ? "border-violet-600 text-violet-700" : "border-transparent text-ink-muted hover:text-ink")}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {tab === "test" && (
              <>
                {log.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line bg-muted/30 px-3 py-4 text-center text-xs text-ink-muted">
                    Send a message to watch the agent plan, call tools, and answer. Every round is recorded in Run history.
                  </p>
                )}
                {log.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "ml-12" : "mr-12"}>
                    <div className={cn(
                      "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
                      m.role === "user" ? "ml-auto bg-violet-600 text-white rounded-br-md" : "bg-muted rounded-bl-md",
                      m.role === "agent" && m.status === "failed" && "border border-danger/30 bg-danger/5 text-danger",
                      m.role === "agent" && m.status === "awaiting_approval" && "border border-amber-300/50 bg-amber-500/5",
                    )}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder={isOff ? "This agent is off — enable it in settings" : "Send a message to the agent…"}
                    disabled={isOff || running}
                  />
                  <Button disabled={running || isOff || !message.trim()} onClick={send}>
                    {running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                    {running ? "Running…" : "Run"}
                  </Button>
                </div>
              </>
            )}
            {tab === "runs" && <RunHistory agent={agent} />}
            {tab === "approvals" && <AgentApprovals agent={agent} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/agents") });
  const [open, setOpen] = useState<Agent | null>(null);
  const [edit, setEdit] = useState<Agent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null);

  const agents = q.data?.agents ?? [];

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Proactive AI teammates that use allow-listed tools, knowledge, and workflows — with human approvals when it matters."
        actions={
          <div className="flex items-center gap-2">
            <PageInfo
              title="Agents"
              description="Agents are autonomous AI workers. Give them a job, allow-list the exact actions they may take, and review every run in history."
              tips={[
                "Describe the job in Behavior — clear instructions beat clever prompts.",
                "Add tools so the agent can act; without tools it can only answer.",
                "Turn on approval to require sign-off before every tool call.",
                "Link a workflow to chain the agent's result into your automations.",
                "Use Run history to audit every decision and tool call.",
              ]}
            />
            <Button onClick={() => { setCreateName("New Agent"); setCreateInstructions(""); setCreateOpen(true); }}>
              <Plus className="mr-1 h-3.5 w-3.5" />New agent
            </Button>
          </div>
        }
      />

      {!q.isLoading && !agents.length && (
        <EmptyState icon={<Bot className="h-10 w-10" />} title="No agents yet" description="Create an AI agent with tools, knowledge, and linked workflows." />
      )}

      {createOpen && (
        <Card className="mb-4 space-y-3">
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Agent name" autoFocus />
          <textarea className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={createInstructions} onChange={(e) => setCreateInstructions(e.target.value)} placeholder="What should this agent do? You can refine behavior, tools, and approvals in settings afterwards." />
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                if (!createName.trim()) return;
                const d = await api<{ agent: Agent }>("/agents", { method: "POST", body: JSON.stringify({ name: createName, instructions: createInstructions || "You are a helpful assistant." }) });
                setCreateOpen(false);
                setCreateName("");
                setCreateInstructions("");
                qc.invalidateQueries({ queryKey: ["agents"] });
                if (d.agent) setEdit(d.agent);
              }}
            >
              Create agent
            </Button>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => {
          const off = a.status === "off";
          return (
            <Card key={a.id} interactive className="group hover:border-violet-400/40" onClick={() => setOpen(a)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{a.name}</h3>
                    <p className="line-clamp-1 text-[11px] text-ink-muted">{a.instructions || "No instructions yet"}</p>
                  </div>
                </div>
                <button className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger" onClick={(e) => { e.stopPropagation(); setDeleteAgent(a); }} aria-label={`Delete ${a.name}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", off ? "bg-muted text-ink-muted" : "bg-ok/10 text-ok")}>{off ? "Off" : "Active"}</span>
                <span className="rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted">
                  <Wrench className="mr-0.5 inline h-2.5 w-2.5" />{a.tools?.length ?? 0} tools
                </span>
                {a.approvalRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"><Shield className="mr-0.5 inline h-2.5 w-2.5" />Approval</span>}
                {a.automationId && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"><ScrollText className="mr-0.5 inline h-2.5 w-2.5" />Workflow</span>}
              </div>
            </Card>
          );
        })}
      </div>

      {open && <AgentDetail agent={open} onClose={() => setOpen(null)} onEdit={() => { setEdit(open); }} />}
      {edit && <AgentConfigEditor agent={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setOpen(null); q.refetch(); }} />}
      <ConfirmDialog
        open={Boolean(deleteAgent)}
        title={`Delete "${deleteAgent?.name ?? ""}"?`}
        body="The agent, its run history, and pending approvals will be removed. This cannot be undone."
        confirmLabel="Delete agent"
        danger
        onCancel={() => setDeleteAgent(null)}
        onConfirm={async () => {
          if (!deleteAgent) return;
          await api(`/agents/${deleteAgent.id}`, { method: "DELETE" });
          setDeleteAgent(null);
          qc.invalidateQueries({ queryKey: ["agents"] });
        }}
      />
    </div>
  );
}

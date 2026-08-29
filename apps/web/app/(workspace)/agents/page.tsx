"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle, Clock, MoreVertical, Play, Plus, Settings, Shield, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Agent = { id: string; name: string; instructions: string; knowledge?: string; status: string; pod?: string | null; automation_id?: string | null; approval_required?: boolean };

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: "text-ok", bg: "bg-ok/10", label: "Active" },
  draft: { color: "text-ink-muted", bg: "bg-muted", label: "Draft" },
  running: { color: "text-violet-600", bg: "bg-violet-100", label: "Running" },
  error: { color: "text-danger", bg: "bg-danger/10", label: "Error" },
};

function AgentCard({ agent, onOpen, onDelete }: { agent: Agent; onOpen: () => void; onDelete: () => void }) {
  const st = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.draft;
  return (
    <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-violet-400/40" onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{agent.name}</h3>
            <p className="line-clamp-1 text-[11px] text-ink-muted">{agent.instructions}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", st.bg, st.color)}>{st.label}</span>
          <button className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.pod && <span className="rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted">Pod: {agent.pod}</span>}
        {agent.automation_id && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">→ Workflow</span>}
        {agent.approval_required && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"><Shield className="mr-0.5 inline h-2.5 w-2.5" />Approval</span>}
      </div>
    </Card>
  );
}

function AgentDetail({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [activities, setActivities] = useState<unknown[] | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex bg-bg">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500"><Bot className="h-4 w-4 text-white" /></div>
            <span className="font-semibold">{agent.name}</span>
          </div>
          <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-xl space-y-4">
              <Card>
                <p className="mb-1 text-[10px] font-semibold uppercase text-ink-muted">Instructions</p>
                <p className="text-sm text-ink">{agent.instructions}</p>
              </Card>
              {agent.knowledge && <Card><p className="mb-1 text-[10px] font-semibold uppercase text-ink-muted">Knowledge</p><p className="text-sm text-ink">{agent.knowledge}</p></Card>}
              <Card>
                <p className="mb-2 text-[10px] font-semibold uppercase text-ink-muted">Test the agent</p>
                <div className="flex gap-2">
                  <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Send a message to the agent..." />
                  <Button onClick={async () => {
                    const d = await api<{ reply: string }>(`/agents/${agent.id}/run`, { method: "POST", body: JSON.stringify({ message }) });
                    setReply(d.reply);
                    const act = await api<{ activities: unknown[] }>(`/agents/${agent.id}/activities`);
                    setActivities(act.activities);
                  }}><Play className="mr-1 h-3 w-3" />Run</Button>
                </div>
                {reply && <div className="mt-3 rounded-lg border border-teal/30 bg-teal/5 p-3 text-sm">{reply}</div>}
              </Card>
              {activities && activities.length > 0 && (
                <Card>
                  <p className="mb-2 text-[10px] font-semibold uppercase text-ink-muted">Recent activity</p>
                  <div className="space-y-1">
                    {activities.slice(0, 5).map((row, i) => (<pre key={i} className="overflow-auto rounded-lg bg-muted p-2 text-[11px]">{JSON.stringify(row, null, 2)}</pre>))}
                  </div>
                </Card>
              )}
            </div>
          </div>
          <div className="w-64 border-l border-line bg-elevated p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase text-ink-muted">Agent config</p>
            <div className="space-y-2 text-xs text-ink-muted">
              <p>Status: {agent.status}</p>
              {agent.pod && <p>Pod: {agent.pod}</p>}
              {agent.automation_id && <p>Workflow: Connected</p>}
              {agent.approval_required && <p className="flex items-center gap-1"><Shield className="h-3 w-3" />Requires approval</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/agents") });
  const [open, setOpen] = useState<Agent | null>(null);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");

  return (
    <div>        <PageHeader title="Agents" description="Proactive AI teammates that monitor triggers, use knowledge, and execute tool calls." actions={<div className="flex items-center gap-2"><PageInfo title="Agents" description="Agents are autonomous AI workers. They monitor triggers, use tools, and can run workflows." tips={["Give agents clear instructions on what to do and when.","Attach knowledge (notes, docs) so the agent has context.","Link a Workflow so the agent can execute actions.","Enable approval to require human sign-off before tool calls.","Test the agent with a message before going live."]} /><Button onClick={() => { setCreateName("New Agent"); setCreateInstructions(""); }}><Plus className="mr-1 h-3.5 w-3.5" />New agent</Button></div>} />

      {!q.isLoading && !q.data?.agents.length && (
        <EmptyState icon={<Bot className="h-10 w-10" />} title="No agents yet" description="Create an AI agent with tools, knowledge, and linked workflows." />
      )}

      {createName && (
        <Card className="mb-4 space-y-3">
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Agent name" autoFocus />
          <textarea className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={createInstructions} onChange={(e) => setCreateInstructions(e.target.value)} placeholder="What should this agent do?" />
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (!createName.trim()) return;
              await api("/agents", { method: "POST", body: JSON.stringify({ name: createName, instructions: createInstructions || "You are a helpful assistant." }) });
              setCreateName(""); setCreateInstructions(""); qc.invalidateQueries({ queryKey: ["agents"] });
            }}>Create agent</Button>
            <Button variant="ghost" onClick={() => { setCreateName(""); setCreateInstructions(""); }}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(q.data?.agents ?? []).map((a) => (
          <AgentCard key={a.id} agent={a} onOpen={() => setOpen(a)} onDelete={async () => {
            if (confirm(`Delete "${a.name}"?`)) { await api(`/agents/${a.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["agents"] }); }
          }} />
        ))}
      </div>

      {open && <AgentDetail agent={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

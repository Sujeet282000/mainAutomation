"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";

type Agent = {
  id: string;
  name: string;
  instructions: string;
  knowledge?: string;
  status: string;
  pod?: string | null;
  automation_id?: string | null;
};

export default function AgentsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/agents") });
  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations")
  });
  const [name, setName] = useState("Lead qualifier");
  const [instructions, setInstructions] = useState("Watch for high-value leads and start onboarding.");
  const [knowledge, setKnowledge] = useState("");
  const [pod, setPod] = useState("Sales");
  const [automationId, setAutomationId] = useState("");
  const [tools, setTools] = useState("[]");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [message, setMessage] = useState("A new deal closed over $50k.");
  const [reply, setReply] = useState("");
  const [activities, setActivities] = useState<unknown[] | null>(null);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Agents"
        description="Proactive AI teammates. Each agent can monitor a trigger workflow, use knowledge, and log activities (metered separately from Zap tasks)."
        actions={
          <Link href="/approvals">
            <Button variant="secondary">Approvals</Button>
          </Link>
        }
      />
      <Card className="mb-4 space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
        <Input value={pod} onChange={(e) => setPod(e.target.value)} placeholder="Pod (group related agents)" />
        <textarea
          className="min-h-[80px] w-full rounded-lg border border-line bg-elevated p-3 text-sm"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <textarea
          className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 text-sm"
          placeholder="Live knowledge / notes the agent can read"
          value={knowledge}
          onChange={(e) => setKnowledge(e.target.value)}
        />
        <select className="w-full rounded-lg border border-line bg-elevated p-2 text-sm" value={automationId} onChange={(e) => setAutomationId(e.target.value)}>
          <option value="">Linked workflow to run</option>
          {(autos.data?.automations ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <textarea
          className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 font-mono text-xs"
          placeholder='Allowed tools JSON, e.g. [{"appSlug":"slack","operation":"send_message","connectionId":"..."}]'
          value={tools}
          onChange={(e) => setTools(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
          Require approval before tool calls
        </label>
        <Button
          onClick={async () => {
            let parsed: unknown = [];
            try {
              parsed = JSON.parse(tools || "[]");
            } catch {
              setReply("Tools JSON is invalid.");
              return;
            }
            await api("/agents", {
              method: "POST",
              body: JSON.stringify({
                name,
                instructions,
                knowledge,
                pod,
                automationId: automationId || undefined,
                tools: parsed,
                approvalRequired
              })
            });
            qc.invalidateQueries({ queryKey: ["agents"] });
          }}
        >
          Create agent
        </Button>
      </Card>
      {!q.data?.agents.length && !q.isLoading && (
        <EmptyState icon={<Bot className="h-10 w-10" />} title="No agents" description="Describe what the agent should do, attach a published workflow, then run it." />
      )}
      {(q.data?.agents ?? []).map((a) => (
        <Card key={a.id} className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{a.name}</h3>
            <span className="text-xs uppercase text-ink-muted">{a.status}</span>
          </div>
          <p className="text-sm text-ink-muted">{a.instructions}</p>
          {a.pod && <p className="text-xs">Pod: {a.pod}</p>}
          <Input value={message} onChange={(e) => setMessage(e.target.value)} />
          <Button
            onClick={async () => {
              const d = await api<{ reply: string }>(`/agents/${a.id}/run`, {
                method: "POST",
                body: JSON.stringify({ message })
              });
              setReply(d.reply);
              const act = await api<{ activities: unknown[] }>(`/agents/${a.id}/activities`);
              setActivities(act.activities);
            }}
          >
            Run agent
          </Button>
        </Card>
      ))}
      {reply && <Card className="mt-2 text-sm">{reply}</Card>}
      {activities && (
        <Card className="mt-2 space-y-1 text-xs">
          <div className="font-semibold">Recent activity</div>
          {activities.slice(0, 8).map((row, i) => (
            <pre key={i} className="overflow-auto rounded bg-muted p-2">
              {JSON.stringify(row, null, 2)}
            </pre>
          ))}
        </Card>
      )}
    </div>
  );
}

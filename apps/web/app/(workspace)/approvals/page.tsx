"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type Hitl = { id: string; payload?: { message?: string }; created_at: string };
type AgentApproval = { id: string; app_slug: string; operation: string; created_at: string };

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<{ approvals: Hitl[] }>("/approvals")
  });
  const agents = useQuery({
    queryKey: ["agent-approvals"],
    queryFn: () => api<{ approvals: AgentApproval[] }>("/agent-approvals")
  });
  const pending = (q.data?.approvals.length ?? 0) + (agents.data?.approvals.length ?? 0);

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Workflow HITL steps and agent tool pauses. Decide here; the run or agent then continues."
      />
      {!q.isLoading && !agents.isLoading && pending === 0 && (
        <EmptyState title="No pending approvals" description="Approval steps and agents with approval required appear here." />
      )}
      <div className="grid gap-3">
        {(q.data?.approvals ?? []).map((a) => (
          <Card key={a.id}>
            <h3 className="font-semibold">{a.payload?.message ?? "Workflow approval"}</h3>
            <p className="mb-3 text-sm text-ink-muted">{new Date(a.created_at).toLocaleString()}</p>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  await api(`/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approved" }) });
                  qc.invalidateQueries({ queryKey: ["approvals"] });
                }}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "rejected" }) });
                  qc.invalidateQueries({ queryKey: ["approvals"] });
                }}
              >
                Reject
              </Button>
            </div>
          </Card>
        ))}
        {(agents.data?.approvals ?? []).map((a) => (
          <Card key={a.id}>
            <h3 className="font-semibold">
              Agent tool: {a.app_slug}:{a.operation}
            </h3>
            <p className="mb-3 text-sm text-ink-muted">{new Date(a.created_at).toLocaleString()}</p>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  await api(`/agent-approvals/${a.id}/decide`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "approved" })
                  });
                  qc.invalidateQueries({ queryKey: ["agent-approvals"] });
                }}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/agent-approvals/${a.id}/decide`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "rejected" })
                  });
                  qc.invalidateQueries({ queryKey: ["agent-approvals"] });
                }}
              >
                Reject
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

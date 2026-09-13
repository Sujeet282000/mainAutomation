"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCardGrid } from "@/components/ui/skeleton";

/** One normalized approval shape for BOTH backend domains:
 *  workflow HITL steps (todos) and agent tool pauses. */
type UnifiedApproval = {
  key: string;
  kind: "workflow" | "agent";
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
};

type Hitl = { id: string; payload?: { message?: string }; created_at: string };
type AgentApproval = { id: string; app_slug: string; operation: string; created_at: string };

const decideEndpoint = (kind: UnifiedApproval["kind"], id: string) =>
  kind === "workflow" ? `/approvals/${id}/decide` : `/agent-approvals/${id}/decide`;

export default function ApprovalsPage() {
  const qc = useQueryClient();

  const workflow = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<{ approvals: Hitl[] }>("/approvals"),
  });
  const agents = useQuery({
    queryKey: ["agent-approvals"],
    queryFn: () => api<{ approvals: AgentApproval[] }>("/agent-approvals"),
  });

  const approvals = useMemo<UnifiedApproval[]>(() => {
    const merged: UnifiedApproval[] = [
      ...(workflow.data?.approvals ?? []).map((a) => ({
        key: `workflow:${a.id}`,
        kind: "workflow" as const,
        id: a.id,
        title: a.payload?.message ?? "Workflow approval",
        subtitle: "Workflow — human in the loop",
        createdAt: a.created_at,
      })),
      ...(agents.data?.approvals ?? []).map((a) => ({
        key: `agent:${a.id}`,
        kind: "agent" as const,
        id: a.id,
        title: `Agent tool: ${a.app_slug}:${a.operation}`,
        subtitle: "Agent — approval required",
        createdAt: a.created_at,
      })),
    ];
    return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [workflow.data, agents.data]);

  const decide = useMutation({
    mutationFn: ({ approval, decision }: { approval: UnifiedApproval; decision: "approved" | "rejected" }) =>
      api(decideEndpoint(approval.kind, approval.id), { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === "approved" ? "Approved" : "Rejected");
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["agent-approvals"] });
    },
    onError: (err) => toast.error("Decision failed", { description: err instanceof Error ? err.message : "Unknown error" }),
  });

  const loading = workflow.isLoading || agents.isLoading;
  const errored = workflow.isError || agents.isError;

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Workflow HITL steps and agent tool pauses. Decide here; the run or agent then continues."
      />
      {loading && <SkeletonCardGrid count={3} />}
      {!loading && errored && (
        <div className="mb-3 rounded-xl border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm font-medium text-danger">Failed to load approvals</p>
          <p className="mt-1 text-xs text-danger/70">
            {(workflow.error ?? agents.error) instanceof Error ? ((workflow.error ?? agents.error) as Error).message : "Unknown error"}
          </p>
        </div>
      )}
      {!loading && !errored && approvals.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck className="h-10 w-10" />}
          title="No pending approvals"
          description="Approval steps and agents with approval required appear here."
        />
      )}
      {!loading && (
        <div className="grid gap-3">
          {approvals.map((a) => (
            <Card key={a.key} className="flex items-start justify-between gap-4 transition hover:border-violet-300">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{a.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{a.subtitle} · {new Date(a.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ approval: a, decision: "approved" })}
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ approval: a, decision: "rejected" })}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

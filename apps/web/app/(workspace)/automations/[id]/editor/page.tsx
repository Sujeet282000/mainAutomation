"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { defaultGraph, normalizeGraph } from "@/lib/normalize-graph";
import { WorkflowBuilder, type GraphPayload } from "@/features/workflow-builder/workflow-builder";

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["automation", id],
    queryFn: () =>
      api<{
        automation: { name: string; webhook_public_id?: string; status?: string };
        version?: { graph?: GraphPayload };
        graph?: GraphPayload;
      }>(`/automations/${id}`)
  });

  if (q.isLoading) return <p className="p-6 text-sm text-ink-muted">Loading builder…</p>;
  if (q.isError) return <p className="p-6 text-sm text-danger">{(q.error as Error).message}</p>;

  const graph = normalizeGraph(q.data?.graph ?? q.data?.version?.graph ?? defaultGraph());

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowBuilder
        automationId={id}
        name={q.data?.automation.name ?? "Automation"}
        initialGraph={graph}
        webhookPublicId={q.data?.automation.webhook_public_id}
        status={q.data?.automation.status}
      />
    </div>
  );
}

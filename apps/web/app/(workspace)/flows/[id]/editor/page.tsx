"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { defaultGraph, normalizeGraph } from "@/lib/normalize-graph";
import { WorkflowBuilder, type GraphPayload } from "@/features/workflow-builder/workflow-builder";

export default function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["flow", id],
    queryFn: () =>
      api<{
        flow: {
          id: string;
          name: string;
          status: string;
          draft_definition?: Record<string, unknown>;
          published_definition?: Record<string, unknown>;
          published_version_number?: number;
        };
      }>(`/flows/${id}`),
  });

  if (q.isLoading) return <p className="p-6 text-sm text-ink-muted">Loading builder…</p>;
  if (q.isError) return <p className="p-6 text-sm text-danger">{(q.error as Error).message}</p>;

  const flow = q.data?.flow;
  if (!flow) return <p className="p-6 text-sm text-ink-muted">Flow not found</p>;

  // Convert draft_definition (Activepieces format: { trigger, steps, ... })
  // or legacy graph format ({ nodes, edges }) to GraphPayload via normalizeGraph.
  const graph: GraphPayload = normalizeGraph(
    (q.data as { graph?: unknown } | undefined)?.graph ?? flow.draft_definition ?? defaultGraph(),
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkflowBuilder
        automationId={id}
        name={flow.name ?? "Workflow"}
        initialGraph={graph}
        status={flow.status === "active" ? "on" : flow.status === "disabled" ? "off" : "draft"}
      />
    </div>
  );
}

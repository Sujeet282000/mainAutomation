import { definitionHash, graphToFlowDefinition } from "@algoverge/core";
import { normalizeWorkflowGraph, type WorkflowGraph } from "@algoverge/shared";
import { query, queryOne } from "./db";

export function definitionPayload(graph: WorkflowGraph) {
  try {
    const definition = graphToFlowDefinition(graph);
    return { definition, hash: definitionHash(definition) };
  } catch {
    return { definition: null as null, hash: definitionHash(graph) };
  }
}

export async function insertAutomationVersion(automationId: string, versionNumber: number, graph: WorkflowGraph) {
  const { definition, hash } = definitionPayload(graph);
  try {
    return await queryOne<{ id: string }>(
      `insert into automation_versions (automation_id, version_number, graph, definition, definition_hash)
       values ($1,$2,$3,$4,$5) returning id`,
      [automationId, versionNumber, JSON.stringify(graph), definition ? JSON.stringify(definition) : null, hash]
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "42703") {
      return queryOne<{ id: string }>(
        `insert into automation_versions (automation_id, version_number, graph) values ($1,$2,$3) returning id`,
        [automationId, versionNumber, JSON.stringify(graph)]
      );
    }
    throw err;
  }
}

export async function persistCopilotDraft(opts: {
  automationId: string;
  workspaceId: string;
  graph: WorkflowGraph;
}) {
  const { persistBuilderDraft } = await import("./flow-runtime");
  const flow = await queryOne<{ id: string }>(
    `select id from flows where id=$1 and org_id=$2`,
    [opts.automationId, opts.workspaceId]
  );
  if (flow) {
    await query(`update flows set draft_definition=$3, updated_at=now() where id=$1 and org_id=$2`, [
      opts.automationId,
      opts.workspaceId,
      JSON.stringify(persistBuilderDraft(opts.graph))
    ]);
    return flow.id;
  }
  const owned = await queryOne<{ id: string }>(
    `select id from automations where id=$1 and workspace_id=$2 and deleted_at is null`,
    [opts.automationId, opts.workspaceId]
  );
  if (!owned) throw new Error("automation_not_found");
  const graph = normalizeWorkflowGraph(opts.graph);
  const current = await queryOne<{ version_number: number; published_at: string | null }>(
    `select version_number, published_at from automation_versions where automation_id=$1 order by version_number desc limit 1`,
    [opts.automationId]
  );
  const version = await insertAutomationVersion(opts.automationId, (current?.version_number ?? 0) + 1, graph);
  await query(`update automations set current_version_id=$1, updated_at=now() where id=$2 and workspace_id=$3`, [
    version!.id,
    opts.automationId,
    opts.workspaceId
  ]);
  return version!.id;
}

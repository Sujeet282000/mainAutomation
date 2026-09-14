import { coerceWorkflowGraph, definitionHash, graphToFlowDefinition } from "@algoverge/core";
import type { WorkflowGraph } from "@algoverge/shared";
import { encryptJson, decryptJson } from "./crypto";
import { query, queryOne, withTransaction } from "./db";
import { queues } from "./queue";
import { buildTriggerEnvelope } from "./trigger-envelope";

/** Draft persistence is lossless: invalid graphs throw instead of becoming fake zero-step definitions. */
export function persistBuilderDraft(graph: unknown) {
  const def = graphToFlowDefinition(graph);
  return { ...def, builderGraph: graph };
}

/**
 * Lenient draft persistence for work-in-progress graphs: the builder autosaves
 * on every keystroke and Copilot proposals may be temporarily incomplete
 * (unwired nodes, missing config). Those must STORE, not 400. Compilation
 * still gates everything that EXECUTES: manual tests, publish and run paths
 * keep using the strict persistBuilderDraft.
 */
export function persistBuilderDraftLenient(graph: unknown) {
  try {
    const def = graphToFlowDefinition(graph);
    return { ...def, builderGraph: graph };
  } catch (err) {
    return {
      builderGraph: graph,
      compile_error: err instanceof Error ? err.message : "graph_compile_failed",
    };
  }
}
export function loadBuilderGraph(draft: unknown): WorkflowGraph { const rec = draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {}; if (rec.builderGraph) return coerceWorkflowGraph(rec.builderGraph); return coerceWorkflowGraph(draft); }

export async function ensureRunPartition() { const dates = [new Date(), new Date()]; dates[1].setUTCMonth(dates[1].getUTCMonth() + 1); for (const date of dates) { const start = new Date(date); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); const name = `flow_runs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`; const lit = (d: Date) => `'${d.toISOString().slice(0, 19).replace("T", " ")}'`; try { await query(`CREATE TABLE IF NOT EXISTS public."${name}" PARTITION OF public.flow_runs FOR VALUES FROM (${lit(start)}) TO (${lit(end)})`); } catch {} } }

export async function ensureFlowVersion(opts: { orgId: string; flowId: string; definition: unknown; userId?: string }) { const hash = definitionHash(opts.definition); const exact = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition=$2::jsonb`, [opts.flowId, JSON.stringify(opts.definition)]); if (exact) return exact.id; const last = await queryOne<{ version_number: number }>(`SELECT version_number FROM flow_versions WHERE flow_id=$1 ORDER BY version_number DESC LIMIT 1`, [opts.flowId]); try { const created = await queryOne<{ id: string }>(`INSERT INTO flow_versions (org_id,flow_id,definition,definition_hash,version_number,published_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING id`, [opts.orgId,opts.flowId,JSON.stringify(opts.definition),hash,(last?.version_number ?? 0) + 1, opts.userId ?? null]); if (!created) throw new Error("FLOW_VERSION_CREATE_FAILED"); return created.id; } catch (err: any) { if (err && typeof err === "object" && (err as any).code === "23505") { const raced = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition=$2::jsonb`, [opts.flowId, JSON.stringify(opts.definition)]); if (raced) return raced.id; } throw err; } }

export async function loadConnectionSecret(connectionId: string | null | undefined, orgId: string) { if (!connectionId) return null; try { const { ensureFreshToken } = await import("./oauth-refresh"); const piece = await queryOne<{ piece_name: string }>(`SELECT piece_name FROM connections WHERE id=$1 AND org_id=$2`, [connectionId,orgId]); const fresh = await ensureFreshToken(connectionId,orgId,piece?.piece_name ?? ""); if (fresh) return fresh; } catch {} const row = await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown }>(`SELECT ciphertext,encrypted_payload FROM connections WHERE id=$1 AND org_id=$2`, [connectionId,orgId]); if (!row) return null; if (row.ciphertext) return decryptJson(row.ciphertext,orgId); if (row.encrypted_payload && typeof row.encrypted_payload === "object") { const blob = row.encrypted_payload as { _enc?: string }; if (blob._enc) return decryptJson(Buffer.from(blob._enc,"base64"),orgId); return row.encrypted_payload as Record<string,unknown>; } return null; }
export async function sealConnectionSecret(orgId: string, credentials: Record<string, unknown>) { const buf = encryptJson(credentials,orgId); return { ciphertext: buf, encrypted_payload: { _enc: buf.toString("base64") } }; }

/** Test Step uses the exact durable production path and stops the canonical Executor at the requested node. */
export async function testFlowStep(opts:{orgId:string;flowId:string;nodeId:string;graph:unknown;inputs?:Record<string,unknown>}) {
  const graph = loadBuilderGraph(opts.graph);
  if (!graph.nodes.some((n) => n.id === opts.nodeId)) throw new Error("Step not found");
  const started = Date.now();
  const execution = await createAndRunFlow({ orgId: opts.orgId, flowId: opts.flowId, userId: undefined, payload: { ...(opts.inputs ?? {}) }, graph: opts.graph, triggerKind: "manual_test", testTargetStepId: opts.nodeId });
  const runId = execution.id;
  for (let attempt = 0; attempt < 240; attempt++) {
    const run = await queryOne<{ status: string; flow_version_id: string }>(`SELECT status, flow_version_id FROM flow_runs WHERE id=$1`, [runId]);
    if (!run) return { ok:false, output:undefined, error:"Test run disappeared", duration_ms:Date.now()-started, status:"failed", runId };
    const mapping = await resolveNodeIds(run.flow_version_id);
    const engineStepId = Object.entries(mapping).find(([, builderId]) => builderId === opts.nodeId)?.[0];
    if (engineStepId) {
      const step = await queryOne<{ status:string; output_json:unknown; error_json:unknown; duration_ms:number|null }>(`SELECT status, output_json, error_json, duration_ms FROM run_steps WHERE run_id=$1 AND step_id=$2 ORDER BY attempt DESC LIMIT 1`, [runId, engineStepId]);
      if (step?.status === "succeeded") return { ok:true, output:step.output_json, error:undefined, duration_ms:step.duration_ms ?? Date.now()-started, status:"succeeded", runId };
      if (step?.status === "failed") return { ok:false, output:undefined, error:step.error_json ?? "Step failed", duration_ms:step.duration_ms ?? Date.now()-started, status:"failed", runId };
    }
    if (["failed","filtered","cancelled","succeeded"].includes(run.status)) {
      // If a predecessor failed before the requested target could execute,
      // surface the real provider/adapter error instead of the misleading
      // "finished before target" message.
      const failed = await queryOne<{ step_id:string; error_json:unknown }>(
        `SELECT step_id, error_json FROM run_steps WHERE run_id=$1 AND status='failed' ORDER BY sequence_no ASC, attempt ASC LIMIT 1`,
        [runId]
      );
      if (failed) {
        return {
          ok:false,
          output:undefined,
          error:failed.error_json ?? "Step failed",
          failedStepId: failed.step_id,
          failedNodeId: mapping[failed.step_id],
          duration_ms:Date.now()-started,
          status:"failed",
          runId
        };
      }
      return { ok:false, output:undefined, error:run.status === "filtered" ? "Workflow stopped before the target step" : "Workflow finished before the target step", duration_ms:Date.now()-started, status:run.status, runId };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok:false, output:undefined, error:"Test step timed out waiting for the workflow engine", duration_ms:Date.now()-started, status:"failed", runId };
}

export async function createAndRunFlow(opts:{orgId:string;flowId:string;userId?:string;payload?:Record<string,unknown>;graph?:unknown;triggerKind?:string;eventId?:string|null;idempotencyKey?:string|null;receivedAt?:string;replaySteps?:Record<string,Record<string,unknown>>;testTargetStepId?:string;onStepComplete?: (step:{stepId:string;status:string;output?:unknown;error?:string;durationMs?:number})=>void}) { await ensureRunPartition(); const flow=await queryOne<{id:string;project_id:string;draft_definition:unknown;published_version_id:string|null}>(`SELECT id,project_id,draft_definition,published_version_id FROM flows WHERE id=$1 AND org_id=$2`,[opts.flowId,opts.orgId]); if(!flow)throw new Error("Flow not found"); const isTest=opts.triggerKind==="test"||opts.triggerKind==="manual_test"; let versionId:string; if(isTest){const draft=persistBuilderDraft(opts.graph ?? loadBuilderGraph(flow.draft_definition)); versionId=await ensureFlowVersion({orgId:opts.orgId,flowId:flow.id,definition:draft,userId:opts.userId});} else {if(!flow.published_version_id)throw new Error("FLOW_NOT_PUBLISHED"); const published=await queryOne<{id:string}>(`SELECT id FROM flow_versions WHERE id=$1 AND flow_id=$2`,[flow.published_version_id,flow.id]); if(!published)throw new Error("PUBLISHED_FLOW_VERSION_NOT_FOUND"); versionId=published.id; } let projectId=flow.project_id; if(!projectId){const project=await queryOne<{id:string}>(`SELECT id FROM projects WHERE org_id=$1 LIMIT 1`,[opts.orgId]); projectId=project?.id; if(!projectId){const created=await queryOne<{id:string}>(`INSERT INTO projects (org_id,name,slug) VALUES ($1,'Default','default') RETURNING id`,[opts.orgId]);projectId=created!.id;} await query(`UPDATE flows SET project_id=$1 WHERE id=$2`,[projectId,flow.id]);} const triggerEnvelope=buildTriggerEnvelope({workspaceId:opts.orgId,organizationId:opts.orgId,automationId:flow.id,versionId,triggerType:opts.triggerKind ?? "manual",payload:opts.payload ?? {ping:true},eventId:opts.eventId,idempotencyKey:opts.idempotencyKey,receivedAt:opts.receivedAt}); const claimed=await withTransaction(async(client)=>{ if(triggerEnvelope.idempotencyKey){const claim=await client.query<{flow_run_id:string|null}>(`INSERT INTO trigger_events (org_id,workspace_id,automation_id,version_id,event_id,trigger_type,received_at,idempotency_key,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (org_id,idempotency_key) DO NOTHING RETURNING flow_run_id`,[opts.orgId,opts.orgId,flow.id,versionId,triggerEnvelope.eventId,triggerEnvelope.triggerType,triggerEnvelope.receivedAt,triggerEnvelope.idempotencyKey,JSON.stringify(triggerEnvelope.payload)]); if(!claim.rows[0]){const existing=await client.query<{flow_run_id:string|null}>(`SELECT flow_run_id FROM trigger_events WHERE org_id=$1 AND idempotency_key=$2 FOR UPDATE`,[opts.orgId,triggerEnvelope.idempotencyKey]); if(existing.rows[0]?.flow_run_id)return {id:existing.rows[0].flow_run_id,duplicate:true}; throw new Error("TRIGGER_EVENT_CLAIM_INCOMPLETE");}} const inserted=await client.query<{id:string}>(`INSERT INTO flow_runs (org_id,project_id,flow_id,flow_version_id,trigger_kind,trigger_event_id,idempotency_key,status,context) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8) RETURNING id`,[opts.orgId,projectId,flow.id,versionId,triggerEnvelope.triggerType,triggerEnvelope.eventId,triggerEnvelope.idempotencyKey,JSON.stringify({trigger:triggerEnvelope.payload,...(opts.replaySteps?{__replaySteps:opts.replaySteps}:{}),...(opts.testTargetStepId?{__testTargetStepId:opts.testTargetStepId}:{})})]); const created=inserted.rows[0]; if(!created)throw new Error("Failed to create execution run record."); if(triggerEnvelope.idempotencyKey)await client.query(`UPDATE trigger_events SET flow_run_id=$1 WHERE org_id=$2 AND idempotency_key=$3`,[created.id,opts.orgId,triggerEnvelope.idempotencyKey]); return {id:created.id,duplicate:false}; }); if(claimed.duplicate)return {id:claimed.id,duplicate:true}; await queues.flowSteps.add("transition",{runId:claimed.id,orgId:opts.orgId,cursor:0,epoch:0},{jobId:`step-${claimed.id}-0-0`,attempts:3,backoff:{type:"exponential",delay:1000},removeOnComplete:1000,removeOnFail:5000}); return {id:claimed.id}; }

export async function resolveStepNames(flowVersionId: string | null | undefined): Promise<Record<string, string>> { if (!flowVersionId) return {}; const row = await queryOne<{ definition: { steps?: Array<{ id: string; name?: string; piece?: { name?: string } }>; trigger?: { id: string; name?: string; piece?: { name?: string }; type?: string } } }>(`SELECT definition FROM flow_versions WHERE id=$1`, [flowVersionId]); const names: Record<string, string> = {}; const trigger = row?.definition?.trigger; if (trigger?.id) names[trigger.id] = trigger.name ?? (trigger.type === "app_event" ? `${trigger.piece?.name ?? "App"} trigger` : "Manual trigger"); for (const step of row?.definition?.steps ?? []) if (step.id) names[step.id] = step.name ?? step.piece?.name ?? step.id; return names; }

function engineStepIdForBuilderNode(rawId: string, isTrigger: boolean, used: Set<string>) { let s = String(rawId || "step").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""); if (!s) s = "step"; if (!/^[a-z]/.test(s)) s = `s_${s}`; s = s.slice(0, 64); if (isTrigger) return "trigger"; let id = s; let n = 2; while (used.has(id)) { const suffix = `_${n}`; id = `${s.slice(0, 64 - suffix.length)}${suffix}`; n += 1; } used.add(id); return id; }
export async function resolveNodeIds(flowVersionId: string | null | undefined): Promise<Record<string, string>> { if (!flowVersionId) return {}; const row = await queryOne<{ definition: { builderGraph?: { nodes?: Array<{ id: string; type?: string }> } } }>(`SELECT definition FROM flow_versions WHERE id=$1`, [flowVersionId]); const nodes = row?.definition?.builderGraph?.nodes ?? []; const map: Record<string, string> = {}; const used = new Set<string>(["trigger"]); for (const node of nodes) { if (!node?.id) continue; map[engineStepIdForBuilderNode(node.id, node.type === "trigger", used)] = node.id; } return map; }
export function mapRunToExecution(row:Record<string,unknown>,steps:Array<Record<string,unknown>>=[],stepNames:Record<string,string>={},nodeIds:Record<string,string>={}) { const firstFailed=steps.find((s)=>s.status==="failed"); const baseStatus=String(row.status ?? ""); const status=baseStatus==="succeeded"&&firstFailed?"handled_error":baseStatus; const runError=typeof firstFailed?.error_json==="object"&&firstFailed?.error_json?firstFailed.error_json:firstFailed?.error_json?{message:String(firstFailed.error_json)}:{message:"Run failed"}; const rawContext=typeof row.context==="string"?(()=>{try{return JSON.parse(row.context as string);}catch{return null;}})():row.context; const triggerPayload=(rawContext as {trigger?:unknown}|null|undefined)?.trigger; return {execution:{id:row.id,status,automation_name:row.flow_name,automation_id:row.flow_id,trigger_type:row.trigger_kind,created_at:row.created_at,finished_at:row.finished_at,error:baseStatus==="failed"?runError:undefined,trigger_payload:triggerPayload},steps:steps.map((s)=>({id:s.id,step_id:s.step_id,node_id:nodeIds[s.step_id as string],name:stepNames[s.step_id as string] ?? s.step_id,status:s.status,duration_ms:s.duration_ms,error:typeof s.error_json==="object"&&s.error_json?s.error_json:s.error_json?{message:String(s.error_json)}:undefined,output:s.output_json,input:s.input_json,app_slug:s.step_type,operation:s.operation_id,attempt:s.attempt,started_at:s.started_at,finished_at:s.finished_at})),logs:[]}; }
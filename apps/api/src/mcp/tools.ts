import { z } from "zod";
import { query, queryOne } from "../db";
export { MCP_TOOL_DEFS, toolAllowed, type McpSession } from "./defs";
import type { McpSession } from "./defs";

export async function invokeMcpTool(session: McpSession, name: string, args: Record<string, unknown>) {
  const org = session.organizationId;
  switch (name) {
    case "list_automations":
      return query(
        `select id, name, status, published_version_id, updated_at from flows
         where org_id=$1 order by updated_at desc`,
        [org]
      );
    case "get_automation": {
      const automationId = z.string().uuid().parse(args.automationId);
      const automation = await queryOne(`select * from flows where id=$1 and org_id=$2`, [automationId, org]);
      if (!automation) throw new Error("not_found");
      const version = await queryOne(
        `select id, version_number, definition, published_at, created_at from flow_versions
         where flow_id=$1 order by version_number desc limit 1`,
        [automationId]
      );
      return { automation, version };
    }
    case "run_automation": {
      const automationId = z.string().uuid().parse(args.automationId);
      const auto = await queryOne<{ id: string; status: string }>(
        `select id, status from flows where id=$1 and org_id=$2`,
        [automationId, org]
      );
      if (!auto) throw new Error("not_found");
      if (auto.status !== "active") throw new Error("automation_not_published");
      const { createAndRunFlow } = await import("../flow-runtime");
      const run = await createAndRunFlow({
        orgId: org,
        flowId: automationId,
        userId: "mcp",
        payload: (args.payload as Record<string, unknown>) ?? { source: "mcp" },
        triggerKind: "mcp"
      });
      return { run };
    }
    case "list_executions": {
      const limit = Math.min(Number(args.limit ?? 50), 100);
      return query(
        `select r.id, r.status, r.trigger_kind as trigger_type, r.created_at, f.name as automation_name
         from flow_runs r join flows f on f.id=r.flow_id
         where r.org_id=$1 order by r.created_at desc limit $2`,
        [org, limit]
      );
    }
    case "get_execution": {
      const executionId = z.string().uuid().parse(args.executionId);
      const execution = await queryOne(`select * from flow_runs where id=$1 and org_id=$2`, [executionId, org]);
      if (!execution) throw new Error("not_found");
      const steps = await query(`select * from run_steps where run_id=$1 order by started_at asc`, [executionId]);
      return { execution, steps };
    }
    case "list_connections":
      return query(
        `select id, piece_name as app_slug, label as name, auth_type, status, created_at from connections
         where org_id=$1 order by created_at desc`,
        [org]
      );
    case "list_tables":
      return query(`select id, name, schema_json, created_at from data_tables where org_id=$1 order by created_at desc`, [org]);
    case "list_table_records": {
      const tableId = z.string().uuid().parse(args.tableId);
      const table = await queryOne(`select id from data_tables where id=$1 and org_id=$2`, [tableId, org]);
      if (!table) throw new Error("not_found");
      return query(`select id, data, created_at from table_records where table_id=$1 order by created_at desc limit 200`, [tableId]);
    }
    case "create_table_record": {
      const tableId = z.string().uuid().parse(args.tableId);
      const table = await queryOne(`select id from data_tables where id=$1 and org_id=$2`, [tableId, org]);
      if (!table) throw new Error("not_found");
      return queryOne(`insert into table_records (table_id, data) values ($1,$2) returning id, data, created_at`, [
        tableId,
        JSON.stringify(args.data ?? {})
      ]);
    }
    case "list_forms":
      return query(`select id, name, slug, fields, created_at from forms where org_id=$1 order by created_at desc`, [org]);
    case "get_usage":
      return query(
        `select metric, sum(quantity) as quantity from usage_records where organization_id=$1 and period_start=current_date group by metric`,
        [org]
      );
    case "list_apps":
      return query(`select slug, name, description, category, auth_type, status from apps order by name`);
    case "invoke_action": {
      const appSlug = z.string().parse(args.appSlug);
      const operation = z.string().parse(args.operation);
      const connectionId = args.connectionId ? z.string().uuid().parse(args.connectionId) : undefined;
      const { invokeTool, toolIdempotencyKey } = await import("../tool-registry");
      const result = await invokeTool({
        piece: appSlug,
        operation,
        connectionId,
        props: (args.input as Record<string, unknown>) ?? {},
        workspaceId: org,
        organizationId: org,
        executionId: `mcp:${session.tokenId}`,
        idempotencyKey: toolIdempotencyKey({
          executionId: `mcp:${session.tokenId}`,
          stepId: "invoke",
          attempt: 1,
          piece: appSlug,
          operation
        }),
        allowDestructive: false,
        source: "mcp"
      });
      return result.output;
    }
    default:
      throw new Error(`unknown_tool:${name}`);
  }
}

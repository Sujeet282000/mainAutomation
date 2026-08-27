import { z } from "zod";
import { createExecution } from "../engine";
import { query, queryOne } from "../db";
export { MCP_TOOL_DEFS, toolAllowed, type McpSession } from "./defs";
import type { McpSession } from "./defs";

export async function invokeMcpTool(session: McpSession, name: string, args: Record<string, unknown>) {
  const ws = session.workspaceId;
  const org = session.organizationId;
  switch (name) {
    case "list_automations":
      return query(
        `select id, name, status, tags, webhook_public_id, updated_at from automations
         where workspace_id=$1 and deleted_at is null order by updated_at desc`,
        [ws]
      );
    case "get_automation": {
      const automationId = z.string().uuid().parse(args.automationId);
      const automation = await queryOne(`select * from automations where id=$1 and workspace_id=$2`, [automationId, ws]);
      if (!automation) throw new Error("not_found");
      const version = await queryOne(
        `select id, version_number, graph, published_at, created_at from automation_versions
         where automation_id=$1 order by version_number desc limit 1`,
        [automationId]
      );
      return { automation, version };
    }
    case "run_automation": {
      const automationId = z.string().uuid().parse(args.automationId);
      const auto = await queryOne<{ id: string; status: string }>(
        `select id, status from automations where id=$1 and workspace_id=$2`,
        [automationId, ws]
      );
      if (!auto) throw new Error("not_found");
      if (auto.status !== "on") throw new Error("automation_not_published");
      return createExecution({
        automationId,
        triggerType: "mcp",
        triggerData: (args.payload as Record<string, unknown>) ?? { source: "mcp" }
      });
    }
    case "list_executions": {
      const limit = Math.min(Number(args.limit ?? 50), 100);
      return query(
        `select e.id, e.status, e.trigger_type, e.created_at, a.name as automation_name
         from executions e join automations a on a.id=e.automation_id
         where e.workspace_id=$1 order by e.created_at desc limit $2`,
        [ws, limit]
      );
    }
    case "get_execution": {
      const executionId = z.string().uuid().parse(args.executionId);
      const execution = await queryOne(`select * from executions where id=$1 and workspace_id=$2`, [executionId, ws]);
      if (!execution) throw new Error("not_found");
      const steps = await query(`select * from execution_steps where execution_id=$1 order by started_at asc`, [executionId]);
      const logs = await query(`select * from execution_logs where execution_id=$1 order by created_at asc`, [executionId]);
      return { execution, steps, logs };
    }
    case "list_connections":
      return query(
        `select id, piece_name as app_slug, label as name, auth_type, status, created_at from connections
         where org_id=$1 order by created_at desc`,
        [ws]
      );
    case "list_tables":
      return query(`select id, name, schema_json, created_at from data_tables where workspace_id=$1 order by created_at desc`, [ws]);
    case "list_table_records": {
      const tableId = z.string().uuid().parse(args.tableId);
      const table = await queryOne(`select id from data_tables where id=$1 and workspace_id=$2`, [tableId, ws]);
      if (!table) throw new Error("not_found");
      return query(`select id, data, created_at from table_records where table_id=$1 order by created_at desc limit 200`, [tableId]);
    }
    case "create_table_record": {
      const tableId = z.string().uuid().parse(args.tableId);
      const table = await queryOne(`select id from data_tables where id=$1 and workspace_id=$2`, [tableId, ws]);
      if (!table) throw new Error("not_found");
      return queryOne(`insert into table_records (table_id, data) values ($1,$2) returning id, data, created_at`, [
        tableId,
        JSON.stringify(args.data ?? {})
      ]);
    }
    case "list_forms":
      return query(`select id, name, slug, fields, created_at from forms where workspace_id=$1 order by created_at desc`, [ws]);
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
        workspaceId: ws,
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

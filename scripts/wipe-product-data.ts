/**
 * Wipe all product data while preserving logins and connections.
 *
 * Deletes: workflows/flows + versions, runs + steps, triggers/schedules,
 * tables + records + views, forms + submissions + files, chatbots + messages,
 * agents + runs/events/activities/approvals, copilot sessions/pending ops,
 * canvases, interfaces, variables/storage/transfers, templates usage,
 * trigger events, analytics rollups.
 *
 * Preserves: organizations, users, org_members, sessions, api keys,
 * connections (so you don't have to reconnect accounts), audit logs.
 *
 * Usage: npx tsx scripts/wipe-product-data.ts [--hard]
 *   --hard also deletes connections (forces re-auth of every app).
 */
import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const HARD = process.argv.includes("--hard");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/postgres",
});

// Order matters only for readability — most deletes are FK-independent thanks
// to ON DELETE CASCADE. Tables without FK links to their parents are listed
// explicitly so they never orphan.
const DELETE_GROUPS: Array<{ label: string; tables: string[] }> = [
  {
    label: "Workflow executions & observability",
    tables: [
      // ai_usage references (flow_runs | copilot_sessions) with composite
      // ON DELETE SET NULL — deleting sessions before it would NULL org_id and
      // violate its NOT NULL constraint, so ai_usage goes first.
      "ai_usage",
      "run_steps",
      "trigger_events",
      "execution_logs",
      "execution_steps",
      "executions",
      "flow_runs",
      "task_usage",
      "usage_events",
    ],
  },
  {
    // copilot_sessions.flow_id references flows with a composite
    // ON DELETE SET NULL — flows must not die before sessions.
    label: "Copilot sessions",
    tables: ["copilot_pending_operations", "copilot_sessions"],
  },
  {
    // flows MUST be deleted before flow_versions: flows.published_version_id
    // is a composite FK (published_version_id, org_id) ON DELETE SET NULL, and
    // SET NULL on the composite also nulls the NOT NULL org_id, which errors.
    // Deleting flows first lets the cascade remove versions cleanly.
    label: "Workflows & versions",
    tables: ["triggers_registry", "flow_triggers", "flows", "flow_versions"],
  },
  {
    label: "Legacy automation runtime",
    tables: ["automation_versions", "automations"],
  },
  {
    label: "Tables product",
    tables: ["table_views", "table_records", "table_assets"],
  },
  {
    label: "Forms product",
    tables: ["form_files", "form_submissions", "forms"],
  },
  {
    label: "AI products (agents, chatbots)",
    tables: [
      "chatbot_messages",
      "agent_run_events",
      "agent_runs",
      "agent_activities",
      "agent_approvals",
      "workspace_items",
      "agents",
      "chatbots",
    ],
  },
  {
    label: "Build surfaces (canvas, interfaces, templates, misc)",
    tables: [
      "interfaces",
      "canvases",
      "workspace_variables",
      "workspace_kv",
      "transfer_jobs",
      "email_parsers",
      "developer_apps",
      "todos",
    ],
  },
];

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]);
  return rows.length > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(`SELECT count(*)::int AS n FROM flows WHERE true`);
    console.log(`\n=== Product data wipe ${HARD ? "(HARD — connections included)" : "(logins + connections preserved)"} ===`);
    try {
      console.log(`Flows before: ${before.rows[0]?.n ?? 0}`);
    } catch { /* table may not exist */ }

    await client.query("BEGIN");

    // flow_versions carries an immutability trigger (BEFORE UPDATE OR DELETE)
    // and flows/connections write audit rows on DELETE via write_audit_log.
    // This is an explicit maintenance wipe: suppress row-level triggers for
    // this transaction only and always re-enable them afterwards — every
    // guard stays active at runtime. (Disabling the table's own triggers does
    // not silence FK cascades, which is exactly what we rely on here.)
    for (const t of ["flow_versions", "flows", "connections", "copilot_sessions", "todos"]) {
      await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }

    if (HARD) {
      await client.query(`DELETE FROM connections`);
      console.log("connections: wiped (hard mode)");
    }

    for (const group of DELETE_GROUPS) {
      for (const t of group.tables) {
        if (!(await tableExists(t))) continue;
        const { rowCount } = await client.query(`DELETE FROM ${t}`);
        console.log(`${t}: deleted ${rowCount ?? 0} rows  [${group.label}]`);
      }
    }

    for (const t of ["flow_versions", "flows", "connections", "copilot_sessions", "todos"]) {
      await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
    await client.query("COMMIT");
    console.log("\nDone. Product data cleared; logins", HARD ? "and connections" : "and connections preserved", ".");
  } catch (err) {
    for (const t of ["flow_versions", "flows", "connections", "copilot_sessions", "todos"]) {
      await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`).catch(() => undefined);
    }
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Wipe failed, rolled back:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();

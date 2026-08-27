// =============================================================================
// Orchestra Part 6 — Trigger Activation Service
// Source of truth: Part 6 § "Trigger activation"
//
// Publishing, enabling, and disabling use a single activation service.
// It treats a published flow version as input and registers provider state
// only after the flow is eligible to run.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "../db";

type PieceRegistry = {
  getTrigger(pieceName: string, operation: string): {
    onEnable?: (ctx: any) => Promise<void>;
    onDisable?: (ctx: any) => Promise<void>;
  };
};

export class TriggerActivationService {
  constructor(
    private readonly pieces: PieceRegistry,
    private readonly publicBaseUrl: string,
  ) {}

  async onPublished(flowVersionId: string): Promise<void> {
    const version = await queryOne<{ flow_id: string }>(
      `SELECT flow_id FROM flow_versions WHERE id = $1`,
      [flowVersionId],
    );
    if (!version) return;

    const flow = await queryOne<{ id: string; org_id: string; status: string }>(
      `SELECT id, org_id, status FROM flows WHERE id = $1`,
      [version.flow_id],
    );
    if (!flow || flow.status !== "active") return;

    // Deactivate old triggers for prior versions
    await this.deactivateOldVersions(flow.id, flowVersionId);

    // Activate new version
    await this.activate(flow.org_id, flow.id, flowVersionId);
  }

  async onEnabled(flowId: string): Promise<void> {
    const flow = await queryOne<{ id: string; org_id: string; published_version_id: string | null }>(
      `SELECT id, org_id, published_version_id FROM flows WHERE id = $1`,
      [flowId],
    );
    if (!flow?.published_version_id) return;

    await this.activate(flow.org_id, flow.id, flow.published_version_id);
  }

  async onDisabled(flowId: string): Promise<void> {
    const rows = await query<{ id: string; piece_name: string; operation_id: string; connection_id: string | null }>(
      `SELECT id, piece_name, operation_id, connection_id
       FROM triggers_registry
       WHERE flow_id = $1 AND status = 'active'`,
      [flowId],
    );

    for (const row of rows) {
      try {
        const trigger = this.pieces.getTrigger(row.piece_name, row.operation_id);
        if (trigger.onDisable && row.connection_id) {
          // Load connection auth for lifecycle hook
          const conn = await queryOne<{ encrypted_payload: any }>(
            `SELECT encrypted_payload FROM connections WHERE id = $1`,
            [row.connection_id],
          );
          if (conn?.encrypted_payload) {
            await trigger.onDisable({
              auth: conn.encrypted_payload,
              externalId: undefined,
            });
          }
        }
      } catch {
        // Best effort — lifecycle hook failure should not block disable
      }

      await query(
        `UPDATE triggers_registry SET status = 'disabled', updated_at = now() WHERE id = $1`,
        [row.id],
      );
    }
  }

  private async activate(
    orgId: string,
    flowId: string,
    flowVersionId: string,
  ): Promise<void> {
    const version = await queryOne<{ definition: any }>(
      `SELECT definition FROM flow_versions WHERE id = $1`,
      [flowVersionId],
    );
    if (!version) return;

    const trigger = version.definition?.trigger;
    if (!trigger || trigger.type === "manual" || trigger.type === "form") return;

    const webhookToken =
      trigger.type === "webhook"
        ? randomBytes(32).toString("base64url")
        : null;

    // Upsert trigger registration
    await query(
      `INSERT INTO triggers_registry (org_id, flow_id, flow_version_id, kind, operation_id, connection_id, piece_name, webhook_token, cron_expr, timezone, enabled, status, next_poll_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, 'active', $11)
       ON CONFLICT (flow_id) WHERE status = 'active'
       DO UPDATE SET flow_version_id = EXCLUDED.flow_version_id,
                     operation_id = EXCLUDED.operation_id,
                     connection_id = EXCLUDED.connection_id,
                     piece_name = EXCLUDED.piece_name,
                     webhook_token = EXCLUDED.webhook_token,
                     cron_expr = EXCLUDED.cron_expr,
                     timezone = EXCLUDED.timezone,
                     next_poll_at = EXCLUDED.next_poll_at,
                     enabled = true, status = 'active',
                     updated_at = now()`,
      [
        orgId,
        flowId,
        flowVersionId,
        trigger.type,
        trigger.operation ?? null,
        trigger.connectionId ?? null,
        trigger.piece?.name ?? null,
        webhookToken,
        trigger.props?.expression ?? null,
        "UTC",
        trigger.type === "schedule" ? new Date() : null,
      ],
    );

    // For webhook triggers, attempt to register with the provider
    if (trigger.type === "webhook" && trigger.piece?.name) {
      try {
        const pieceTrigger = this.pieces.getTrigger(trigger.piece.name, trigger.operation);
        if (pieceTrigger.onEnable) {
          const conn = trigger.connectionId
            ? await queryOne<{ encrypted_payload: any }>(
                `SELECT encrypted_payload FROM connections WHERE id = $1 AND org_id = $2`,
                [trigger.connectionId, orgId],
              )
            : null;

          const webhookUrl = `${this.publicBaseUrl}/v1/webhooks/inbound/${webhookToken}`;

          await pieceTrigger.onEnable({
            auth: conn?.encrypted_payload ?? {},
            propsValue: trigger.props ?? {},
            webhookUrl,
            http: null, // Will be injected by the piece
            store: {
              get: async (key: string) => {
                const row = await queryOne<{ value_json: any }>(
                  `SELECT value_json FROM trigger_state WHERE trigger_registry_id = (SELECT id FROM triggers_registry WHERE webhook_token = $1) AND key = $2`,
                  [webhookToken, key],
                );
                return row?.value_json;
              },
              put: async (key: string, value: unknown) => {
                await query(
                  `INSERT INTO trigger_state (org_id, trigger_registry_id, key, value_json)
                   VALUES ($1, (SELECT id FROM triggers_registry WHERE webhook_token = $2), $3, $4)
                   ON CONFLICT (trigger_registry_id, key)
                   DO UPDATE SET value_json = EXCLUDED.value_json`,
                  [orgId, webhookToken, key, JSON.stringify(value)],
                );
              },
              delete: async () => {},
            },
          });
        }
      } catch {
        // Lifecycle hook failure should not block activation
        // A reconciliation task will retry
      }
    }
  }

  private async deactivateOldVersions(
    flowId: string,
    currentVersionId: string,
  ): Promise<void> {
    await query(
      `UPDATE triggers_registry
       SET status = 'disabled', updated_at = now()
       WHERE flow_id = $1 AND flow_version_id != $2 AND status = 'active'`,
      [flowId, currentVersionId],
    );
  }
}

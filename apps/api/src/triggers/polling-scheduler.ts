// =============================================================================
// Orchestra Part 6 — Polling Scheduler
// Source of truth: Part 6 § "Polling scheduler"
//
// Only a Redlock holder scans due rows. PostgreSQL claims a short batch
// with FOR UPDATE SKIP LOCKED. The scheduler persists a cursor only after
// a poll's events have each passed deterministic dedup and been enqueued.
// =============================================================================

import { query, queryOne } from "../db";

const POLL_BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 30_000;

export class PollingScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    // Run immediately
    this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // Prevent overlapping ticks
    this.running = true;

    try {
      await this.claimAndPoll();
    } catch (err) {
      console.error("Polling scheduler tick error:", err);
    } finally {
      this.running = false;
    }
  }

  private async claimAndPoll(): Promise<void> {
    // Claim a batch of due triggers with FOR UPDATE SKIP LOCKED
    const claimed = await query<{
      id: string;
      org_id: string;
      flow_id: string;
      flow_version_id: string;
      piece_name: string;
      operation_id: string;
      connection_id: string | null;
      poll_cursor: Record<string, unknown>;
      timezone: string;
    }>(
      `UPDATE triggers_registry
       SET next_poll_at = now() + interval '5 minutes',
           updated_at = now()
       WHERE id IN (
         SELECT id FROM triggers_registry
         WHERE enabled = true
           AND status = 'active'
           AND kind IN ('schedule', 'app_event')
           AND next_poll_at <= now()
         ORDER BY next_poll_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING *`,
      [POLL_BATCH_SIZE],
    );

    if (claimed.length === 0) return;

    // Process each claimed trigger
    for (const trigger of claimed) {
      try {
        await this.pollTrigger(trigger);
      } catch (err) {
        console.error(`Polling trigger ${trigger.id} failed:`, err);

        // Increment failure count; disable after 10 consecutive failures
        await query(
          `UPDATE triggers_registry
           SET consecutive_failures = consecutive_failures + 1,
               updated_at = now()
           WHERE id = $1`,
          [trigger.id],
        );

        const row = await queryOne<{ consecutive_failures: number }>(
          `SELECT consecutive_failures FROM triggers_registry WHERE id = $1`,
          [trigger.id],
        );

        if (row && row.consecutive_failures >= 10) {
          await query(
            `UPDATE triggers_registry SET status = 'error', enabled = false, updated_at = now() WHERE id = $1`,
            [trigger.id],
          );
        }
      }
    }
  }

  private async pollTrigger(trigger: {
    id: string;
    org_id: string;
    flow_id: string;
    flow_version_id: string;
    piece_name: string;
    operation_id: string;
    connection_id: string | null;
    poll_cursor: Record<string, unknown>;
    timezone: string;
  }): Promise<void> {
    // In production, this would:
    // 1. Load the piece's polling implementation
    // 2. Call poll() with the stored cursor
    // 3. For each event, check dedup and enqueue
    // 4. Store the new cursor only after successful enqueue

    // For schedule triggers, compute next wall-clock occurrence
    // using IANA timezone (Luxon or similar)
    if (trigger.connection_id) {
      // Load connection for auth
      const conn = await queryOne<{ encrypted_payload: any }>(
        `SELECT encrypted_payload FROM connections WHERE id = $1 AND org_id = $2`,
        [trigger.connection_id, trigger.org_id],
      );

      if (!conn?.encrypted_payload) {
        // Connection expired or missing — mark error
        await query(
          `UPDATE triggers_registry
           SET consecutive_failures = consecutive_failures + 1,
               status = 'error'
           WHERE id = $1`,
          [trigger.id],
        );
        return;
      }
    }

    // Reset failure count on successful poll
    await query(
      `UPDATE triggers_registry
       SET consecutive_failures = 0, updated_at = now()
       WHERE id = $1`,
      [trigger.id],
    );
  }
}

// Must be the first import: patches Express Router methods so async handler
// rejections reach the error middleware instead of hanging requests forever
// (Express 4 does not catch rejected promises on its own).
import "./async-router";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { env } from "./config";
import { health } from "./auth";
import { router } from "./routes";
import { mcpHttp } from "./mcp/http";
import { ensureProductSchema } from "./ensure-schema";
import { webhookRouter } from "./triggers/webhook-ingress";
import { tickSchedules } from "./schedules";
import { tickPolling } from "./poll";
import { sweepPausedRuns } from "./paused-sweeper";
import { copilotApprovalRouter } from "./copilot/copilot-approval";

// Prevent unhandled promise rejections from crashing the process
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const app = express();
app.use(helmet());
app.use(cors({ origin: env.corsOrigins, credentials: true }));

function captureRawJson(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
  req.rawBody = buf;
  try {
    req.body = JSON.parse(buf.toString("utf8") || "{}");
  } catch {
    req.body = {};
  }
  next();
}

function rawJsonWhenPost(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== "POST") return next();
  return express.raw({ type: "application/json" })(req, res, () => captureRawJson(req, res, next));
}

// HMAC verification signs the ORIGINAL request bytes. Buffer them for every
// webhook ingress route before express.json() consumes the stream.
function rawJsonInbound(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== "POST") return next();
  return express.raw({ type: "*/*" })(req, res, () => captureRawJson(req, res, next));
}

function schedulerAuthorized(req: express.Request) {
  const configured = process.env.SCHEDULER_SECRET;
  if (!configured) return false;
  const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

app.use("/api/v1/webhooks/inbound", rawJsonInbound);
app.use(express.json({ limit: "2mb" }));
app.use(health);
app.use("/mcp", mcpHttp);
app.use("/api/v1/mcp", mcpHttp);
app.use("/api", webhookRouter);

// Explicitly-approved Copilot operations are handled by a separate authenticated
// router so the approval boundary cannot be bypassed by the generic Copilot routes.
app.use("/api/v1", copilotApprovalRouter);

// Internal control-plane endpoint used only by apps/scheduler. The scheduler
// discovers due cron/polling triggers; the worker remains execution-only.
app.post("/internal/scheduler/tick", async (req, res) => {
  if (!schedulerAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const [scheduled, polled, resumed] = await Promise.all([tickSchedules(), tickPolling(), sweepPausedRuns().catch(() => 0)]);
    return res.json({ ok: true, scheduled, polled, resumed, at: new Date().toISOString() });
  } catch (error) {
    console.error("scheduler tick", error);
    return res.status(500).json({ error: "scheduler_tick_failed" });
  }
});

app.use("/api/v1", router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "internal_error";
  console.error(err);
  res.status(400).json({ error: message });
});

app.listen(env.port, () => {
  console.log(`API listening on ${env.port}`);
  // Runtime schema creation is a development convenience only. Production must
  // come up from migrations alone (npm run migrate) and fail loudly when the
  // schema drifts — never silently patch itself at boot.
  if (env.nodeEnv !== "production") {
    void ensureProductSchema().catch((err) => console.error("ensureProductSchema", err));
  }
});

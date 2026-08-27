import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config";
import { health } from "./auth";
import { router } from "./routes";
import { mcpHttp } from "./mcp/http";
import { ensureProductSchema } from "./ensure-schema";
import { webhookRouter } from "./triggers/webhook-ingress";

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

app.use("/api/v1/webhooks/stripe", rawJsonWhenPost);
app.use("/api/v1/webhooks/whatsapp", rawJsonWhenPost);
app.use(express.json({ limit: "2mb" }));
app.use(health);
app.use("/mcp", mcpHttp);
app.use("/api/v1/mcp", mcpHttp);
app.use("/api", webhookRouter);
app.use("/api/v1", router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "internal_error";
  console.error(err);
  res.status(400).json({ error: message });
});

app.listen(env.port, () => {
  console.log(`API listening on ${env.port}`);
  void ensureProductSchema().catch((err) => console.error("ensureProductSchema", err));
});

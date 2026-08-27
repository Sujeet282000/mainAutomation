// ============================================================================
// Orchestra Part 10 — Authentication Middleware
// Source of truth: Part 10 § "Conventions"
// ============================================================================

import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "./config";
import { query, queryOne } from "./db";

// ── JWT payload ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  orgId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      orgId?: string;
      organizationId?: string;
      orgRole?: string;
      workspaceId?: string;
      rawBody?: Buffer;
    }
  }
}

// ── Token signing ───────────────────────────────────────────────────────────

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}

// ── Health check (unauthenticated) ──────────────────────────────────────────

export function health(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/api/v1/health" || req.path === "/api/v1/meta") {
    return next();
  }
  next();
}

// ── Auth middleware ──────────────────────────────────────────────────────────

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "missing_token" });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.user = decoded;

    const headerOrg = String(req.headers["x-workspace-id"] ?? req.headers["x-org-id"] ?? "").trim();
    if (headerOrg) {
      const member = await queryOne<{ role: string }>(
        `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2`,
        [decoded.userId, headerOrg],
      );
      if (member) {
        req.orgId = headerOrg;
        req.orgRole = member.role;
        req.workspaceId = headerOrg;
        req.organizationId = headerOrg;
        return next();
      }
    }

    // Load org membership if orgId is in the token
    if (decoded.orgId) {
      req.orgId = decoded.orgId;
      const member = await queryOne<{ role: string }>(
        `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2`,
        [decoded.userId, decoded.orgId],
      );
      if (member) {
        req.orgRole = member.role;
      }
      req.workspaceId = decoded.orgId;
      req.organizationId = decoded.orgId;
    }

    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// ── Org middleware (requires org context) ────────────────────────────────────

export async function orgMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.orgId) {
    // Try to load the user's first organization
    const member = await queryOne<{ org_id: string; role: string }>(
      `SELECT org_id, role FROM org_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [req.user!.userId],
    );
    if (!member) {
      return res.status(400).json({ error: "no_organization" });
    }
    req.orgId = member.org_id;
    req.orgRole = member.role;
  }
  req.workspaceId = req.orgId;
  req.organizationId = req.orgId;
  next();
}

export async function workspaceMiddleware(req: Request, res: Response, next: NextFunction) {
  return orgMiddleware(req, res, () => {
    req.workspaceId = req.orgId;
    next();
  });
}

// ── RBAC middleware ──────────────────────────────────────────────────────────

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.orgRole || !roles.includes(req.orgRole)) {
      return res.status(403).json({ error: "insufficient_role", required: roles });
    }
    next();
  };
}

// ── Service token verification (for Python AI callbacks) ─────────────────────

import crypto from "crypto";

export function hashServiceBody(body: string | Buffer) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function createServiceToken(opts: {
  method: string;
  path: string;
  bodySha256: string;
  orgId: string;
  requestId: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `v1:${timestamp}:${opts.method.toUpperCase()}:${opts.path}:${opts.orgId}:${opts.requestId}:${opts.bodySha256}`;
  const signature = crypto.createHmac("sha256", env.serviceToken).update(payload).digest("hex");
  return `v1.${timestamp}.${signature}`;
}

export function verifyServiceToken(
  token: string,
  method: string,
  path: string,
  bodyHash: string,
  orgId: string,
  requestId: string,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const timestamp = parseInt(parts[1], 10);
  if (!Number.isFinite(timestamp)) return false;
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > env.serviceTokenMaxAgeSeconds) return false;

  const payload = `v1:${timestamp}:${method.toUpperCase()}:${path}:${orgId}:${requestId}:${bodyHash}`;
  const expected = crypto
    .createHmac("sha256", env.serviceToken)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function serviceAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-orchestra-service-token") ?? "";
  const raw = JSON.stringify(req.body ?? {});
  const bodyHash = hashServiceBody(raw);
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const orgId = String((req.body as { org_id?: string })?.org_id ?? (req.body as { orgId?: string })?.orgId ?? "");
  const requestId = String(
    (req.body as { request_id?: string })?.request_id ?? (req.body as { requestId?: string })?.requestId ?? "",
  );
  if (!verifyServiceToken(token, req.method, path, bodyHash, orgId, requestId)) {
    return res.status(401).json({ error: "invalid_service_token" });
  }
  req.orgId = orgId || req.orgId;
  next();
}

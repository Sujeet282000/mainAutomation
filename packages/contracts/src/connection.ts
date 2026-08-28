// =============================================================================
// Connection Contracts — What the UI consumes for connection states
// =============================================================================

import { z } from "zod";

export const ConnectionState = z.enum([
  "connected",
  "needs_attention",
  "not_configured",
  "expired",
  "broken",
  "not_enabled",
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const ConnectionInfo = z.object({
  id: z.string().uuid(),
  appSlug: z.string(),
  appName: z.string(),
  state: ConnectionState,
  email: z.string().optional(),
  label: z.string().optional(),
  lastUsedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  message: z.string().optional(),
  canTest: z.boolean().default(false),
});
export type ConnectionInfo = z.infer<typeof ConnectionInfo>;

// =============================================================================
// Notifications — In-app, realtime, email, Slack, webhook
// =============================================================================

import { z } from "zod";

export const NotificationChannel = z.enum([
  "in_app",
  "email",
  "slack",
  "webhook",
  "push",
]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationCategory = z.enum([
  "mention",
  "approval",
  "workflow_failure",
  "workflow_success",
  "agent_activity",
  "connection_error",
  "system",
  "custom",
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const Notification = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  // Content
  title: z.string().min(1).max(500),
  message: z.string().max(2000).optional(),
  category: NotificationCategory,
  // Link
  linkType: z.string().optional(),
  linkId: z.string().uuid().optional(),
  // Source
  sourceType: z.string().optional(),
  sourceId: z.string().uuid().optional(),
  // Delivery
  channels: z.array(NotificationChannel).default(["in_app"]),
  delivered: z.boolean().default(false),
  read: z.boolean().default(false),
  readAt: z.string().datetime().optional(),
  // Action
  actionUrl: z.string().url().optional(),
  actionLabel: z.string().optional(),
  // Metadata
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationPreference = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  category: NotificationCategory,
  channels: z.array(NotificationChannel).default(["in_app"]),
  enabled: z.boolean().default(true),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

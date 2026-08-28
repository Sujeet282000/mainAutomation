// =============================================================================
// Chatbots — User-facing conversational interfaces
// =============================================================================

import { z } from "zod";

export const Chatbot = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  // Core config
  instructions: z.string().max(10000).default("You are a helpful assistant."),
  knowledge: z.string().max(10000).default(""),
  model: z.string().default("openai:gpt-4o-mini"),
  // Knowledge sources
  knowledgeSourceIds: z.array(z.string().uuid()).default([]),
  // Appearance
  appearance: z.object({
    primaryColor: z.string().default("#6366f1"),
    logo: z.string().optional(),
    welcomeMessage: z.string().default("Hi! How can I help you?"),
    inputPlaceholder: z.string().default("Type a message..."),
    avatarName: z.string().default("Assistant"),
  }).default({}),
  // Actions
  actions: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(["run_workflow", "create_record", "send_email", "book_meeting", "search_knowledge", "collect_info", "escalate"]),
    config: z.record(z.unknown()).default({}),
    triggerPhrase: z.string().optional(),
  })).default([]),
  // Lead capture
  leadCapture: z.object({
    enabled: z.boolean().default(false),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(["text", "email", "phone", "number"]),
      required: z.boolean().default(true),
    })).default([]),
    tableId: z.string().uuid().optional(),
    workflowId: z.string().uuid().optional(),
  }).default({}),
  // Escalation
  escalation: z.object({
    enabled: z.boolean().default(false),
    triggerPhrases: z.array(z.string()).default(["speak to human", "talk to agent", "escalate"]),
    workflowId: z.string().uuid().optional(),
    notificationChannel: z.string().optional(),
  }).default({}),
  // Embed
  isPublic: z.boolean().default(false),
  publicUrl: z.string().url().optional(),
  embedCode: z.string().optional(),
  // Stats
  totalConversations: z.number().int().default(0),
  lastActiveAt: z.string().datetime().optional(),
  // Metadata
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Chatbot = z.infer<typeof Chatbot>;

// ─── Chatbot Session ─────────────────────────────────────────────────────────

export const ChatbotSession = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  orgId: z.string().uuid(),
  visitorId: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
    timestamp: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
  })).default([]),
  // Lead info
  leadData: z.record(z.unknown()).optional(),
  leadCaptured: z.boolean().default(false),
  // Status
  status: z.enum(["active", "escalated", "closed"]).default("active"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});
export type ChatbotSession = z.infer<typeof ChatbotSession>;

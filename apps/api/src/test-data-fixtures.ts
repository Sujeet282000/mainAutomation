// =============================================================================
// Test Data Fixtures — Reusable sample data for every app
// Used by: unit tests, copilot tests, mapping tests, UI previews, integration tests
// =============================================================================

export type TestFixture = {
  appSlug: string;
  operation: string;
  sampleInput: Record<string, unknown>;
  sampleOutput: Record<string, unknown>;
  description: string;
};

export const TEST_FIXTURES: TestFixture[] = [
  // ── Gmail ──────────────────────────────────────────────────────────────
  {
    appSlug: "gmail",
    operation: "new_email",
    sampleInput: {},
    sampleOutput: {
      id: "msg_1234567890",
      from: { email: "customer@example.com", name: "Jane Customer" },
      to: [{ email: "you@gmail.com" }],
      subject: "Need help with my order",
      body: "Hi, I placed order #1234 last week and haven't received it yet. Can you help?",
      snippet: "Hi, I placed order #1234 last week...",
      date: "2026-01-15T10:30:00Z",
      labels: ["INBOX", "UNREAD"],
      hasAttachments: false,
    },
    description: "Sample incoming Gmail email",
  },
  {
    appSlug: "gmail",
    operation: "send_email",
    sampleInput: {
      to: "recipient@example.com",
      subject: "Test email",
      body: "This is a test email body.",
    },
    sampleOutput: {
      id: "msg_sent_123",
      threadId: "thread_456",
      labelIds: ["SENT"],
    },
    description: "Sample sent Gmail email",
  },

  // ── Google Sheets ──────────────────────────────────────────────────────
  {
    appSlug: "google-sheets",
    operation: "append_row",
    sampleInput: {
      spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      sheet: "Sheet1",
      values: ["customer@example.com", "Jane Customer", "2026-01-15"],
    },
    sampleOutput: {
      spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      updatedRange: "Sheet1!A4:C4",
      updatedRows: 1,
      updatedCells: 3,
    },
    description: "Sample append row to Google Sheets",
  },
  {
    appSlug: "google-sheets",
    operation: "new_row",
    sampleInput: {
      spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      sheet: "Sheet1",
    },
    sampleOutput: {
      rowNumber: 4,
      values: ["customer@example.com", "Jane Customer", "2026-01-15", "New lead"],
    },
    description: "Sample new row trigger in Google Sheets",
  },

  // ── Slack ──────────────────────────────────────────────────────────────
  {
    appSlug: "slack",
    operation: "send_message",
    sampleInput: {
      channel: "#general",
      text: "New lead: Jane Customer (customer@example.com)",
    },
    sampleOutput: {
      ok: true,
      ts: "1234567890.123456",
      channel: "C0123ABCDEF",
      message: {
        text: "New lead: Jane Customer (customer@example.com)",
        user: "U0123ABCDEF",
      },
    },
    description: "Sample Slack message sent",
  },

  // ── Webhook ────────────────────────────────────────────────────────────
  {
    appSlug: "webhook",
    operation: "catch_hook",
    sampleInput: {},
    sampleOutput: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { event: "new_lead", data: { name: "Jane", email: "jane@example.com" } },
      query: {},
      timestamp: "2026-01-15T10:30:00Z",
    },
    description: "Sample webhook catch",
  },

  // ── HubSpot ────────────────────────────────────────────────────────────
  {
    appSlug: "hubspot",
    operation: "new_contact",
    sampleInput: {},
    sampleOutput: {
      id: "12345678",
      properties: {
        email: "jane@example.com",
        firstname: "Jane",
        lastname: "Customer",
        company: "Acme Corp",
        phone: "+1-555-0123",
        lifecyclestage: "lead",
      },
      createdAt: "2026-01-15T10:30:00Z",
      updatedAt: "2026-01-15T10:30:00Z",
    },
    description: "Sample HubSpot new contact",
  },

  // ── GitHub ─────────────────────────────────────────────────────────────
  {
    appSlug: "github",
    operation: "new_issue",
    sampleInput: {},
    sampleOutput: {
      id: 12345,
      number: 42,
      title: "Bug: Login page crashes on mobile",
      body: "The login page throws a JavaScript error on iOS Safari...",
      state: "open",
      user: { login: "dev123", avatar_url: "https://avatars.githubusercontent.com/u/123" },
      labels: [{ name: "bug", color: "d73a4a" }],
      created_at: "2026-01-15T10:30:00Z",
      html_url: "https://github.com/org/repo/issues/42",
    },
    description: "Sample GitHub new issue",
  },

  // ── Schedule ───────────────────────────────────────────────────────────
  {
    appSlug: "schedule",
    operation: "cron",
    sampleInput: { cron: "0 9 * * *", timezone: "UTC" },
    sampleOutput: {
      scheduledFor: "2026-01-16T09:00:00Z",
      triggeredAt: "2026-01-16T09:00:00.123Z",
    },
    description: "Sample cron trigger fire",
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    appSlug: "openai",
    operation: "summarize",
    sampleInput: { text: "Long email content that needs summarization..." },
    sampleOutput: {
      summary: "Customer inquiry about delayed order #1234. Requesting shipping update.",
      sentiment: "neutral",
      keyTopics: ["order", "shipping", "delay"],
    },
    description: "Sample OpenAI summarize output",
  },

  // ── WhatsApp ───────────────────────────────────────────────────────────
  {
    appSlug: "whatsapp",
    operation: "new_message",
    sampleInput: {},
    sampleOutput: {
      id: "wamid.HBgLMzY1OTk4NzY1",
      from: "+1-555-0123",
      to: "+1-555-0456",
      body: "Hi, I need help with my order",
      timestamp: "2026-01-15T10:30:00Z",
      type: "text",
    },
    description: "Sample WhatsApp incoming message",
  },

  // ── Typeform ───────────────────────────────────────────────────────────
  {
    appSlug: "typeform",
    operation: "form_submission",
    sampleInput: {},
    sampleOutput: {
      form_id: "abc123",
      submission_id: "sub_456",
      answered_at: "2026-01-15T10:30:00Z",
      answers: [
        { field: { ref: "name", type: "short_text" }, text: "Jane Customer" },
        { field: { ref: "email", type: "email" }, email: "jane@example.com" },
        { field: { ref: "message", type: "long_text" }, text: "Interested in your product" },
      ],
    },
    description: "Sample Typeform submission",
  },

  // ── Telegram ───────────────────────────────────────────────────────────
  {
    appSlug: "telegram",
    operation: "send_message",
    sampleInput: { chatId: "123456789", text: "Hello from automation!" },
    sampleOutput: {
      ok: true,
      result: { message_id: 42, chat: { id: 123456789 }, text: "Hello from automation!" },
    },
    description: "Sample Telegram message sent",
  },

  // ── Twilio ─────────────────────────────────────────────────────────────
  {
    appSlug: "twilio",
    operation: "send_sms",
    sampleInput: { to: "+1-555-0123", from: "+1-555-0456", body: "Your order is ready!" },
    sampleOutput: {
      sid: "SM1234567890abcdef",
      status: "queued",
      to: "+1-555-0123",
      from: "+1-555-0456",
      body: "Your order is ready!",
    },
    description: "Sample Twilio SMS sent",
  },
];

/**
 * Get a test fixture for a specific app + operation.
 */
export function getFixture(appSlug: string, operation: string): TestFixture | undefined {
  return TEST_FIXTURES.find((f) => f.appSlug === appSlug && f.operation === operation);
}

/**
 * Get all fixtures for a specific app.
 */
export function getAppFixtures(appSlug: string): TestFixture[] {
  return TEST_FIXTURES.filter((f) => f.appSlug === appSlug);
}

/**
 * Get all unique app slugs that have fixtures.
 */
export function getFixedAppSlugs(): string[] {
  return [...new Set(TEST_FIXTURES.map((f) => f.appSlug))];
}

// =============================================================================
// Copilot Eval Dataset — Permanent regression test cases
// Each case: NL input → expected AutomationPlan shape
// =============================================================================

export type EvalCase = {
  id: string;
  category: string;
  input: string;
  expected: {
    stepCount: number;
    triggerApp: string | null;
    triggerOperation: string | null;
    actionApps: string[];
    connectionsNeeded: string[];
    hasAIStep: boolean;
    hasCondition: boolean;
    minConfidence: number;
  };
};

export const EVAL_DATASET: EvalCase[] = [
  // ── Gmail ──────────────────────────────────────────────────────────────
  {
    id: "gmail-01",
    category: "gmail",
    input: "When I get a new email, send me a Slack notification",
    expected: {
      stepCount: 2,
      triggerApp: "gmail",
      triggerOperation: "new_email",
      actionApps: ["slack"],
      connectionsNeeded: ["gmail", "slack"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.6,
    },
  },
  {
    id: "gmail-02",
    category: "gmail",
    input: "Whenever someone emails me, save the sender and subject to my Google Sheet",
    expected: {
      stepCount: 2,
      triggerApp: "gmail",
      triggerOperation: "new_email",
      actionApps: ["google-sheets"],
      connectionsNeeded: ["gmail", "google-sheets"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.6,
    },
  },
  // ── Multi-app ──────────────────────────────────────────────────────────
  {
    id: "multi-01",
    category: "multi-app",
    input: "When a new email arrives, use AI to summarize it, save to Sheets, and notify Slack",
    expected: {
      stepCount: 4,
      triggerApp: "gmail",
      triggerOperation: "new_email",
      actionApps: ["google-sheets", "slack"],
      connectionsNeeded: ["gmail", "google-sheets", "slack"],
      hasAIStep: true,
      hasCondition: false,
      minConfidence: 0.5,
    },
  },
  {
    id: "multi-02",
    category: "multi-app",
    input: "When a GitHub issue is created, summarize it with AI and post to Slack",
    expected: {
      stepCount: 3,
      triggerApp: "github",
      triggerOperation: null,
      actionApps: ["slack"],
      connectionsNeeded: ["github", "slack"],
      hasAIStep: true,
      hasCondition: false,
      minConfidence: 0.5,
    },
  },
  // ── Schedule ───────────────────────────────────────────────────────────
  {
    id: "schedule-01",
    category: "schedule",
    input: "Every morning at 9am, send a Slack message with today's calendar events",
    expected: {
      stepCount: 2,
      triggerApp: "schedule",
      triggerOperation: "cron",
      actionApps: ["slack"],
      connectionsNeeded: ["slack"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.6,
    },
  },
  // ── Conditions ─────────────────────────────────────────────────────────
  {
    id: "cond-01",
    category: "conditions",
    input: "When a new email arrives, if the subject contains 'urgent', notify Slack immediately. Otherwise, save to Sheets.",
    expected: {
      stepCount: 3,
      triggerApp: "gmail",
      triggerOperation: "new_email",
      actionApps: ["slack", "google-sheets"],
      connectionsNeeded: ["gmail", "slack", "google-sheets"],
      hasAIStep: false,
      hasCondition: true,
      minConfidence: 0.5,
    },
  },
  // ── Webhook ────────────────────────────────────────────────────────────
  {
    id: "webhook-01",
    category: "webhook",
    input: "Catch a webhook POST and forward the data to Slack",
    expected: {
      stepCount: 2,
      triggerApp: "webhook",
      triggerOperation: "catch_hook",
      actionApps: ["slack"],
      connectionsNeeded: ["slack"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.7,
    },
  },
  // ── HubSpot ────────────────────────────────────────────────────────────
  {
    id: "hubspot-01",
    category: "hubspot",
    input: "When a new HubSpot contact is created, send a welcome email via Gmail",
    expected: {
      stepCount: 2,
      triggerApp: "hubspot",
      triggerOperation: null,
      actionApps: ["gmail"],
      connectionsNeeded: ["hubspot", "gmail"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.5,
    },
  },
  // ── Ambiguous ──────────────────────────────────────────────────────────
  {
    id: "ambig-01",
    category: "ambiguous",
    input: "Automate my email workflow",
    expected: {
      stepCount: 1,
      triggerApp: "gmail",
      triggerOperation: null,
      actionApps: [],
      connectionsNeeded: [],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.2,
    },
  },
  // ── WhatsApp ───────────────────────────────────────────────────────────
  {
    id: "whatsapp-01",
    category: "whatsapp",
    input: "When I receive a WhatsApp message, forward it to my Slack channel",
    expected: {
      stepCount: 2,
      triggerApp: "whatsapp",
      triggerOperation: null,
      actionApps: ["slack"],
      connectionsNeeded: ["whatsapp", "slack"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.5,
    },
  },
  // ── Typeform ───────────────────────────────────────────────────────────
  {
    id: "typeform-01",
    category: "typeform",
    input: "When someone submits my Typeform, add the response to Google Sheets and send a Slack notification",
    expected: {
      stepCount: 3,
      triggerApp: "typeform",
      triggerOperation: null,
      actionApps: ["google-sheets", "slack"],
      connectionsNeeded: ["typeform", "google-sheets", "slack"],
      hasAIStep: false,
      hasCondition: false,
      minConfidence: 0.5,
    },
  },
  // ── AI-heavy ───────────────────────────────────────────────────────────
  {
    id: "ai-01",
    category: "multi-app",
    input: "When a new email arrives, use AI to classify it as spam or not spam. If it's not spam, save it to Sheets and notify Slack. If it is spam, archive it.",
    expected: {
      stepCount: 4,
      triggerApp: "gmail",
      triggerOperation: "new_email",
      actionApps: ["google-sheets", "slack"],
      connectionsNeeded: ["gmail", "google-sheets", "slack"],
      hasAIStep: true,
      hasCondition: true,
      minConfidence: 0.4,
    },
  },
];

export type FieldDef = {
  key?: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[] | string[];
  dependsOn?: string[];
};

export type CatalogOp = {
  name: string;
  type: "trigger" | "action" | "search";
  description?: string;
  key?: string;
  triggerMode?: string;
  inputFields?: FieldDef[];
  outputSample?: Record<string, unknown>;
};

export type CatalogApp = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  color?: string;
  authType?: string;
  operations: CatalogOp[];
};

export function opKey(op: CatalogOp) {
  const anyOp = op as CatalogOp & { operation_id?: string; operationId?: string };
  return anyOp.key || anyOp.operation_id || anyOp.operationId || "";
}

export function opFields(op: CatalogOp): FieldDef[] {
  return op.inputFields ?? (op as { inputFields?: FieldDef[] }).inputFields ?? [];
}

export function fieldKey(f: FieldDef) {
  return f.key ?? (f as { key?: string }).key ?? "";
}

export function appAuth(app: CatalogApp) {
  return app.authType ?? (app as { authType?: string }).authType ?? "none";
}

export function opSample(op: CatalogOp) {
  return op.outputSample ?? (op as { outputSample?: Record<string, unknown> }).outputSample ?? {};
}

export function needsConnection(app: CatalogApp) {
  const auth = appAuth(app);
  return Boolean(auth && auth !== "none");
}

export function logicKind(
  slug: string
): "filter" | "path" | "loop" | "delay" | "formatter" | "code" | "webhook" | "http" | "ai" | "approval" | "subflow" | "action" {
  if (slug === "filter") return "filter";
  if (slug === "paths") return "path";
  if (slug === "loop") return "loop";
  if (slug === "delay") return "delay";
  if (slug === "formatter") return "formatter";
  if (slug === "code") return "code";
  if (slug === "webhook") return "webhook";
  if (slug === "http") return "http";
  if (slug === "openai" || slug === "anthropic" || slug === "gemini") return "ai";
  if (slug === "approval") return "approval";
  if (slug === "subflow") return "subflow";
  return "action";
}

export function graphNodeType(op: CatalogOp, slug: string): "trigger" | "action" | "logic" {
  if (op.type === "trigger") return "trigger";
  const k = logicKind(slug);
  if (k === "filter" || k === "path" || k === "loop" || k === "delay") return "logic";
  return "action";
}

export const GOOGLE_SLUGS = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

export function isGoogleApp(slug: string) {
  return GOOGLE_SLUGS.has(slug);
}

export function libraryGroup(slug: string): "Triggers" | "Flow" | "AI" | "Developer" | "Apps" {
  if (["webhook", "schedule", "manual", "forms"].includes(slug)) return "Triggers";
  if (["filter", "paths", "loop", "delay", "formatter", "digest", "storage", "email-parser", "transfer", "rss"].includes(slug)) return "Flow";
  if (["openai", "anthropic", "gemini", "ai-guardrails", "ai"].includes(slug)) return "AI";
  if (["http", "code", "subflow"].includes(slug)) return "Developer";
  return "Apps";
}

export function mergeCatalog(apps?: CatalogApp[] | null): CatalogApp[] {
  const incoming = (apps ?? []).filter((a) => a?.slug);
  if (incoming.length >= 30) return incoming;
  const seen = new Set(incoming.map((a) => a.slug));
  return [...incoming, ...FALLBACK_APPS.filter((a) => !seen.has(a.slug))];
}

const FALLBACK_APPS: CatalogApp[] = [
  // ── Core / Logic ──
  { slug: "webhook", name: "Webhooks", category: "developer", authType: "none", operations: [{ key: "catch_hook", name: "Catch Hook", type: "trigger" }, { key: "send_hook", name: "Send Webhook", type: "action" }] },
  { slug: "schedule", name: "Schedule", category: "core", authType: "none", operations: [{ key: "cron", name: "Cron", type: "trigger" }] },
  { slug: "manual", name: "Manual", category: "core", authType: "none", operations: [{ key: "button", name: "Manual Trigger", type: "trigger" }] },
  { slug: "http", name: "HTTP / API Request", category: "developer", authType: "none", operations: [{ key: "catch_hook", name: "Catch Webhook", type: "trigger" }, { key: "request", name: "Custom Request", type: "action" }] },
  { slug: "filter", name: "Filter", category: "flow", authType: "none", operations: [{ key: "only_continue_if", name: "Only continue if", type: "action" }] },
  { slug: "paths", name: "Paths", category: "flow", authType: "none", operations: [{ key: "router", name: "Paths", type: "action" }, { key: "branch", name: "True / False branch", type: "action" }] },
  { slug: "loop", name: "Looping", category: "flow", authType: "none", operations: [{ key: "for_each", name: "For Each", type: "action" }] },
  { slug: "delay", name: "Delay", category: "flow", authType: "none", operations: [{ key: "for", name: "Delay For", type: "action" }, { key: "until", name: "Delay Until", type: "action" }] },
  { slug: "approval", name: "Human in the Loop", category: "flow", authType: "none", operations: [{ key: "approve", name: "Ask for approval", type: "action" }] },
  { slug: "formatter", name: "Formatter", category: "utilities", authType: "none", operations: [{ key: "text", name: "Text", type: "action" }, { key: "date", name: "Date / Time", type: "action" }, { key: "number", name: "Numbers", type: "action" }] },
  { slug: "code", name: "Code", category: "developer", authType: "none", operations: [{ key: "javascript", name: "Run JavaScript", type: "action" }, { key: "python", name: "Run Python", type: "action" }] },
  { slug: "digest", name: "Digest", category: "logic", authType: "none", operations: [{ key: "add", name: "Add to Digest", type: "action" }, { key: "release", name: "Release Digest", type: "action" }] },
  { slug: "storage", name: "Storage", category: "logic", authType: "none", operations: [{ key: "set", name: "Set Value", type: "action" }, { key: "get", name: "Get Value", type: "action" }] },
  { slug: "subflow", name: "Sub-workflow", category: "logic", authType: "none", operations: [{ key: "call", name: "Call automation", type: "action" }] },
  { slug: "transfer", name: "Transfer", category: "logic", authType: "none", operations: [{ key: "run", name: "Run Transfer", type: "action" }] },

  // ── Data ──
  { slug: "tables", name: "Tables", category: "data", authType: "none", operations: [{ key: "new_record", name: "New Record", type: "trigger" }, { key: "create_record", name: "Create Record", type: "action" }, { key: "update_record", name: "Update Record", type: "action" }, { key: "delete_record", name: "Delete Record", type: "action" }, { key: "find_record", name: "Find Record", type: "search" }] },
  { slug: "forms", name: "Forms", category: "data", authType: "none", operations: [{ key: "submitted", name: "New Submission", type: "trigger" }] },

  // ── Google ──
  { slug: "gmail", name: "Gmail", category: "communication", authType: "oauth2", operations: [{ key: "new_email", name: "New Email", type: "trigger" }, { key: "send_email", name: "Send Email", type: "action" }] },
  { slug: "google-sheets", name: "Google Sheets", category: "productivity", authType: "oauth2", operations: [{ key: "new_row", name: "New or Updated Spreadsheet Row", type: "trigger" }, { key: "create_row", name: "Create Row", type: "action" }, { key: "append_row", name: "Append Row", type: "action" }, { key: "update_row", name: "Update Row", type: "action" }, { key: "find_row", name: "Find Row", type: "search" }] },
  { slug: "google-calendar", name: "Google Calendar", category: "productivity", authType: "oauth2", operations: [{ key: "new_event", name: "New Event", type: "trigger" }, { key: "create_event", name: "Create Event", type: "action" }, { key: "list_events", name: "List Events", type: "search" }, { key: "update_event", name: "Update Event", type: "action" }, { key: "delete_event", name: "Delete Event", type: "action" }] },
  { slug: "google-drive", name: "Google Drive", category: "storage", authType: "oauth2", operations: [{ key: "new_file", name: "New File", type: "trigger" }, { key: "upload_file", name: "Upload File", type: "action" }] },
  { slug: "google-docs", name: "Google Docs", category: "productivity", authType: "oauth2", operations: [{ key: "new_document", name: "New Document", type: "trigger" }, { key: "create_document", name: "Create Document", type: "action" }] },
  { slug: "google-slides", name: "Google Slides", category: "productivity", authType: "oauth2", operations: [{ key: "new_presentation", name: "New Presentation", type: "trigger" }, { key: "create_presentation", name: "Create Presentation", type: "action" }] },
  { slug: "google-forms", name: "Google Forms", category: "forms", authType: "oauth2", operations: [{ key: "new_response", name: "New Response", type: "trigger" }, { key: "create_form", name: "Create Form", type: "action" }] },
  { slug: "google-chat", name: "Google Chat", category: "communication", authType: "oauth2", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "google-meet", name: "Google Meet", category: "communication", authType: "oauth2", operations: [{ key: "new_meeting", name: "New Meeting", type: "trigger" }, { key: "create_meeting", name: "Create Meeting", type: "action" }] },

  // ── Communication ──
  { slug: "slack", name: "Slack", category: "communication", authType: "oauth2", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Channel Message", type: "action" }] },
  { slug: "whatsapp", name: "WhatsApp Cloud", category: "communication", authType: "api_key", operations: [{ key: "inbound_message", name: "New Inbound Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }, { key: "send_template", name: "Send Template", type: "action" }] },
  { slug: "discord", name: "Discord", category: "communication", authType: "api_key", operations: [{ key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "telegram", name: "Telegram", category: "communication", authType: "api_key", operations: [{ key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "twilio", name: "Twilio", category: "communication", authType: "basic", operations: [{ key: "send_sms", name: "Send SMS", type: "action" }] },
  { slug: "microsoft-teams", name: "Microsoft Teams", category: "communication", authType: "oauth2", operations: [{ key: "new_message", name: "New Channel Message", type: "trigger" }, { key: "send_message", name: "Send Channel Message", type: "action" }] },
  { slug: "outlook", name: "Outlook", category: "communication", authType: "oauth2", operations: [{ key: "new_email", name: "New Email", type: "trigger" }, { key: "send_email", name: "Send Email", type: "action" }] },
  { slug: "email", name: "Email", category: "communication", authType: "api_key", operations: [{ key: "send", name: "Send Email", type: "action" }] },
  { slug: "email-parser", name: "Email Parser", category: "communication", authType: "none", operations: [{ key: "new_email", name: "New Parsed Email", type: "trigger" }, { key: "parse", name: "Parse Text", type: "action" }] },
  { slug: "vonage", name: "Vonage", category: "communication", authType: "api_key", operations: [{ key: "inbound_sms", name: "Inbound SMS", type: "trigger" }, { key: "send_sms", name: "Send SMS", type: "action" }] },
  { slug: "messagebird", name: "MessageBird", category: "communication", authType: "api_key", operations: [{ key: "inbound_sms", name: "Inbound SMS", type: "trigger" }, { key: "send_sms", name: "Send SMS", type: "action" }] },
  { slug: "zoom", name: "Zoom", category: "communication", authType: "oauth2", operations: [{ key: "new_meeting", name: "New Meeting", type: "trigger" }, { key: "create_meeting", name: "Create Meeting", type: "action" }] },
  { slug: "mattermost", name: "Mattermost", category: "communication", authType: "api_key", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "sendgrid", name: "SendGrid", category: "communication", authType: "api_key", operations: [{ key: "send_email", name: "Send Email", type: "action" }] },
  { slug: "rss", name: "RSS by Orchestra", category: "utilities", authType: "none", operations: [{ key: "new_item", name: "New Item in Feed", type: "trigger" }] },

  // ── CRM ──
  { slug: "hubspot", name: "HubSpot", category: "crm", authType: "oauth2", operations: [{ key: "new_contact", name: "New Contact", type: "trigger" }, { key: "create_contact", name: "Create Contact", type: "action" }, { key: "search_contacts", name: "Search Contacts", type: "action" }, { key: "new_deal", name: "New Deal", type: "trigger" }, { key: "create_deal", name: "Create Deal", type: "action" }, { key: "update_deal", name: "Update Deal", type: "action" }, { key: "new_company", name: "New Company", type: "trigger" }, { key: "create_company", name: "Create Company", type: "action" }, { key: "new_ticket", name: "New Ticket", type: "trigger" }, { key: "create_ticket", name: "Create Ticket", type: "action" }] },
  { slug: "salesforce", name: "Salesforce", category: "crm", authType: "oauth2", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_lead", name: "Create Lead", type: "action" }] },
  { slug: "pipedrive", name: "Pipedrive", category: "crm", authType: "oauth2", operations: [{ key: "new_deal", name: "New Deal", type: "trigger" }, { key: "create_deal", name: "Create Deal", type: "action" }] },
  { slug: "zoho-crm", name: "Zoho CRM", category: "crm", authType: "oauth2", operations: [{ key: "new_contact", name: "New Contact", type: "trigger" }, { key: "create_contact", name: "Create Contact", type: "action" }] },
  { slug: "close", name: "Close", category: "crm", authType: "api_key", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_lead", name: "Create Lead", type: "action" }] },
  { slug: "copper", name: "Copper", category: "crm", authType: "oauth2", operations: [{ key: "new_person", name: "New Person", type: "trigger" }, { key: "create_person", name: "Create Person", type: "action" }] },
  { slug: "freshsales", name: "Freshsales", category: "crm", authType: "api_key", operations: [{ key: "new_contact", name: "New Contact", type: "trigger" }, { key: "create_contact", name: "Create Contact", type: "action" }] },
  { slug: "keap", name: "Keap", category: "crm", authType: "oauth2", operations: [{ key: "new_contact", name: "New Contact", type: "trigger" }, { key: "create_contact", name: "Create Contact", type: "action" }] },

  // ── Developer ──
  { slug: "github", name: "GitHub", category: "developer", authType: "oauth2", operations: [{ key: "new_issue", name: "New Issue", type: "trigger" }, { key: "push_event", name: "Push", type: "trigger" }, { key: "pull_request_event", name: "Pull Request", type: "trigger" }, { key: "create_issue", name: "Create Issue", type: "action" }, { key: "update_issue", name: "Update Issue", type: "action" }, { key: "close_issue", name: "Close Issue", type: "action" }, { key: "create_pr", name: "Create Pull Request", type: "action" }, { key: "merge_pr", name: "Merge PR", type: "action" }, { key: "add_comment", name: "Add Comment", type: "action" }, { key: "list_repos", name: "List Repositories", type: "action" }] },
  { slug: "jira", name: "Jira", category: "developer", authType: "basic", operations: [{ key: "create_issue", name: "Create Issue", type: "action" }] },
  { slug: "linear", name: "Linear", category: "developer", authType: "api_key", operations: [{ key: "create_issue", name: "Create Issue", type: "action" }] },
  { slug: "gitlab", name: "GitLab", category: "developer", authType: "oauth2", operations: [{ key: "new_issue", name: "New Issue", type: "trigger" }, { key: "create_issue", name: "Create Issue", type: "action" }] },
  { slug: "bitbucket", name: "Bitbucket", category: "developer", authType: "oauth2", operations: [{ key: "new_commit", name: "New Commit", type: "trigger" }, { key: "create_issue", name: "Create Issue", type: "action" }] },
  { slug: "vercel", name: "Vercel", category: "developer", authType: "api_key", operations: [{ key: "deployment", name: "New Deployment", type: "trigger" }, { key: "create_deployment", name: "Create Deployment", type: "action" }] },
  { slug: "netlify", name: "Netlify", category: "developer", authType: "oauth2", operations: [{ key: "deploy", name: "New Deploy", type: "trigger" }, { key: "trigger_build", name: "Trigger Build", type: "action" }] },
  { slug: "pagerduty", name: "PagerDuty", category: "developer", authType: "api_key", operations: [{ key: "new_incident", name: "New Incident", type: "trigger" }, { key: "create_incident", name: "Create Incident", type: "action" }] },
  { slug: "sentry", name: "Sentry", category: "developer", authType: "api_key", operations: [{ key: "new_issue", name: "New Issue", type: "trigger" }, { key: "create_issue", name: "Create Issue", type: "action" }] },
  { slug: "datadog", name: "Datadog", category: "developer", authType: "api_key", operations: [{ key: "new_alert", name: "New Alert", type: "trigger" }, { key: "post_event", name: "Post Event", type: "action" }] },

  // ── AI ──
  { slug: "openai", name: "OpenAI", category: "ai", authType: "api_key", operations: [{ key: "complete", name: "Custom prompt", type: "action" }, { key: "extract", name: "Extract", type: "action" }, { key: "summarize", name: "Summarize", type: "action" }, { key: "classify", name: "Classify", type: "action" }, { key: "write", name: "Write", type: "action" }, { key: "translate", name: "Translate", type: "action" }, { key: "analyze", name: "Analyze", type: "action" }, { key: "transcribe", name: "Transcribe", type: "action" }, { key: "search", name: "Search", type: "action" }] },
  { slug: "anthropic", name: "Anthropic", category: "ai", authType: "api_key", operations: [{ key: "complete", name: "Message", type: "action" }] },
  { slug: "gemini", name: "Google Gemini", category: "ai", authType: "api_key", operations: [{ key: "complete", name: "Generate", type: "action" }] },
  { slug: "ai", name: "AI", category: "ai", authType: "api_key", operations: [{ key: "summarize", name: "Summarize", type: "action" }, { key: "classify", name: "Classify", type: "action" }, { key: "extract", name: "Extract", type: "action" }, { key: "draft", name: "Draft", type: "action" }, { key: "complete", name: "Prompt", type: "action" }] },
  { slug: "ai-guardrails", name: "AI Guardrails", category: "ai", authType: "none", operations: [{ key: "screen", name: "Screen Output", type: "action" }] },
  { slug: "agents", name: "Agents", category: "ai", authType: "none", operations: [{ key: "run", name: "Run Agent", type: "action" }] },
  { slug: "chatbots", name: "Chatbots", category: "ai", authType: "none", operations: [{ key: "message", name: "Send Chatbot Message", type: "action" }] },
  { slug: "huggingface", name: "Hugging Face", category: "ai", authType: "api_key", operations: [{ key: "new_model", name: "New Model", type: "trigger" }, { key: "generate", name: "Generate Text", type: "action" }] },
  { slug: "cohere", name: "Cohere", category: "ai", authType: "api_key", operations: [{ key: "complete", name: "Complete", type: "trigger" }, { key: "generate", name: "Generate", type: "action" }] },
  { slug: "replicate", name: "Replicate", category: "ai", authType: "api_key", operations: [{ key: "prediction", name: "New Prediction", type: "trigger" }, { key: "run_model", name: "Run Model", type: "action" }] },
  { slug: "elevenlabs", name: "ElevenLabs", category: "ai", authType: "api_key", operations: [{ key: "new_voice", name: "New Voice", type: "trigger" }, { key: "tts", name: "Text to Speech", type: "action" }] },

  // ── Productivity ──
  { slug: "notion", name: "Notion", category: "productivity", authType: "oauth2", operations: [{ key: "create_page", name: "Create Page", type: "action" }] },
  { slug: "asana", name: "Asana", category: "productivity", authType: "oauth2", operations: [{ key: "new_task", name: "New Task", type: "trigger" }, { key: "create_task", name: "Create Task", type: "action" }] },
  { slug: "clickup", name: "ClickUp", category: "productivity", authType: "oauth2", operations: [{ key: "new_task", name: "New Task", type: "trigger" }, { key: "create_task", name: "Create Task", type: "action" }] },
  { slug: "monday", name: "monday.com", category: "productivity", authType: "oauth2", operations: [{ key: "new_item", name: "New Item", type: "trigger" }, { key: "create_item", name: "Create Item", type: "action" }] },
  { slug: "trello", name: "Trello", category: "productivity", authType: "api_key", operations: [{ key: "new_card", name: "New Card", type: "trigger" }, { key: "create_card", name: "Create Card", type: "action" }] },
  { slug: "calendly", name: "Calendly", category: "productivity", authType: "oauth2", operations: [{ key: "invitee_created", name: "Invitee Created", type: "trigger" }] },
  { slug: "basecamp", name: "Basecamp", category: "productivity", authType: "oauth2", operations: [{ key: "new_todo", name: "New To-do", type: "trigger" }, { key: "create_todo", name: "Create To-do", type: "action" }] },
  { slug: "wrike", name: "Wrike", category: "productivity", authType: "oauth2", operations: [{ key: "new_task", name: "New Task", type: "trigger" }, { key: "create_task", name: "Create Task", type: "action" }] },
  { slug: "smartsheet", name: "Smartsheet", category: "productivity", authType: "oauth2", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "add_row", name: "Add Row", type: "action" }] },
  { slug: "todoist", name: "Todoist", category: "productivity", authType: "oauth2", operations: [{ key: "new_task", name: "New Task", type: "trigger" }, { key: "create_task", name: "Create Task", type: "action" }] },
  { slug: "miro", name: "Miro", category: "productivity", authType: "oauth2", operations: [{ key: "new_board", name: "New Board", type: "trigger" }, { key: "create_item", name: "Create Item", type: "action" }] },
  { slug: "confluence", name: "Confluence", category: "productivity", authType: "oauth2", operations: [{ key: "new_page", name: "New Page", type: "trigger" }, { key: "create_page", name: "Create Page", type: "action" }] },
  { slug: "microsoft-excel", name: "Microsoft Excel 365", category: "productivity", authType: "oauth2", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "add_row", name: "Add Row", type: "action" }] },
  { slug: "coda", name: "Coda", category: "productivity", authType: "api_key", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "upsert_row", name: "Upsert Row", type: "action" }] },

  // ── Storage / Files ──
  { slug: "dropbox", name: "Dropbox", category: "files", authType: "oauth2", operations: [{ key: "new_file", name: "New File", type: "trigger" }, { key: "upload_file", name: "Upload File", type: "action" }] },
  { slug: "box", name: "Box", category: "files", authType: "oauth2", operations: [{ key: "new_file", name: "New File", type: "trigger" }, { key: "upload_file", name: "Upload File", type: "action" }] },
  { slug: "onedrive", name: "OneDrive", category: "storage", authType: "oauth2", operations: [{ key: "new_file", name: "New File", type: "trigger" }, { key: "upload_file", name: "Upload File", type: "action" }] },
  { slug: "sharepoint", name: "SharePoint", category: "storage", authType: "oauth2", operations: [{ key: "new_file", name: "New File", type: "trigger" }, { key: "upload_file", name: "Upload File", type: "action" }] },
  { slug: "amazon-s3", name: "Amazon S3", category: "storage", authType: "custom", operations: [{ key: "new_object", name: "New Object", type: "trigger" }, { key: "upload_object", name: "Upload Object", type: "action" }] },

  // ── Payments / Commerce ──
  { slug: "stripe", name: "Stripe", category: "payments", authType: "api_key", operations: [{ key: "new_payment", name: "New Payment", type: "trigger" }, { key: "create_customer", name: "Create Customer", type: "action" }] },
  { slug: "shopify", name: "Shopify", category: "commerce", authType: "api_key", operations: [{ key: "new_order", name: "New Order", type: "trigger" }, { key: "create_customer", name: "Create Customer", type: "action" }] },
  { slug: "woocommerce", name: "WooCommerce", category: "commerce", authType: "basic", operations: [{ key: "new_order", name: "New Order", type: "trigger" }, { key: "create_order", name: "Create Order", type: "action" }] },
  { slug: "bigcommerce", name: "BigCommerce", category: "commerce", authType: "api_key", operations: [{ key: "new_order", name: "New Order", type: "trigger" }, { key: "create_customer", name: "Create Customer", type: "action" }] },
  { slug: "etsy", name: "Etsy", category: "commerce", authType: "oauth2", operations: [{ key: "new_order", name: "New Order", type: "trigger" }, { key: "update_listing", name: "Update Listing", type: "action" }] },
  { slug: "square", name: "Square", category: "payments", authType: "oauth2", operations: [{ key: "new_payment", name: "New Payment", type: "trigger" }, { key: "create_payment", name: "Create Payment", type: "action" }] },
  { slug: "paypal", name: "PayPal", category: "finance", authType: "oauth2", operations: [{ key: "new_sale", name: "New Sale", type: "trigger" }, { key: "send_payout", name: "Send Payout", type: "action" }] },
  { slug: "chargebee", name: "Chargebee", category: "payments", authType: "api_key", operations: [{ key: "new_subscription", name: "New Subscription", type: "trigger" }, { key: "create_customer", name: "Create Customer", type: "action" }] },
  { slug: "razorpay", name: "Razorpay", category: "payments", authType: "api_key", operations: [{ key: "new_payment", name: "New Payment", type: "trigger" }, { key: "create_payment_link", name: "Create Payment Link", type: "action" }] },

  // ── Finance / Accounting ──
  { slug: "quickbooks", name: "QuickBooks", category: "finance", authType: "oauth2", operations: [{ key: "new_invoice", name: "New Invoice", type: "trigger" }, { key: "create_invoice", name: "Create Invoice", type: "action" }] },
  { slug: "xero", name: "Xero", category: "finance", authType: "oauth2", operations: [{ key: "new_invoice", name: "New Invoice", type: "trigger" }, { key: "create_invoice", name: "Create Invoice", type: "action" }] },
  { slug: "freshbooks", name: "FreshBooks", category: "finance", authType: "oauth2", operations: [{ key: "new_invoice", name: "New Invoice", type: "trigger" }, { key: "create_invoice", name: "Create Invoice", type: "action" }] },
  { slug: "expensify", name: "Expensify", category: "finance", authType: "oauth2", operations: [{ key: "new_expense", name: "New Expense", type: "trigger" }, { key: "create_expense", name: "Create Expense", type: "action" }] },

  // ── Support ──
  { slug: "zendesk", name: "Zendesk", category: "support", authType: "basic", operations: [{ key: "new_ticket", name: "New Ticket", type: "trigger" }, { key: "create_ticket", name: "Create Ticket", type: "action" }] },
  { slug: "intercom", name: "Intercom", category: "support", authType: "oauth2", operations: [{ key: "new_conversation", name: "New Conversation", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "freshdesk", name: "Freshdesk", category: "support", authType: "api_key", operations: [{ key: "new_ticket", name: "New Ticket", type: "trigger" }, { key: "create_ticket", name: "Create Ticket", type: "action" }] },
  { slug: "helpscout", name: "Help Scout", category: "support", authType: "oauth2", operations: [{ key: "new_conversation", name: "New Conversation", type: "trigger" }, { key: "create_conversation", name: "Create Conversation", type: "action" }] },
  { slug: "front", name: "Front", category: "support", authType: "oauth2", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "gorgias", name: "Gorgias", category: "support", authType: "api_key", operations: [{ key: "new_ticket", name: "New Ticket", type: "trigger" }, { key: "create_ticket", name: "Create Ticket", type: "action" }] },
  { slug: "crisp", name: "Crisp", category: "support", authType: "api_key", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },

  // ── Marketing ──
  { slug: "mailchimp", name: "Mailchimp", category: "marketing", authType: "oauth2", operations: [{ key: "new_subscriber", name: "New Subscriber", type: "trigger" }, { key: "add_subscriber", name: "Add Subscriber", type: "action" }] },
  { slug: "activecampaign", name: "ActiveCampaign", category: "marketing", authType: "api_key", operations: [{ key: "new_subscriber", name: "New Subscriber", type: "trigger" }, { key: "add_subscriber", name: "Add Subscriber", type: "action" }] },
  { slug: "klaviyo", name: "Klaviyo", category: "marketing", authType: "api_key", operations: [{ key: "new_profile", name: "New Profile", type: "trigger" }, { key: "add_profile", name: "Add Profile", type: "action" }] },
  { slug: "brevo", name: "Brevo", category: "marketing", authType: "api_key", operations: [{ key: "new_contact", name: "New Contact", type: "trigger" }, { key: "add_contact", name: "Add Contact", type: "action" }] },
  { slug: "convertkit", name: "ConvertKit", category: "marketing", authType: "api_key", operations: [{ key: "new_subscriber", name: "New Subscriber", type: "trigger" }, { key: "add_subscriber", name: "Add Subscriber", type: "action" }] },
  { slug: "mailerlite", name: "MailerLite", category: "marketing", authType: "api_key", operations: [{ key: "new_subscriber", name: "New Subscriber", type: "trigger" }, { key: "add_subscriber", name: "Add Subscriber", type: "action" }] },

  // ── Social ──
  { slug: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2", operations: [{ key: "new_post", name: "New Post", type: "trigger" }, { key: "create_post", name: "Create Post", type: "action" }] },
  { slug: "facebook", name: "Facebook Pages", category: "social", authType: "oauth2", operations: [{ key: "new_post", name: "New Page Post", type: "trigger" }, { key: "create_post", name: "Create Page Post", type: "action" }] },
  { slug: "instagram", name: "Instagram", category: "social", authType: "oauth2", operations: [{ key: "new_media", name: "New Media", type: "trigger" }, { key: "publish_photo", name: "Publish Photo", type: "action" }] },
  { slug: "youtube", name: "YouTube", category: "social", authType: "oauth2", operations: [{ key: "new_video", name: "New Video", type: "trigger" }, { key: "upload_video", name: "Upload Video", type: "action" }] },
  { slug: "twitter", name: "X (Twitter)", category: "social", authType: "oauth2", operations: [{ key: "new_mention", name: "New Mention", type: "trigger" }, { key: "post_tweet", name: "Post Tweet", type: "action" }] },
  { slug: "reddit", name: "Reddit", category: "social", authType: "oauth2", operations: [{ key: "new_post", name: "New Post in Subreddit", type: "trigger" }, { key: "submit_post", name: "Submit Post", type: "action" }] },
  { slug: "pinterest", name: "Pinterest", category: "social", authType: "oauth2", operations: [{ key: "new_pin", name: "New Pin", type: "trigger" }, { key: "create_pin", name: "Create Pin", type: "action" }] },
  { slug: "tiktok", name: "TikTok", category: "social", authType: "oauth2", operations: [{ key: "new_video", name: "New Video", type: "trigger" }, { key: "upload_video", name: "Upload Video", type: "action" }] },
  { slug: "buffer", name: "Buffer", category: "social", authType: "oauth2", operations: [{ key: "new_update", name: "New Update", type: "trigger" }, { key: "create_update", name: "Create Update", type: "action" }] },
  { slug: "spotify", name: "Spotify", category: "media", authType: "oauth2", operations: [{ key: "new_saved_track", name: "New Saved Track", type: "trigger" }, { key: "add_to_playlist", name: "Add to Playlist", type: "action" }] },

  // ── Forms / Surveys ──
  { slug: "typeform", name: "Typeform", category: "forms", authType: "oauth2", operations: [{ key: "new_entry", name: "New Entry", type: "trigger" }, { key: "new_submission", name: "New Submission", type: "trigger" }, { key: "list_forms", name: "List Forms", type: "action" }, { key: "get_responses", name: "Get Responses", type: "action" }, { key: "create_form", name: "Create Form", type: "action" }] },
  { slug: "jotform", name: "Jotform", category: "forms", authType: "api_key", operations: [{ key: "new_submission", name: "New Submission", type: "trigger" }, { key: "create_form", name: "Create Form", type: "action" }] },
  { slug: "surveymonkey", name: "SurveyMonkey", category: "forms", authType: "oauth2", operations: [{ key: "new_response", name: "New Response", type: "trigger" }, { key: "create_collector", name: "Create Collector", type: "action" }] },
  { slug: "tally", name: "Tally", category: "forms", authType: "api_key", operations: [{ key: "new_submission", name: "New Submission", type: "trigger" }, { key: "list_forms", name: "List Forms", type: "action" }] },

  // ── Databases ──
  { slug: "postgresql", name: "PostgreSQL", category: "databases", authType: "custom", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "run_query", name: "Run Query", type: "action" }] },
  { slug: "mysql", name: "MySQL", category: "databases", authType: "custom", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "insert_row", name: "Insert Row", type: "action" }] },
  { slug: "mongodb", name: "MongoDB", category: "databases", authType: "custom", operations: [{ key: "new_document", name: "New Document", type: "trigger" }, { key: "insert_document", name: "Insert Document", type: "action" }] },
  { slug: "supabase", name: "Supabase", category: "databases", authType: "api_key", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "insert_row", name: "Insert Row", type: "action" }] },
  { slug: "firebase", name: "Firebase", category: "databases", authType: "custom", operations: [{ key: "new_document", name: "New Document", type: "trigger" }, { key: "set_document", name: "Set Document", type: "action" }] },
  { slug: "snowflake", name: "Snowflake", category: "databases", authType: "custom", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "run_query", name: "Run Query", type: "action" }] },
  { slug: "bigquery", name: "BigQuery", category: "databases", authType: "oauth2", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "run_query", name: "Run Query", type: "action" }] },
  { slug: "airtable", name: "Airtable", category: "data", authType: "api_key", operations: [{ key: "create_record", name: "Create Record", type: "action" }] },

  // ── HR ──
  { slug: "bamboohr", name: "BambooHR", category: "hr", authType: "api_key", operations: [{ key: "new_employee", name: "New Employee", type: "trigger" }, { key: "create_employee", name: "Create Employee", type: "action" }] },
  { slug: "greenhouse", name: "Greenhouse", category: "hr", authType: "api_key", operations: [{ key: "new_candidate", name: "New Candidate", type: "trigger" }, { key: "create_candidate", name: "Create Candidate", type: "action" }] },
  { slug: "lever", name: "Lever", category: "hr", authType: "oauth2", operations: [{ key: "new_candidate", name: "New Candidate", type: "trigger" }, { key: "create_candidate", name: "Create Candidate", type: "action" }] },
  { slug: "gusto", name: "Gusto", category: "hr", authType: "oauth2", operations: [{ key: "new_employee", name: "New Employee", type: "trigger" }, { key: "create_employee", name: "Create Employee", type: "action" }] },
  { slug: "workable", name: "Workable", category: "hr", authType: "api_key", operations: [{ key: "new_candidate", name: "New Candidate", type: "trigger" }, { key: "create_candidate", name: "Create Candidate", type: "action" }] },

  // ── CMS ──
  { slug: "wordpress", name: "WordPress", category: "cms", authType: "basic", operations: [{ key: "new_post", name: "New Post", type: "trigger" }, { key: "create_post", name: "Create Post", type: "action" }] },
  { slug: "webflow", name: "Webflow", category: "cms", authType: "oauth2", operations: [{ key: "new_item", name: "New CMS Item", type: "trigger" }, { key: "create_item", name: "Create CMS Item", type: "action" }] },
  { slug: "contentful", name: "Contentful", category: "cms", authType: "api_key", operations: [{ key: "new_entry", name: "New Entry", type: "trigger" }, { key: "create_entry", name: "Create Entry", type: "action" }] },
  { slug: "ghost", name: "Ghost", category: "cms", authType: "api_key", operations: [{ key: "new_post", name: "New Post", type: "trigger" }, { key: "create_post", name: "Create Post", type: "action" }] },

  // ── Ads / Analytics ──
  { slug: "google-ads", name: "Google Ads", category: "ads", authType: "oauth2", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_campaign", name: "Create Campaign", type: "action" }] },
  { slug: "facebook-ads", name: "Facebook Ads", category: "ads", authType: "oauth2", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_campaign", name: "Create Campaign", type: "action" }] },
  { slug: "linkedin-ads", name: "LinkedIn Ads", category: "ads", authType: "oauth2", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_campaign", name: "Create Campaign", type: "action" }] },
  { slug: "google-analytics", name: "Google Analytics", category: "analytics", authType: "oauth2", operations: [{ key: "goal", name: "Goal Completed", type: "trigger" }, { key: "send_event", name: "Send Event", type: "action" }] },
  { slug: "mixpanel", name: "Mixpanel", category: "analytics", authType: "api_key", operations: [{ key: "new_event", name: "New Event", type: "trigger" }, { key: "track", name: "Track Event", type: "action" }] },
  { slug: "amplitude", name: "Amplitude", category: "analytics", authType: "api_key", operations: [{ key: "new_event", name: "New Event", type: "trigger" }, { key: "track", name: "Track Event", type: "action" }] },
  { slug: "segment", name: "Segment", category: "analytics", authType: "api_key", operations: [{ key: "new_event", name: "New Event", type: "trigger" }, { key: "identify", name: "Identify", type: "action" }] },

  // ── Scheduling ──
  { slug: "cal-com", name: "Cal.com", category: "scheduling", authType: "api_key", operations: [{ key: "booking_created", name: "Booking Created", type: "trigger" }, { key: "create_booking", name: "Create Booking", type: "action" }] },
  { slug: "acuity", name: "Acuity Scheduling", category: "scheduling", authType: "api_key", operations: [{ key: "new_appointment", name: "New Appointment", type: "trigger" }, { key: "create_appointment", name: "Create Appointment", type: "action" }] },

  // ── Legal ──
  { slug: "docusign", name: "DocuSign", category: "legal", authType: "oauth2", operations: [{ key: "envelope_signed", name: "Envelope Signed", type: "trigger" }, { key: "send_envelope", name: "Send Envelope", type: "action" }] },
  { slug: "pandadoc", name: "PandaDoc", category: "legal", authType: "oauth2", operations: [{ key: "document_completed", name: "Document Completed", type: "trigger" }, { key: "create_document", name: "Create Document", type: "action" }] },
  { slug: "dropbox-sign", name: "Dropbox Sign", category: "legal", authType: "api_key", operations: [{ key: "signature_request", name: "Signature Request Signed", type: "trigger" }, { key: "send_request", name: "Send Signature Request", type: "action" }] },
  { slug: "clio", name: "Clio", category: "legal", authType: "oauth2", operations: [{ key: "new_matter", name: "New Matter", type: "trigger" }, { key: "create_matter", name: "Create Matter", type: "action" }] },

  // ── Logistics ──
  { slug: "shipstation", name: "ShipStation", category: "logistics", authType: "api_key", operations: [{ key: "new_order", name: "New Order", type: "trigger" }, { key: "create_label", name: "Create Label", type: "action" }] },
  { slug: "shippo", name: "Shippo", category: "logistics", authType: "api_key", operations: [{ key: "new_shipment", name: "New Shipment", type: "trigger" }, { key: "create_shipment", name: "Create Shipment", type: "action" }] },

  // ── ERP ──
  { slug: "odoo", name: "Odoo", category: "erp", authType: "custom", operations: [{ key: "new_record", name: "New Record", type: "trigger" }, { key: "create_record", name: "Create Record", type: "action" }] },
  { slug: "dynamics365", name: "Microsoft Dynamics 365", category: "erp", authType: "oauth2", operations: [{ key: "new_record", name: "New Record", type: "trigger" }, { key: "create_record", name: "Create Record", type: "action" }] },
  { slug: "netsuite", name: "NetSuite", category: "erp", authType: "custom", operations: [{ key: "new_record", name: "New Record", type: "trigger" }, { key: "create_record", name: "Create Record", type: "action" }] },

  // ── Events ──
  { slug: "eventbrite", name: "Eventbrite", category: "events", authType: "oauth2", operations: [{ key: "new_attendee", name: "New Attendee", type: "trigger" }, { key: "create_event", name: "Create Event", type: "action" }] },
  { slug: "meetup", name: "Meetup", category: "events", authType: "oauth2", operations: [{ key: "new_rsvp", name: "New RSVP", type: "trigger" }, { key: "create_event", name: "Create Event", type: "action" }] },

  // ── Notes ──
  { slug: "evernote", name: "Evernote", category: "notes", authType: "oauth2", operations: [{ key: "new_note", name: "New Note", type: "trigger" }, { key: "create_note", name: "Create Note", type: "action" }] },
  { slug: "onenote", name: "OneNote", category: "notes", authType: "oauth2", operations: [{ key: "new_page", name: "New Page", type: "trigger" }, { key: "create_page", name: "Create Page", type: "action" }] },

  // ── Education ──
  { slug: "teachable", name: "Teachable", category: "education", authType: "api_key", operations: [{ key: "new_enrollment", name: "New Enrollment", type: "trigger" }, { key: "enroll", name: "Enroll Student", type: "action" }] },
  { slug: "thinkific", name: "Thinkific", category: "education", authType: "api_key", operations: [{ key: "new_enrollment", name: "New Enrollment", type: "trigger" }, { key: "enroll", name: "Enroll Student", type: "action" }] },
  { slug: "google-classroom", name: "Google Classroom", category: "education", authType: "oauth2", operations: [{ key: "new_coursework", name: "New Coursework", type: "trigger" }, { key: "create_coursework", name: "Create Coursework", type: "action" }] },

  // ── Security ──
  { slug: "okta", name: "Okta", category: "security", authType: "api_key", operations: [{ key: "new_user", name: "New User", type: "trigger" }, { key: "create_user", name: "Create User", type: "action" }] },
  { slug: "auth0", name: "Auth0", category: "security", authType: "custom", operations: [{ key: "new_user", name: "New User", type: "trigger" }, { key: "create_user", name: "Create User", type: "action" }] },

  // ── Real Estate ──
  { slug: "follow-up-boss", name: "Follow Up Boss", category: "realestate", authType: "api_key", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_lead", name: "Create Lead", type: "action" }] },
  { slug: "appfolio", name: "AppFolio", category: "realestate", authType: "custom", operations: [{ key: "new_lead", name: "New Lead", type: "trigger" }, { key: "create_work_order", name: "Create Work Order", type: "action" }] },

  // ── Meta / Platform ──
  { slug: "manager", name: "Automation Manager", category: "core", authType: "none", operations: [{ key: "run_ended", name: "Run Ended", type: "trigger" }, { key: "turn_off", name: "Turn Automation Off", type: "action" }] }
];

export function flattenSample(obj: unknown, prefix = ""): string[] {
  if (obj === null || obj === undefined) return prefix ? [prefix] : [];
  if (typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return flattenSample(obj[0] ?? {}, prefix ? `${prefix}[0]` : "[0]");
  const entries = Object.entries(obj as Record<string, unknown>);
  if (!entries.length) return prefix ? [prefix] : [];
  return entries.flatMap(([k, v]) => flattenSample(v, prefix ? `${prefix}.${k}` : k));
}

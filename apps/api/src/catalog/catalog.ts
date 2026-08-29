import type { AppManifest } from "@algoverge/shared";
import { DIRECTORY_APPS } from "./catalog-directory";
// Catalog uses authType/inputFields/triggerMode/outputSample; shared type is structurally compatible at runtime.

const coreFields = {
  url: { key: "url", label: "URL", type: "string" as const, required: true },
  method: {
    key: "method",
    label: "Method",
    type: "select" as const,
    options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((v) => ({ label: v, value: v }))
  }
};

const sheetDrive = {
  key: "drive",
  label: "Drive",
  type: "select" as const,
  options: [{ label: "My Google Drive", value: "my-drive" }],
  help: "Choose which Drive to search for spreadsheets."
};
const sheetId = {
  key: "spreadsheetId",
  label: "Spreadsheet",
  type: "dynamic" as const,
  required: true,
  dependsOn: ["drive"],
  help: "Search and pick a spreadsheet. Copilot will not invent this ID."
};
const sheetTab = {
  key: "sheet",
  label: "Worksheet",
  type: "dynamic" as const,
  required: true,
  dependsOn: ["spreadsheetId"],
  help: "Loads after a spreadsheet is selected."
};

export const APP_CATALOG: AppManifest[] = [
  {
    slug: "webhook",
    name: "Webhooks",
    description: "Catch inbound HTTP events or send outbound HTTP requests.",
    category: "developer",
    icon: "🔗",
    color: "#111827",
    authType: "none",
    operations: [
      {
        key: "catch_hook",
        name: "Catch Hook",
        type: "trigger",
        triggerMode: "webhook",
        inputFields: [{ key: "secret", label: "Optional HMAC secret", type: "string" }],
        outputSample: { body: {}, headers: {}, query: {} }
      },
      {
        key: "send_hook",
        name: "Send Webhook",
        type: "action",
        inputFields: [
          coreFields.url,
          coreFields.method,
          { key: "headers", label: "Headers JSON", type: "json" },
          { key: "body", label: "Body JSON", type: "json" }
        ]
      }
    ]
  },
  {
    slug: "schedule",
    name: "Schedule",
    description: "Run on a cron or interval.",
    category: "core",
    icon: "⏰",
    color: "#4f46e5",
    authType: "none",
    operations: [
      {
        key: "cron",
        name: "Cron",
        type: "trigger",
        triggerMode: "schedule",
        inputFields: [
          { key: "cron", label: "Cron expression", type: "string", required: true, placeholder: "*/15 * * * *" },
          { key: "timezone", label: "Timezone", type: "string", placeholder: "UTC" }
        ],
        outputSample: { scheduledFor: "2026-01-01T00:00:00Z" }
      }
    ]
  },
  {
    slug: "manual",
    name: "Manual",
    description: "Start a run from the UI or API.",
    category: "core",
    icon: "▶️",
    color: "#059669",
    authType: "none",
    operations: [
      {
        key: "button",
        name: "Manual Trigger",
        type: "trigger",
        triggerMode: "manual",
        inputFields: [{ key: "sample", label: "Sample payload JSON", type: "json" }],
        outputSample: { startedBy: "user" }
      }
    ]
  },
  {
    slug: "rss",
    name: "RSS by Orchestra",
    description: "Watch an RSS or Atom feed for new items.",
    category: "utilities",
    icon: "📡",
    color: "#ea580c",
    authType: "none",
    operations: [
      {
        key: "new_item",
        name: "New Item in Feed",
        type: "trigger",
        triggerMode: "polling",
        inputFields: [{ key: "feedUrl", label: "Feed URL", type: "string", required: true }],
        outputSample: { title: "Post title", link: "https://example.com/post", summary: "…" }
      }
    ]
  },
  {
    slug: "http",
    name: "HTTP / API Request",
    description: "Catch webhooks or call any REST API.",
    category: "developer",
    icon: "🌐",
    color: "#0ea5e9",
    authType: "none",
    operations: [
      {
        key: "catch_hook",
        name: "Catch Webhook",
        type: "trigger",
        triggerMode: "webhook",
        inputFields: [{ key: "secret", label: "Optional HMAC secret", type: "string" }],
        outputSample: { body: {}, headers: {}, query: {} }
      },
      {
        key: "request",
        name: "Custom Request",
        type: "action",
        inputFields: [
          coreFields.method,
          coreFields.url,
          { key: "headers", label: "Headers JSON", type: "json" },
          { key: "query", label: "Query JSON", type: "json" },
          { key: "body", label: "Body", type: "json" },
          { key: "timeoutMs", label: "Timeout ms", type: "number" }
        ]
      }
    ]
  },
  {
    slug: "filter",
    name: "Filter",
    description: "Continue only when conditions match.",
    category: "logic",
    icon: "⛳",
    color: "#f59e0b",
    authType: "none",
    operations: [
      {
        key: "only_continue_if",
        name: "Only continue if",
        type: "action",
        inputFields: [
          { key: "left", label: "Left value", type: "string", required: true },
          {
            key: "operator",
            label: "Operator",
            type: "select",
            required: true,
            options: [
              "equals",
              "not_equals",
              "contains",
              "not_contains",
              "starts_with",
              "ends_with",
              "gt",
              "lt",
              "gte",
              "lte",
              "exists",
              "empty",
              "not_empty"
            ].map((v) => ({ label: v, value: v }))
          },
          { key: "right", label: "Right value", type: "string" }
        ]
      }
    ]
  },
  {
    slug: "paths",
    name: "Paths",
    description: "Paths (router) — create branching logic with multiple outgoing arrows.",
    category: "logic",
    icon: "🔀",
    color: "#8b5cf6",
    authType: "none",
    operations: [
      {
        key: "router",
        name: "Paths (router)",
        type: "action",
        description: "Create branching logic — fan out to multiple paths with rules.",
        inputFields: [
          { key: "left", label: "Default field to check", type: "string" },
          {
            key: "operator",
            label: "Default operator",
            type: "select",
            options: ["equals", "contains", "gt", "lt", "not_empty"].map((v) => ({ label: v, value: v }))
          },
          { key: "right", label: "Default comparison value", type: "string" }
        ]
      },
      {
        key: "branch",
        name: "True / False branch",
        type: "action",
        inputFields: [
          { key: "left", label: "Left value", type: "string", required: true },
          {
            key: "operator",
            label: "Operator",
            type: "select",
            options: ["equals", "contains", "gt", "lt", "not_empty"].map((v) => ({ label: v, value: v }))
          },
          { key: "right", label: "Right value", type: "string" }
        ]
      }
    ]
  },
  {
    slug: "loop",
    name: "Looping",
    description: "Iterate over arrays / line items.",
    category: "logic",
    icon: "🔁",
    color: "#14b8a6",
    authType: "none",
    operations: [
      {
        key: "for_each",
        name: "For Each",
        type: "action",
        inputFields: [{ key: "items", label: "Array (JSON or mapped)", type: "json", required: true }]
      }
    ]
  },
  {
    slug: "delay",
    name: "Delay",
    description: "Pause the run for a duration or until a time.",
    category: "logic",
    icon: "⏳",
    color: "#64748b",
    authType: "none",
    operations: [
      {
        key: "for",
        name: "Delay For",
        type: "action",
        inputFields: [
          { key: "amount", label: "Amount", type: "number", required: true },
          {
            key: "unit",
            label: "Unit",
            type: "select",
            options: ["seconds", "minutes", "hours", "days"].map((v) => ({ label: v, value: v }))
          }
        ]
      },
      {
        key: "until",
        name: "Delay Until",
        type: "action",
        inputFields: [{ key: "at", label: "Resume at (ISO datetime)", type: "datetime", required: true }]
      }
    ]
  },
  {
    slug: "formatter",
    name: "Formatter",
    description: "Transform text, dates, numbers, lists, and JSON.",
    category: "logic",
    icon: "🧹",
    color: "#db2777",
    authType: "none",
    operations: [
      {
        key: "text",
        name: "Text",
        type: "action",
        inputFields: [
          { key: "input", label: "Input", type: "text", required: true },
          {
            key: "transform",
            label: "Transform",
            type: "select",
            options: [
              "upper",
              "lower",
              "trim",
              "title",
              "split",
              "replace",
              "extract_email",
              "extract_number"
            ].map((v) => ({ label: v, value: v }))
          },
          { key: "find", label: "Find", type: "string" },
          { key: "replaceWith", label: "Replace with", type: "string" },
          { key: "separator", label: "Split separator", type: "string" }
        ]
      },
      {
        key: "date",
        name: "Date / Time",
        type: "action",
        inputFields: [
          { key: "input", label: "Date", type: "string", required: true },
          { key: "offsetHours", label: "Offset hours", type: "number" }
        ]
      },
      {
        key: "number",
        name: "Numbers",
        type: "action",
        inputFields: [
          { key: "a", label: "A", type: "number", required: true },
          { key: "b", label: "B", type: "number" },
          {
            key: "op",
            label: "Operation",
            type: "select",
            options: ["add", "sub", "mul", "div", "round"].map((v) => ({ label: v, value: v }))
          }
        ]
      }
    ]
  },
  {
    slug: "code",
    name: "Code",
    description: "Run isolated JavaScript on the payload.",
    category: "developer",
    icon: "</>",
    color: "#111827",
    authType: "none",
    operations: [
      {
        key: "javascript",
        name: "Run JavaScript",
        type: "action",
        inputFields: [{ key: "code", label: "Code", type: "code", required: true }]
      },
      {
        key: "python",
        name: "Run Python",
        type: "action",
        inputFields: [{ key: "code", label: "Python", type: "code", required: true }]
      }
    ]
  },
  {
    slug: "approval",
    name: "Human in the Loop",
    description: "Pause for approve / reject.",
    category: "human",
    icon: "🙋",
    color: "#ea580c",
    authType: "none",
    operations: [
      {
        key: "approve",
        name: "Ask for approval",
        type: "action",
        inputFields: [
          { key: "message", label: "Prompt", type: "text", required: true },
          { key: "deadlineHours", label: "Deadline hours", type: "number" }
        ]
      }
    ]
  },
  {
    slug: "subflow",
    name: "Sub-workflow",
    description: "Call another published automation.",
    category: "logic",
    icon: "🧩",
    color: "#7c3aed",
    authType: "none",
    operations: [
      {
        key: "call",
        name: "Call automation",
        type: "action",
        inputFields: [
          { key: "automationId", label: "Automation ID", type: "string", required: true },
          { key: "payload", label: "Input payload JSON", type: "json" }
        ]
      }
    ]
  },
  {
    slug: "tables",
    name: "Tables",
    description: "Workspace database records for automations.",
    category: "data",
    icon: "▦",
    color: "#2563eb",
    authType: "none",
    operations: [
      { key: "new_record", name: "New Record", type: "trigger", triggerMode: "table", inputFields: [{ key: "tableId", label: "Table ID", type: "string", required: true }] },
      { key: "create_record", name: "Create Record", type: "action", inputFields: [{ key: "tableId", label: "Table ID", type: "string", required: true }, { key: "data", label: "Data JSON", type: "json", required: true }] },
      { key: "update_record", name: "Update Record", type: "action", inputFields: [{ key: "tableId", label: "Table ID", type: "string", required: true }, { key: "recordId", label: "Record ID", type: "string", required: true }, { key: "data", label: "Data JSON", type: "json", required: true }] },
      { key: "delete_record", name: "Delete Record", type: "action", inputFields: [{ key: "tableId", label: "Table ID", type: "string", required: true }, { key: "recordId", label: "Record ID", type: "string", required: true }] },
      { key: "find_record", name: "Find Record", type: "search", inputFields: [{ key: "tableId", label: "Table ID", type: "string", required: true }, { key: "query", label: "Contains JSON", type: "json" }] }
    ]
  },
  {
    slug: "forms",
    name: "Forms",
    description: "Public form submissions start automations.",
    category: "data",
    icon: "📝",
    color: "#16a34a",
    authType: "none",
    operations: [
      { key: "submitted", name: "New Submission", type: "trigger", triggerMode: "form", inputFields: [{ key: "formId", label: "Form ID", type: "string" }], outputSample: { email: "ada@example.com" } }
    ]
  },
  {
    slug: "gmail",
    name: "Gmail",
    description: "Email triggers and actions via Google OAuth.",
    category: "communication",
    icon: "✉️",
    color: "#ea4335",
    authType: "oauth2",
    operations: [
      { key: "new_email", name: "New Email", type: "trigger", triggerMode: "polling", inputFields: [{ key: "query", label: "Gmail search", type: "string" }], outputSample: { id: "m1", from: "a@b.com", subject: "Invoice", snippet: "..." } },
      { key: "send_email", name: "Send Email", type: "action", inputFields: [{ key: "to", label: "To", type: "string", required: true }, { key: "subject", label: "Subject", type: "string", required: true }, { key: "body", label: "Body", type: "text", required: true }] }
    ]
  },
  {
    slug: "google-sheets",
    name: "Google Sheets",
    description: "Spreadsheet rows as triggers and actions.",
    category: "productivity",
    icon: "📊",
    color: "#34a853",
    authType: "oauth2",
    operations: [
      { key: "new_row", name: "New or Updated Spreadsheet Row", type: "trigger", triggerMode: "polling", description: "Starts when a row is added or updated.", inputFields: [sheetDrive, sheetId, sheetTab], outputSample: { row: ["Ada", "ada@example.com"] } },
      { key: "create_spreadsheet", name: "Create Spreadsheet", type: "action", description: "Create a new spreadsheet in Drive.", inputFields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "sheet", label: "First sheet name", type: "string" }], outputSample: { spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1" } },
      { key: "read_sheet", name: "Read Sheet Data", type: "search", description: "Read values from a worksheet.", inputFields: [sheetDrive, sheetId, sheetTab], outputSample: { values: [["Name", "Email"]], rows: 1 } },
      { key: "append_row", name: "Append Row", type: "action", description: "Add a row at the bottom of a worksheet.", inputFields: [sheetDrive, sheetId, sheetTab, { key: "values", label: "Values JSON array", type: "json", required: true }], outputSample: { spreadsheetId: "sheet-1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1" } },
      { key: "create_row", name: "Create Row", type: "action", description: "Create a row in a worksheet.", inputFields: [sheetDrive, sheetId, sheetTab, { key: "values", label: "Values JSON array", type: "json", required: true }], outputSample: { spreadsheetId: "sheet-1" } },
      { key: "update_row", name: "Update Row", type: "action", description: "Update cells in an existing row.", inputFields: [sheetDrive, sheetId, sheetTab, { key: "row", label: "Row number (1-based)", type: "number", required: true }, { key: "values", label: "Values JSON array", type: "json", required: true }] },
      { key: "clear_row", name: "Clear Spreadsheet Row(s)", type: "action", description: "Clears the contents of the selected row(s) while keeping the row(s) intact.", inputFields: [sheetDrive, sheetId, sheetTab, { key: "row", label: "Row(s)", type: "string", required: true, placeholder: "Enter text or insert data..." }] },
      { key: "find_row", name: "Find Row", type: "search", description: "Find a row by text.", inputFields: [sheetDrive, sheetId, sheetTab, { key: "query", label: "Search text", type: "string" }] }
    ]
  },
  {
    slug: "google-calendar",
    name: "Google Calendar",
    description: "Events, invites, and scheduling.",
    category: "productivity",
    icon: "📅",
    color: "#4285f4",
    authType: "oauth2",
    operations: [
      { key: "new_event", name: "New Event", type: "trigger", triggerMode: "polling", description: "Starts when a calendar event is created.", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", options: [{ label: "Primary", value: "primary" }] }], outputSample: { id: "evt1", summary: "Standup", start: "2026-01-01T09:00:00Z" } },
      { key: "create_event", name: "Create Event", type: "action", description: "Create an event on a calendar.", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", options: [{ label: "Primary", value: "primary" }] }, { key: "summary", label: "Title", type: "string", required: true }, { key: "start", label: "Start ISO", type: "datetime", required: true }, { key: "end", label: "End ISO", type: "datetime", required: true }] },
      { key: "create_calendar", name: "Create Calendar", type: "action", description: "Create a new calendar.", inputFields: [{ key: "summary", label: "Calendar name", type: "string", required: true }] },
      { key: "add_attendee", name: "Add Attendee(s) to Event", type: "action", description: "Add guests to an existing event.", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", required: true, options: [{ label: "Primary", value: "primary" }] }, { key: "eventId", label: "Event", type: "dynamic", required: true, dependsOn: ["calendarId"] }, { key: "attendees", label: "Attendee/s", type: "string", required: true, placeholder: "Enter text or insert data..." }] },
      { key: "list_events", name: "List Events", type: "search", description: "Find events in a time range.", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", options: [{ label: "Primary", value: "primary" }] }, { key: "maxResults", label: "Max results", type: "number" }, { key: "timeMin", label: "From (ISO)", type: "datetime" }, { key: "timeMax", label: "To (ISO)", type: "datetime" }] },
      { key: "update_event", name: "Update Event", type: "action", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", options: [{ label: "Primary", value: "primary" }] }, { key: "eventId", label: "Event", type: "dynamic", required: true, dependsOn: ["calendarId"] }, { key: "summary", label: "Title", type: "string" }, { key: "start", label: "Start ISO", type: "datetime" }, { key: "end", label: "End ISO", type: "datetime" }] },
      { key: "delete_event", name: "Delete Event", type: "action", inputFields: [{ key: "calendarId", label: "Calendar", type: "dynamic", options: [{ label: "Primary", value: "primary" }] }, { key: "eventId", label: "Event", type: "dynamic", required: true, dependsOn: ["calendarId"] }] }
    ]
  },
  {
    slug: "google-drive",
    name: "Google Drive",
    description: "Files and folders.",
    category: "storage",
    icon: "📁",
    color: "#fbbc04",
    authType: "oauth2",
    operations: [
      { key: "new_file", name: "New File", type: "trigger", triggerMode: "polling", inputFields: [{ key: "folderId", label: "Folder ID", type: "string" }] },
      { key: "upload_file", name: "Upload File", type: "action", inputFields: [{ key: "name", label: "Name", type: "string", required: true }, { key: "content", label: "Text content", type: "text" }] }
    ]
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Channels, messages, and notifications.",
    category: "communication",
    icon: "💬",
    color: "#4a154b",
    authType: "oauth2",
    operations: [
      { key: "new_message", name: "New Message", type: "trigger", triggerMode: "webhook", inputFields: [{ key: "channel", label: "Channel", type: "string" }] },
      { key: "send_message", name: "Send Channel Message", type: "action", inputFields: [{ key: "channel", label: "Channel", type: "string", required: true }, { key: "text", label: "Message", type: "text", required: true }] }
    ]
  },
  {
    slug: "whatsapp",
    name: "WhatsApp Cloud",
    description: "Meta Cloud API messages, templates, and status.",
    category: "communication",
    icon: "🟢",
    color: "#25d366",
    authType: "api_key",
    operations: [
      { key: "inbound_message", name: "New Inbound Message", type: "trigger", triggerMode: "webhook", inputFields: [], outputSample: { from: "1555", text: "hello" } },
      { key: "send_message", name: "Send Message", type: "action", inputFields: [{ key: "to", label: "To (E.164)", type: "string", required: true }, { key: "text", label: "Text", type: "text", required: true }] },
      { key: "send_template", name: "Send Template", type: "action", inputFields: [{ key: "to", label: "To", type: "string", required: true }, { key: "template", label: "Template name", type: "string", required: true }, { key: "language", label: "Language", type: "string" }] }
    ]
  },
  {
    slug: "stripe",
    name: "Stripe",
    description: "Payments, customers, invoices, and subscriptions.",
    category: "payments",
    icon: "💳",
    color: "#635bff",
    authType: "api_key",
    operations: [
      { key: "new_payment", name: "New Payment", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "create_customer", name: "Create Customer", type: "action", inputFields: [{ key: "email", label: "Email", type: "string", required: true }, { key: "name", label: "Name", type: "string" }] }
    ]
  },
  {
    slug: "openai",
    name: "OpenAI",
    description: "Summarize, extract, classify, generate.",
    category: "ai",
    icon: "✦",
    color: "#10a37f",
    authType: "api_key",
    operations: [
      { key: "complete", name: "Custom prompt", type: "action", inputFields: [{ key: "prompt", label: "Prompt", type: "text", required: true }, { key: "model", label: "Model", type: "string" }, { key: "json", label: "JSON mode", type: "boolean" }] },
      { key: "extract", name: "Extract", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }, { key: "schema", label: "Fields to extract", type: "text", required: true }] },
      { key: "summarize", name: "Summarize", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }] },
      { key: "classify", name: "Classify", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }, { key: "labels", label: "Labels (comma-separated)", type: "string", required: true }] },
      { key: "write", name: "Write", type: "action", inputFields: [{ key: "prompt", label: "What to write", type: "text", required: true }, { key: "tone", label: "Tone", type: "string" }] },
      { key: "translate", name: "Translate", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }, { key: "targetLanguage", label: "Target language", type: "string", required: true }] },
      { key: "analyze", name: "Analyze", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }] },
      { key: "transcribe", name: "Transcribe", type: "action", inputFields: [{ key: "audioUrl", label: "Audio URL", type: "string", required: true }] },
      { key: "search", name: "Search", type: "action", inputFields: [{ key: "query", label: "Query", type: "string", required: true }, { key: "context", label: "Context", type: "text" }] }
    ]
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    description: "Claude models.",
    category: "ai",
    icon: "✻",
    color: "#d97706",
    authType: "api_key",
    operations: [
      { key: "complete", name: "Message", type: "action", inputFields: [{ key: "prompt", label: "Prompt", type: "text", required: true }, { key: "model", label: "Model", type: "string" }] }
    ]
  },
  {
    slug: "gemini",
    name: "Google Gemini",
    description: "Gemini models.",
    category: "ai",
    icon: "✦",
    color: "#4285f4",
    authType: "api_key",
    operations: [
      { key: "complete", name: "Generate", type: "action", inputFields: [{ key: "prompt", label: "Prompt", type: "text", required: true }] }
    ]
  },
  {
    slug: "hubspot",
    name: "HubSpot",
    description: "CRM contacts, deals, companies, and tickets.",
    category: "crm",
    icon: "🧡",
    color: "#ff7a59",
    authType: "oauth2",
    operations: [
      { key: "new_contact", name: "New Contact", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_contact", name: "Create Contact", type: "action", inputFields: [{ key: "email", label: "Email", type: "string", required: true }, { key: "firstname", label: "First name", type: "string" }, { key: "lastname", label: "Last name", type: "string" }, { key: "phone", label: "Phone", type: "string" }, { key: "company", label: "Company", type: "string" }] },
      { key: "list_contacts", name: "List Contacts", type: "action", inputFields: [{ key: "limit", label: "Limit", type: "number" }], outputSample: { results: [{ id: "123", properties: { email: "ada@example.com", firstname: "Ada" } }] } },
      { key: "search_contacts", name: "Search Contacts", type: "action", inputFields: [{ key: "query", label: "Search query", type: "string", required: true }] },
      { key: "new_deal", name: "New Deal", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_deal", name: "Create Deal", type: "action", inputFields: [{ key: "dealname", label: "Deal name", type: "string", required: true }, { key: "amount", label: "Amount", type: "number" }, { key: "dealstage", label: "Stage", type: "dynamic" }, { key: "pipeline", label: "Pipeline", type: "string" }] },
      { key: "update_deal", name: "Update Deal", type: "action", inputFields: [{ key: "dealId", label: "Deal", type: "dynamic", required: true }, { key: "dealname", label: "Deal name", type: "string" }, { key: "amount", label: "Amount", type: "number" }, { key: "dealstage", label: "Stage", type: "dynamic" }] },
      { key: "new_company", name: "New Company", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_company", name: "Create Company", type: "action", inputFields: [{ key: "name", label: "Company name", type: "string", required: true }, { key: "domain", label: "Domain", type: "string" }, { key: "industry", label: "Industry", type: "string" }] },
      { key: "new_ticket", name: "New Ticket", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_ticket", name: "Create Ticket", type: "action", inputFields: [{ key: "subject", label: "Subject", type: "string", required: true }, { key: "content", label: "Content", type: "text" }, { key: "pipeline", label: "Pipeline", type: "dynamic" }, { key: "priority", label: "Priority", type: "dynamic" }] }
    ]
  },
  {
    slug: "salesforce",
    name: "Salesforce",
    description: "Leads, opportunities, and objects.",
    category: "crm",
    icon: "☁️",
    color: "#00a1e0",
    authType: "oauth2",
    operations: [
      { key: "new_lead", name: "New Lead", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_lead", name: "Create Lead", type: "action", inputFields: [{ key: "lastName", label: "Last name", type: "string", required: true }, { key: "company", label: "Company", type: "string", required: true }, { key: "email", label: "Email", type: "string" }] }
    ]
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Pages and databases.",
    category: "productivity",
    icon: "📓",
    color: "#111111",
    authType: "oauth2",
    operations: [{ key: "create_page", name: "Create Page", type: "action", inputFields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "content", label: "Content", type: "text" }] }]
  },
  {
    slug: "airtable",
    name: "Airtable",
    description: "Bases and records.",
    category: "data",
    icon: "🟨",
    color: "#18bfff",
    authType: "api_key",
    operations: [{ key: "create_record", name: "Create Record", type: "action", inputFields: [{ key: "baseId", label: "Base ID", type: "string", required: true }, { key: "table", label: "Table", type: "string", required: true }, { key: "fields", label: "Fields JSON", type: "json", required: true }] }]
  },
  {
    slug: "github",
    name: "GitHub",
    description: "Issues, PRs, repos, and comments.",
    category: "developer",
    icon: "🐙",
    color: "#24292f",
    authType: "oauth2",
    operations: [
      { key: "new_issue", name: "New Issue", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "push_event", name: "Push", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "pull_request_event", name: "Pull Request", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "issues_event", name: "Issues Event", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "create_issue", name: "Create Issue", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "title", label: "Title", type: "string", required: true }, { key: "body", label: "Body", type: "text" }, { key: "labels", label: "Labels (comma-separated)", type: "string" }, { key: "assignees", label: "Assignees (comma-separated)", type: "string" }] },
      { key: "update_issue", name: "Update Issue", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "issueNumber", label: "Issue number", type: "dynamic", required: true }, { key: "title", label: "Title", type: "string" }, { key: "body", label: "Body", type: "text" }, { key: "state", label: "State", type: "select", options: [{ label: "Open", value: "open" }, { label: "Closed", value: "closed" }] }] },
      { key: "close_issue", name: "Close Issue", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "issueNumber", label: "Issue number", type: "dynamic", required: true }] },
      { key: "create_pr", name: "Create Pull Request", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "title", label: "Title", type: "string", required: true }, { key: "head", label: "Head branch", type: "string", required: true }, { key: "base", label: "Base branch", type: "string" }, { key: "body", label: "Body", type: "text" }] },
      { key: "merge_pr", name: "Merge PR", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "prNumber", label: "PR number", type: "dynamic", required: true }, { key: "mergeMethod", label: "Merge method", type: "select", options: [{ label: "Merge", value: "merge" }, { label: "Squash", value: "squash" }, { label: "Rebase", value: "rebase" }] }] },
      { key: "add_comment", name: "Add Comment", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }, { key: "issueNumber", label: "Issue/PR number", type: "dynamic", required: true }, { key: "body", label: "Comment", type: "text", required: true }] },
      { key: "list_repos", name: "List Repositories", type: "action", inputFields: [{ key: "sort", label: "Sort by", type: "select", options: [{ label: "Recently updated", value: "updated" }, { label: "Recently created", value: "created" }, { label: "Recently pushed", value: "pushed" }, { label: "Name", value: "full_name" }] }, { key: "type", label: "Type", type: "select", options: [{ label: "Owner", value: "owner" }, { label: "All", value: "all" }, { label: "Public", value: "public" }, { label: "Private", value: "private" }] }, { key: "limit", label: "Limit", type: "number" }], outputSample: { repos: [{ full_name: "user/repo", description: "A repo", private: false }], total: 1 } },
      { key: "get_repo", name: "Get Repository", type: "action", inputFields: [{ key: "repo", label: "Repository", type: "dynamic", required: true }] }
    ]
  },
  {
    slug: "discord",
    name: "Discord",
    description: "Channel messages.",
    category: "communication",
    icon: "🎮",
    color: "#5865f2",
    authType: "api_key",
    operations: [{ key: "send_message", name: "Send Message", type: "action", inputFields: [{ key: "webhookUrl", label: "Webhook URL", type: "string", required: true }, { key: "content", label: "Content", type: "text", required: true }] }]
  },
  {
    slug: "telegram",
    name: "Telegram",
    description: "Bot messages.",
    category: "communication",
    icon: "✈️",
    color: "#229ed9",
    authType: "api_key",
    operations: [{ key: "send_message", name: "Send Message", type: "action", inputFields: [{ key: "chatId", label: "Chat ID", type: "string", required: true }, { key: "text", label: "Text", type: "text", required: true }] }]
  },
  {
    slug: "twilio",
    name: "Twilio",
    description: "SMS and voice.",
    category: "communication",
    icon: "📱",
    color: "#f22f46",
    authType: "basic",
    operations: [{ key: "send_sms", name: "Send SMS", type: "action", inputFields: [{ key: "to", label: "To", type: "string", required: true }, { key: "from", label: "From", type: "string", required: true }, { key: "body", label: "Body", type: "text", required: true }] }]
  },
  {
    slug: "calendly",
    name: "Calendly",
    description: "Scheduled events.",
    category: "productivity",
    icon: "🗓️",
    color: "#006bff",
    authType: "oauth2",
    operations: [{ key: "invitee_created", name: "Invitee Created", type: "trigger", triggerMode: "webhook", inputFields: [] }]
  },
  {
    slug: "jira",
    name: "Jira",
    description: "Issues and projects.",
    category: "developer",
    icon: "🟦",
    color: "#0052cc",
    authType: "basic",
    operations: [{ key: "create_issue", name: "Create Issue", type: "action", inputFields: [{ key: "project", label: "Project key", type: "string", required: true }, { key: "summary", label: "Summary", type: "string", required: true }] }]
  },
  {
    slug: "linear",
    name: "Linear",
    description: "Issues and projects.",
    category: "developer",
    icon: "⬡",
    color: "#5e6ad2",
    authType: "api_key",
    operations: [{ key: "create_issue", name: "Create Issue", type: "action", inputFields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "teamId", label: "Team ID", type: "string" }] }]
  },
  {
    slug: "digest",
    name: "Digest",
    description: "Batch trigger data and release on a schedule.",
    category: "logic",
    icon: "📬",
    color: "#0f766e",
    authType: "none",
    operations: [
      {
        key: "add",
        name: "Add to Digest",
        type: "action",
        inputFields: [
          { key: "digestKey", label: "Digest key", type: "string", required: true },
          { key: "item", label: "Item JSON", type: "json", required: true }
        ]
      },
      {
        key: "release",
        name: "Release Digest",
        type: "action",
        inputFields: [{ key: "digestKey", label: "Digest key", type: "string", required: true }]
      }
    ]
  },
  {
    slug: "storage",
    name: "Storage",
    description: "Key-value store shared across automations in the workspace.",
    category: "logic",
    icon: "🗄️",
    color: "#57534e",
    authType: "none",
    operations: [
      { key: "set", name: "Set Value", type: "action", inputFields: [{ key: "key", label: "Key", type: "string", required: true }, { key: "value", label: "Value", type: "text", required: true }] },
      { key: "get", name: "Get Value", type: "action", inputFields: [{ key: "key", label: "Key", type: "string", required: true }] }
    ]
  },
  {
    slug: "email",
    name: "Email",
    description: "Send email from the platform (SMTP or provider key).",
    category: "communication",
    icon: "📧",
    color: "#b45309",
    authType: "api_key",
    operations: [
      {
        key: "send",
        name: "Send Email",
        type: "action",
        inputFields: [
          { key: "to", label: "To", type: "string", required: true },
          { key: "from", label: "From", type: "string" },
          { key: "subject", label: "Subject", type: "string", required: true },
          { key: "body", label: "Body", type: "text", required: true }
        ]
      }
    ]
  },
  {
    slug: "manager",
    name: "Automation Manager",
    description: "Meta triggers on this workspace: run status, task usage.",
    category: "core",
    icon: "🛠",
    color: "#334155",
    authType: "none",
    operations: [
      { key: "run_ended", name: "Run Ended", type: "trigger", triggerMode: "webhook", inputFields: [], outputSample: { status: "failed", automationId: "" } },
      { key: "turn_off", name: "Turn Automation Off", type: "action", inputFields: [{ key: "automationId", label: "Automation ID", type: "string", required: true }] }
    ]
  },
  {
    slug: "email-parser",
    name: "Email Parser",
    description: "Extract fields from inbound email using a mailbox address.",
    category: "communication",
    icon: "📥",
    color: "#7c3aed",
    authType: "none",
    operations: [
      {
        key: "new_email",
        name: "New Parsed Email",
        type: "trigger",
        triggerMode: "webhook",
        inputFields: [{ key: "mailbox", label: "Parser mailbox", type: "string" }],
        outputSample: { from: "a@b.com", subject: "Order 12", body: "..." }
      },
      {
        key: "parse",
        name: "Parse Text",
        type: "action",
        inputFields: [
          { key: "text", label: "Email body", type: "text", required: true },
          { key: "pattern", label: "Capture regex", type: "string" }
        ]
      }
    ]
  },
  {
    slug: "transfer",
    name: "Transfer",
    description: "Bulk copy historical records between apps (backfill).",
    category: "logic",
    icon: "📦",
    color: "#0f766e",
    authType: "none",
    operations: [
      {
        key: "run",
        name: "Run Transfer",
        type: "action",
        inputFields: [
          { key: "source", label: "Source description", type: "string", required: true },
          { key: "destination", label: "Destination description", type: "string", required: true }
        ]
      }
    ]
  },
  {
    slug: "ai",
    name: "AI",
    description: "Platform AI actions: summarize, classify, extract, draft. Uses a connected model key or the workspace key.",
    category: "ai",
    icon: "✦",
    color: "#7c3aed",
    authType: "api_key",
    operations: [
      { key: "summarize", name: "Summarize", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }] },
      { key: "classify", name: "Classify", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }, { key: "labels", label: "Labels", type: "string", required: true }] },
      { key: "extract", name: "Extract", type: "action", inputFields: [{ key: "text", label: "Text", type: "text", required: true }, { key: "schema", label: "Fields to extract", type: "text", required: true }] },
      { key: "draft", name: "Draft", type: "action", inputFields: [{ key: "prompt", label: "What to write", type: "text", required: true }, { key: "tone", label: "Tone", type: "string" }] },
      { key: "complete", name: "Prompt", type: "action", inputFields: [{ key: "prompt", label: "Prompt", type: "text", required: true }] }
    ]
  },
  {
    slug: "ai-guardrails",
    name: "AI Guardrails",
    description: "Screen AI output before it continues downstream.",
    category: "ai",
    icon: "🛡",
    color: "#b45309",
    authType: "none",
    operations: [
      {
        key: "screen",
        name: "Screen Output",
        type: "action",
        inputFields: [
          { key: "text", label: "Text to screen", type: "text", required: true },
          { key: "policy", label: "Policy notes", type: "text" }
        ]
      }
    ]
  },
  {
    slug: "trello",
    name: "Trello",
    description: "Boards, lists, and cards.",
    category: "productivity",
    icon: "📋",
    color: "#0079bf",
    authType: "api_key",
    operations: [
      { key: "new_card", name: "New Card", type: "trigger", triggerMode: "webhook", inputFields: [{ key: "board", label: "Board ID", type: "string" }] },
      { key: "create_card", name: "Create Card", type: "action", inputFields: [{ key: "listId", label: "List ID", type: "string", required: true }, { key: "name", label: "Name", type: "string", required: true }] }
    ]
  },
  {
    slug: "shopify",
    name: "Shopify",
    description: "Orders and customers.",
    category: "commerce",
    icon: "🛍",
    color: "#96bf48",
    authType: "api_key",
    operations: [
      { key: "new_order", name: "New Order", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "create_customer", name: "Create Customer", type: "action", inputFields: [{ key: "email", label: "Email", type: "string", required: true }] }
    ]  },
  {
    slug: "typeform",
    name: "Typeform",
    description: "Form entries and submissions.",
    category: "forms",
    icon: "📄",
    color: "#262627",
    authType: "oauth2",
    operations: [
      { key: "new_entry", name: "New Entry", type: "trigger", triggerMode: "webhook", inputFields: [{ key: "formId", label: "Form ID", type: "string" }] },
      { key: "new_submission", name: "New Submission", type: "trigger", triggerMode: "polling", inputFields: [{ key: "formId", label: "Form ID", type: "dynamic", required: true, help: "Pick a form to watch for new submissions." }] },
      { key: "list_forms", name: "List Forms", type: "action", inputFields: [], outputSample: { forms: [{ id: "abc", title: "Contact Form" }], total: 1 } },
      { key: "get_form", name: "Get Form", type: "action", inputFields: [{ key: "formId", label: "Form ID", type: "dynamic", required: true }] },
      { key: "get_responses", name: "Get Responses", type: "action", inputFields: [{ key: "formId", label: "Form ID", type: "dynamic", required: true }, { key: "pageSize", label: "Limit", type: "number" }], outputSample: { responses: [{ responseId: "r1", submittedAt: "2024-01-01T00:00:00Z", answers: {} }], total: 1, hasMore: false } },
      { key: "create_form", name: "Create Form", type: "action", inputFields: [{ key: "title", label: "Title", type: "string", required: true }] }
    ]
  },
  {
    slug: "microsoft-teams",
    name: "Microsoft Teams",
    description: "Channel messages.",
    category: "communication",
    icon: "👥",
    color: "#6264a7",
    authType: "oauth2",
    operations: [
      { key: "new_message", name: "New Channel Message", type: "trigger", triggerMode: "webhook", inputFields: [] },
      { key: "send_message", name: "Send Channel Message", type: "action", inputFields: [{ key: "webhookUrl", label: "Incoming webhook URL", type: "string", required: true }, { key: "text", label: "Text", type: "text", required: true }] }
    ]
  },
  {
    slug: "zendesk",
    name: "Zendesk",
    description: "Tickets.",
    category: "support",
    icon: "🎫",
    color: "#03363d",
    authType: "basic",
    operations: [
      { key: "new_ticket", name: "New Ticket", type: "trigger", triggerMode: "polling", inputFields: [] },
      { key: "create_ticket", name: "Create Ticket", type: "action", inputFields: [{ key: "subject", label: "Subject", type: "string", required: true }, { key: "comment", label: "Comment", type: "text" }] }
    ]
  },
  {
    slug: "agents",
    name: "Agents",
    description: "Build intelligent assistants to handle day-to-day tasks.",
    category: "ai",
    icon: "🤖",
    color: "#7c3aed",
    authType: "none",
    operations: [
      { key: "run", name: "Run Agent", type: "action", inputFields: [{ key: "instructions", label: "Instructions", type: "text", required: true }, { key: "input", label: "Input", type: "text" }] }
    ]
  },
  {
    slug: "chatbots",
    name: "Chatbots",
    description: "Build AI-powered chatbots.",
    category: "ai",
    icon: "💬",
    color: "#2563eb",
    authType: "none",
    operations: [
      { key: "message", name: "Send Chatbot Message", type: "action", inputFields: [{ key: "message", label: "Message", type: "text", required: true }] }
    ]
  }
];

const msg = { key: "message", label: "Message", type: "text" as const, required: true };
const channel = { key: "channel", label: "Channel / ID", type: "string" as const, required: true };

const MORE_APPS: AppManifest[] = [
  piece("asana", "Asana", "productivity", "oauth2", [
    op("new_task", "New Task", "trigger"),
    op("create_task", "Create Task", "action", [channel, { key: "name", label: "Task name", type: "string", required: true }])
  ]),
  piece("clickup", "ClickUp", "productivity", "oauth2", [
    op("new_task", "New Task", "trigger"),
    op("create_task", "Create Task", "action", [{ key: "name", label: "Name", type: "string", required: true }])
  ]),
  piece("monday", "monday.com", "productivity", "oauth2", [
    op("new_item", "New Item", "trigger"),
    op("create_item", "Create Item", "action", [{ key: "name", label: "Item name", type: "string", required: true }])
  ]),
  piece("dropbox", "Dropbox", "files", "oauth2", [
    op("new_file", "New File", "trigger"),
    op("upload_file", "Upload File", "action", [{ key: "path", label: "Path", type: "string", required: true }])
  ]),
  piece("box", "Box", "files", "oauth2", [
    op("new_file", "New File", "trigger"),
    op("upload_file", "Upload File", "action")
  ]),
  piece("zoom", "Zoom", "communication", "oauth2", [
    op("new_meeting", "New Meeting", "trigger"),
    op("create_meeting", "Create Meeting", "action", [{ key: "topic", label: "Topic", type: "string", required: true }])
  ]),
  piece("mailchimp", "Mailchimp", "marketing", "oauth2", [
    op("new_subscriber", "New Subscriber", "trigger"),
    op("add_subscriber", "Add Subscriber", "action", [{ key: "email", label: "Email", type: "string", required: true }])
  ]),
  piece("intercom", "Intercom", "support", "oauth2", [
    op("new_conversation", "New Conversation", "trigger"),
    op("send_message", "Send Message", "action", [msg])
  ]),
  piece("pipedrive", "Pipedrive", "crm", "oauth2", [
    op("new_deal", "New Deal", "trigger"),
    op("create_deal", "Create Deal", "action", [{ key: "title", label: "Title", type: "string", required: true }])
  ]),
  piece("linkedin", "LinkedIn", "social", "oauth2", [
    op("new_post", "New Post", "trigger"),
    op("create_post", "Create Post", "action", [msg])
  ]),
  piece("facebook", "Facebook Pages", "social", "oauth2", [
    op("new_post", "New Page Post", "trigger"),
    op("create_post", "Create Page Post", "action", [msg])
  ]),
  piece("instagram", "Instagram", "social", "oauth2", [
    op("new_media", "New Media", "trigger"),
    op("publish_photo", "Publish Photo", "action")
  ]),
  piece("youtube", "YouTube", "social", "oauth2", [
    op("new_video", "New Video", "trigger"),
    op("upload_video", "Upload Video", "action")
  ]),
  piece("twitter", "X (Twitter)", "social", "oauth2", [
    op("new_mention", "New Mention", "trigger"),
    op("post_tweet", "Post Tweet", "action", [msg])
  ]),
  piece("reddit", "Reddit", "social", "oauth2", [
    op("new_post", "New Post in Subreddit", "trigger"),
    op("submit_post", "Submit Post", "action")
  ]),
  piece("spotify", "Spotify", "media", "oauth2", [
    op("new_saved_track", "New Saved Track", "trigger"),
    op("add_to_playlist", "Add to Playlist", "action")
  ]),
  piece("paypal", "PayPal", "finance", "oauth2", [
    op("new_sale", "New Sale", "trigger"),
    op("send_payout", "Send Payout", "action")
  ]),
  piece("quickbooks", "QuickBooks", "finance", "oauth2", [
    op("new_invoice", "New Invoice", "trigger"),
    op("create_invoice", "Create Invoice", "action")
  ]),
  piece("outlook", "Outlook", "communication", "oauth2", [
    op("new_email", "New Email", "trigger"),
    op("send_email", "Send Email", "action", [{ key: "to", label: "To", type: "string", required: true }, { key: "subject", label: "Subject", type: "string" }, { key: "body", label: "Body", type: "text" }])
  ]),
  piece("sendgrid", "SendGrid", "communication", "api_key", [
    op("send_email", "Send Email", "action", [{ key: "to", label: "To", type: "string", required: true }, { key: "subject", label: "Subject", type: "string", required: true }])
  ])
];

for (const extra of [...MORE_APPS, ...DIRECTORY_APPS]) {
  if (!APP_CATALOG.some((a) => a.slug === extra.slug)) APP_CATALOG.push(extra);
}

function op(
  key: string,
  name: string,
  type: "trigger" | "action" | "search",
  inputFields: AppManifest["operations"][number]["inputFields"] = []
): AppManifest["operations"][number] {
  return { key, name, type, inputFields, outputSample: { id: "sample", ok: true } };
}

function piece(
  slug: string,
  name: string,
  category: string,
  authType: string,
  operations: AppManifest["operations"]
): AppManifest {
  return { slug, name, description: `${name} triggers and actions.`, category, icon: "🔌", color: "#4f46e5", authType, operations };
}

export function presentCatalogApp(a: AppManifest) {
  return {
    slug: a.slug,
    name: a.name,
    description: a.description,
    category: a.category,
    icon: a.icon,
    color: a.color,
    authType: a.authType ?? "none",
    operations: (a.operations ?? []).map((op) => ({
      key: String(op.key ?? (op as { operation_id?: string }).operation_id ?? ""),
      name: op.name,
      type: (op.type ?? (op as { kind?: string }).kind ?? "action") as "trigger" | "action" | "search",
      description: op.description,
      triggerMode: op.triggerMode,
      inputFields: op.inputFields ?? [],
      outputSample: op.outputSample ?? {}
    }))
  };
}

export function listCatalogApps(q?: string) {
  const term = (q ?? "").trim().toLowerCase();
  const apps = APP_CATALOG.map(presentCatalogApp);
  if (!term) return apps;
  return apps.filter((a) => `${a.slug} ${a.name} ${a.description} ${a.operations.map((o) => o.name).join(" ")}`.toLowerCase().includes(term));
}

export function getApp(slug: string) {
  return APP_CATALOG.find((a) => a.slug === slug) ?? null;
}

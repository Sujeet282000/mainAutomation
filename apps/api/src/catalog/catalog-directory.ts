import type { AppManifest } from "@algoverge/shared";

const msg = { key: "message", label: "Message", type: "text" as const, required: true };
const name = { key: "name", label: "Name", type: "string" as const, required: true };
const email = { key: "email", label: "Email", type: "string" as const, required: true };
const title = { key: "title", label: "Title", type: "string" as const, required: true };
const idField = { key: "id", label: "Record ID", type: "string" as const, required: true };

function op(
  key: string,
  opName: string,
  type: "trigger" | "action" | "search",
  inputFields: AppManifest["operations"][number]["inputFields"] = [],
  triggerMode?: AppManifest["operations"][number]["triggerMode"]
): AppManifest["operations"][number] {
  return {
    key,
    name: opName,
    type,
    triggerMode: type === "trigger" ? triggerMode ?? "polling" : undefined,
    inputFields,
    outputSample: { id: "sample", ok: true }
  };
}

function piece(
  slug: string,
  display: string,
  category: string,
  authType: string,
  operations: AppManifest["operations"],
  extras?: Partial<AppManifest>
): AppManifest {
  return {
    slug,
    name: display,
    description: `${display} triggers and actions.`,
    category,
    icon: extras?.icon ?? "🔌",
    color: extras?.color ?? "#4f46e5",
    authType,
    operations
  };
}

function pair(
  slug: string,
  display: string,
  category: string,
  authType: string,
  trigger: [string, string],
  action: [string, string],
  actionFields: AppManifest["operations"][number]["inputFields"] = [title]
): AppManifest {
  return piece(slug, display, category, authType, [
    op(trigger[0], trigger[1], "trigger"),
    op(action[0], action[1], "action", actionFields)
  ]);
}

/** Spec foundation §7 — 33-category seed beyond the first-party catalog. */
export const DIRECTORY_APPS: AppManifest[] = [
  pair("zoho-crm", "Zoho CRM", "crm", "oauth2", ["new_contact", "New Contact"], ["create_contact", "Create Contact"], [email]),
  pair("close", "Close", "crm", "api_key", ["new_lead", "New Lead"], ["create_lead", "Create Lead"], [email, name]),
  pair("copper", "Copper", "crm", "oauth2", ["new_person", "New Person"], ["create_person", "Create Person"], [email]),
  pair("freshsales", "Freshsales", "crm", "api_key", ["new_contact", "New Contact"], ["create_contact", "Create Contact"], [email]),
  pair("keap", "Keap", "crm", "oauth2", ["new_contact", "New Contact"], ["create_contact", "Create Contact"], [email]),
  pair("activecampaign", "ActiveCampaign", "marketing", "api_key", ["new_subscriber", "New Subscriber"], ["add_subscriber", "Add Subscriber"], [email]),
  pair("klaviyo", "Klaviyo", "marketing", "api_key", ["new_profile", "New Profile"], ["add_profile", "Add Profile"], [email]),
  pair("brevo", "Brevo", "marketing", "api_key", ["new_contact", "New Contact"], ["add_contact", "Add Contact"], [email]),
  pair("convertkit", "ConvertKit", "marketing", "api_key", ["new_subscriber", "New Subscriber"], ["add_subscriber", "Add Subscriber"], [email]),
  pair("mailerlite", "MailerLite", "marketing", "api_key", ["new_subscriber", "New Subscriber"], ["add_subscriber", "Add Subscriber"], [email]),
  pair("google-chat", "Google Chat", "communication", "oauth2", ["new_message", "New Message"], ["send_message", "Send Message"], [msg]),
  pair("mattermost", "Mattermost", "communication", "api_key", ["new_message", "New Message"], ["send_message", "Send Message"], [msg]),
  pair("google-meet", "Google Meet", "communication", "oauth2", ["new_meeting", "New Meeting"], ["create_meeting", "Create Meeting"], [title]),
  pair("webex", "Webex", "communication", "oauth2", ["new_meeting", "New Meeting"], ["create_meeting", "Create Meeting"], [title]),
  pair("gotomeeting", "GoToMeeting", "communication", "oauth2", ["new_meeting", "New Meeting"], ["create_meeting", "Create Meeting"], [title]),
  pair("basecamp", "Basecamp", "productivity", "oauth2", ["new_todo", "New To-do"], ["create_todo", "Create To-do"], [title]),
  pair("wrike", "Wrike", "productivity", "oauth2", ["new_task", "New Task"], ["create_task", "Create Task"], [title]),
  pair("smartsheet", "Smartsheet", "productivity", "oauth2", ["new_row", "New Row"], ["add_row", "Add Row"], [{ key: "sheetId", label: "Sheet ID", type: "string", required: true }]),
  pair("todoist", "Todoist", "productivity", "oauth2", ["new_task", "New Task"], ["create_task", "Create Task"], [title]),
  pair("miro", "Miro", "productivity", "oauth2", ["new_board", "New Board"], ["create_item", "Create Item"], [title]),
  pair("woocommerce", "WooCommerce", "commerce", "basic", ["new_order", "New Order"], ["create_order", "Create Order"], [email]),
  pair("bigcommerce", "BigCommerce", "commerce", "api_key", ["new_order", "New Order"], ["create_customer", "Create Customer"], [email]),
  pair("etsy", "Etsy", "commerce", "oauth2", ["new_order", "New Order"], ["update_listing", "Update Listing"], [idField]),
  pair("square", "Square", "payments", "oauth2", ["new_payment", "New Payment"], ["create_payment", "Create Payment"], [{ key: "amount", label: "Amount", type: "number", required: true }]),
  pair("chargebee", "Chargebee", "payments", "api_key", ["new_subscription", "New Subscription"], ["create_customer", "Create Customer"], [email]),
  pair("razorpay", "Razorpay", "payments", "api_key", ["new_payment", "New Payment"], ["create_payment_link", "Create Payment Link"], [{ key: "amount", label: "Amount", type: "number", required: true }]),
  pair("xero", "Xero", "finance", "oauth2", ["new_invoice", "New Invoice"], ["create_invoice", "Create Invoice"], [title]),
  pair("freshbooks", "FreshBooks", "finance", "oauth2", ["new_invoice", "New Invoice"], ["create_invoice", "Create Invoice"], [title]),
  pair("expensify", "Expensify", "finance", "oauth2", ["new_expense", "New Expense"], ["create_expense", "Create Expense"], [{ key: "amount", label: "Amount", type: "number", required: true }]),
  pair("google-docs", "Google Docs", "productivity", "oauth2", ["new_document", "New Document"], ["create_document", "Create Document"], [title]),
  pair("google-slides", "Google Slides", "productivity", "oauth2", ["new_presentation", "New Presentation"], ["create_presentation", "Create Presentation"], [title]),
  pair("microsoft-excel", "Microsoft Excel 365", "productivity", "oauth2", ["new_row", "New Row"], ["add_row", "Add Row"], [{ key: "workbook", label: "Workbook", type: "string", required: true }]),
  pair("coda", "Coda", "productivity", "api_key", ["new_row", "New Row"], ["upsert_row", "Upsert Row"], [{ key: "docId", label: "Doc ID", type: "string", required: true }]),
  pair("confluence", "Confluence", "productivity", "oauth2", ["new_page", "New Page"], ["create_page", "Create Page"], [title]),
  pair("onedrive", "OneDrive", "storage", "oauth2", ["new_file", "New File"], ["upload_file", "Upload File"], [name]),
  pair("sharepoint", "SharePoint", "storage", "oauth2", ["new_file", "New File"], ["upload_file", "Upload File"], [name]),
  pair("amazon-s3", "Amazon S3", "storage", "custom", ["new_object", "New Object"], ["upload_object", "Upload Object"], [{ key: "bucket", label: "Bucket", type: "string", required: true }, { key: "key", label: "Key", type: "string", required: true }]),
  pair("google-forms", "Google Forms", "forms", "oauth2", ["new_response", "New Response"], ["create_form", "Create Form"], [title]),
  pair("jotform", "Jotform", "forms", "api_key", ["new_submission", "New Submission"], ["create_form", "Create Form"], [title]),
  pair("surveymonkey", "SurveyMonkey", "forms", "oauth2", ["new_response", "New Response"], ["create_collector", "Create Collector"], [title]),
  pair("tally", "Tally", "forms", "api_key", ["new_submission", "New Submission"], ["list_forms", "List Forms"], []),
  pair("freshdesk", "Freshdesk", "support", "api_key", ["new_ticket", "New Ticket"], ["create_ticket", "Create Ticket"], [title]),
  pair("helpscout", "Help Scout", "support", "oauth2", ["new_conversation", "New Conversation"], ["create_conversation", "Create Conversation"], [title, msg]),
  pair("front", "Front", "support", "oauth2", ["new_message", "New Message"], ["send_message", "Send Message"], [msg]),
  pair("gorgias", "Gorgias", "support", "api_key", ["new_ticket", "New Ticket"], ["create_ticket", "Create Ticket"], [title]),
  pair("crisp", "Crisp", "support", "api_key", ["new_message", "New Message"], ["send_message", "Send Message"], [msg]),
  pair("bamboohr", "BambooHR", "hr", "api_key", ["new_employee", "New Employee"], ["create_employee", "Create Employee"], [name, email]),
  pair("greenhouse", "Greenhouse", "hr", "api_key", ["new_candidate", "New Candidate"], ["create_candidate", "Create Candidate"], [name, email]),
  pair("lever", "Lever", "hr", "oauth2", ["new_candidate", "New Candidate"], ["create_candidate", "Create Candidate"], [name, email]),
  pair("gusto", "Gusto", "hr", "oauth2", ["new_employee", "New Employee"], ["create_employee", "Create Employee"], [name]),
  pair("workable", "Workable", "hr", "api_key", ["new_candidate", "New Candidate"], ["create_candidate", "Create Candidate"], [name, email]),
  piece("postgresql", "PostgreSQL", "databases", "custom", [
    op("new_row", "New Row", "trigger", [{ key: "query", label: "Watch query", type: "text" }]),
    op("run_query", "Run Query", "action", [{ key: "sql", label: "SQL", type: "text", required: true }])
  ]),
  piece("mysql", "MySQL", "databases", "custom", [
    op("new_row", "New Row", "trigger", [{ key: "table", label: "Table", type: "string", required: true }]),
    op("insert_row", "Insert Row", "action", [{ key: "table", label: "Table", type: "string", required: true }, { key: "values", label: "Values JSON", type: "json", required: true }])
  ]),
  pair("mongodb", "MongoDB", "databases", "custom", ["new_document", "New Document"], ["insert_document", "Insert Document"], [{ key: "collection", label: "Collection", type: "string", required: true }]),
  pair("supabase", "Supabase", "databases", "api_key", ["new_row", "New Row"], ["insert_row", "Insert Row"], [{ key: "table", label: "Table", type: "string", required: true }]),
  pair("firebase", "Firebase", "databases", "custom", ["new_document", "New Document"], ["set_document", "Set Document"], [{ key: "path", label: "Path", type: "string", required: true }]),
  pair("snowflake", "Snowflake", "databases", "custom", ["new_row", "New Row"], ["run_query", "Run Query"], [{ key: "sql", label: "SQL", type: "text", required: true }]),
  pair("bigquery", "BigQuery", "databases", "oauth2", ["new_row", "New Row"], ["run_query", "Run Query"], [{ key: "sql", label: "SQL", type: "text", required: true }]),
  pair("gitlab", "GitLab", "developer", "oauth2", ["new_issue", "New Issue"], ["create_issue", "Create Issue"], [title]),
  pair("bitbucket", "Bitbucket", "developer", "oauth2", ["new_commit", "New Commit"], ["create_issue", "Create Issue"], [title]),
  pair("vercel", "Vercel", "developer", "api_key", ["deployment", "New Deployment"], ["create_deployment", "Create Deployment"], [{ key: "project", label: "Project", type: "string", required: true }]),
  pair("netlify", "Netlify", "developer", "oauth2", ["deploy", "New Deploy"], ["trigger_build", "Trigger Build"], [{ key: "siteId", label: "Site ID", type: "string", required: true }]),
  pair("pagerduty", "PagerDuty", "developer", "api_key", ["new_incident", "New Incident"], ["create_incident", "Create Incident"], [title]),
  pair("sentry", "Sentry", "developer", "api_key", ["new_issue", "New Issue"], ["create_issue", "Create Issue"], [title]),
  pair("datadog", "Datadog", "developer", "api_key", ["new_alert", "New Alert"], ["post_event", "Post Event"], [title]),
  pair("huggingface", "Hugging Face", "ai", "api_key", ["new_model", "New Model"], ["generate", "Generate Text"], [{ key: "prompt", label: "Prompt", type: "text", required: true }]),
  pair("cohere", "Cohere", "ai", "api_key", ["complete", "Complete"], ["generate", "Generate"], [{ key: "prompt", label: "Prompt", type: "text", required: true }]),
  pair("replicate", "Replicate", "ai", "api_key", ["prediction", "New Prediction"], ["run_model", "Run Model"], [{ key: "model", label: "Model", type: "string", required: true }]),
  pair("elevenlabs", "ElevenLabs", "ai", "api_key", ["new_voice", "New Voice"], ["tts", "Text to Speech"], [{ key: "text", label: "Text", type: "text", required: true }]),
  pair("wordpress", "WordPress", "cms", "basic", ["new_post", "New Post"], ["create_post", "Create Post"], [title]),
  pair("webflow", "Webflow", "cms", "oauth2", ["new_item", "New CMS Item"], ["create_item", "Create CMS Item"], [name]),
  pair("contentful", "Contentful", "cms", "api_key", ["new_entry", "New Entry"], ["create_entry", "Create Entry"], [title]),
  pair("ghost", "Ghost", "cms", "api_key", ["new_post", "New Post"], ["create_post", "Create Post"], [title]),
  pair("pinterest", "Pinterest", "social", "oauth2", ["new_pin", "New Pin"], ["create_pin", "Create Pin"], [title]),
  pair("tiktok", "TikTok", "social", "oauth2", ["new_video", "New Video"], ["upload_video", "Upload Video"], [title]),
  pair("buffer", "Buffer", "social", "oauth2", ["new_update", "New Update"], ["create_update", "Create Update"], [msg]),
  pair("google-ads", "Google Ads", "ads", "oauth2", ["new_lead", "New Lead"], ["create_campaign", "Create Campaign"], [title]),
  pair("facebook-ads", "Facebook Ads", "ads", "oauth2", ["new_lead", "New Lead"], ["create_campaign", "Create Campaign"], [title]),
  pair("linkedin-ads", "LinkedIn Ads", "ads", "oauth2", ["new_lead", "New Lead"], ["create_campaign", "Create Campaign"], [title]),
  pair("google-analytics", "Google Analytics", "analytics", "oauth2", ["goal", "Goal Completed"], ["send_event", "Send Event"], [{ key: "name", label: "Event name", type: "string", required: true }]),
  pair("mixpanel", "Mixpanel", "analytics", "api_key", ["new_event", "New Event"], ["track", "Track Event"], [name]),
  pair("amplitude", "Amplitude", "analytics", "api_key", ["new_event", "New Event"], ["track", "Track Event"], [name]),
  pair("segment", "Segment", "analytics", "api_key", ["new_event", "New Event"], ["identify", "Identify"], [email]),
  pair("cal-com", "Cal.com", "scheduling", "api_key", ["booking_created", "Booking Created"], ["create_booking", "Create Booking"], [email]),
  pair("acuity", "Acuity Scheduling", "scheduling", "api_key", ["new_appointment", "New Appointment"], ["create_appointment", "Create Appointment"], [email]),
  pair("vonage", "Vonage", "communication", "api_key", ["inbound_sms", "Inbound SMS"], ["send_sms", "Send SMS"], [{ key: "to", label: "To", type: "string", required: true }, { key: "text", label: "Text", type: "text", required: true }]),
  pair("messagebird", "MessageBird", "communication", "api_key", ["inbound_sms", "Inbound SMS"], ["send_sms", "Send SMS"], [{ key: "to", label: "To", type: "string", required: true }, msg]),
  pair("docusign", "DocuSign", "legal", "oauth2", ["envelope_signed", "Envelope Signed"], ["send_envelope", "Send Envelope"], [email, title]),
  pair("pandadoc", "PandaDoc", "legal", "oauth2", ["document_completed", "Document Completed"], ["create_document", "Create Document"], [title]),
  pair("dropbox-sign", "Dropbox Sign", "legal", "api_key", ["signature_request", "Signature Request Signed"], ["send_request", "Send Signature Request"], [email]),
  pair("eventbrite", "Eventbrite", "events", "oauth2", ["new_attendee", "New Attendee"], ["create_event", "Create Event"], [title]),
  pair("meetup", "Meetup", "events", "oauth2", ["new_rsvp", "New RSVP"], ["create_event", "Create Event"], [title]),
  pair("shipstation", "ShipStation", "logistics", "api_key", ["new_order", "New Order"], ["create_label", "Create Label"], [idField]),
  pair("shippo", "Shippo", "logistics", "api_key", ["new_shipment", "New Shipment"], ["create_shipment", "Create Shipment"], [{ key: "address", label: "Address JSON", type: "json", required: true }]),
  pair("clio", "Clio", "legal", "oauth2", ["new_matter", "New Matter"], ["create_matter", "Create Matter"], [title]),
  pair("teachable", "Teachable", "education", "api_key", ["new_enrollment", "New Enrollment"], ["enroll", "Enroll Student"], [email]),
  pair("thinkific", "Thinkific", "education", "api_key", ["new_enrollment", "New Enrollment"], ["enroll", "Enroll Student"], [email]),
  pair("google-classroom", "Google Classroom", "education", "oauth2", ["new_coursework", "New Coursework"], ["create_coursework", "Create Coursework"], [title]),
  pair("okta", "Okta", "security", "api_key", ["new_user", "New User"], ["create_user", "Create User"], [email]),
  pair("auth0", "Auth0", "security", "custom", ["new_user", "New User"], ["create_user", "Create User"], [email]),
  pair("evernote", "Evernote", "notes", "oauth2", ["new_note", "New Note"], ["create_note", "Create Note"], [title]),
  pair("onenote", "OneNote", "notes", "oauth2", ["new_page", "New Page"], ["create_page", "Create Page"], [title]),
  piece("rss", "RSS", "utilities", "none", [
    op("new_item", "New Item in Feed", "trigger", [{ key: "feedUrl", label: "Feed URL", type: "string", required: true }], "polling"),
    op("fetch", "Fetch Feed", "action", [{ key: "feedUrl", label: "Feed URL", type: "string", required: true }])
  ]),
  pair("odoo", "Odoo", "erp", "custom", ["new_record", "New Record"], ["create_record", "Create Record"], [name]),
  pair("dynamics365", "Microsoft Dynamics 365", "erp", "oauth2", ["new_record", "New Record"], ["create_record", "Create Record"], [name]),
  pair("netsuite", "NetSuite", "erp", "custom", ["new_record", "New Record"], ["create_record", "Create Record"], [name]),
  pair("follow-up-boss", "Follow Up Boss", "realestate", "api_key", ["new_lead", "New Lead"], ["create_lead", "Create Lead"], [email, name]),
  pair("appfolio", "AppFolio", "realestate", "custom", ["new_lead", "New Lead"], ["create_work_order", "Create Work Order"], [title])
];

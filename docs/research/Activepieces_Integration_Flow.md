User:
giv eme https://www.activepieces.com/ full deaitls of feature every featuere pages adn all not architecuture ok
Kimi:
Here is the full feature breakdown of Activepieces (activepieces.com), organized by product area and capability — no architecture.
1. Core Product: AI-First Automation Platform
Activepieces is an open-source automation platform that lets teams build workflows by chatting with AI or using a visual builder. It connects apps, data, and AI models into automated flows called Flows.
Key positioning
“From chat to automation” — describe what you want in plain language, and the platform builds the flow
Used by teams in sales, marketing, support, finance, people/HR, and IT
Trusted by companies like MoneyGram, Alan, PostHog, Pipefy, Tesorio, Envoy, and CafeX
2. Five Major Products (The Activepieces Ecosystem)
Activepieces is not just a workflow builder. It consists of five integrated products:
2.1 Agents
Intelligent AI agents that take prompts, carry out tasks, and return structured results
Build agents with natural language to perform multi-step operations
Agents can browse, call APIs, make decisions, and execute actions across connected tools
Supports OpenAI, Anthropic, Google AI, Hugging Face, and other LLM providers
2.2 Workflow Builder
Modern drag-and-drop visual canvas for building automations
No-code friendly for non-technical users
Supports conditional branching, loops, delays, and parallel branches
Real-time data flow visibility as steps execute
2.3 Tables
Native spreadsheet-like databases built into the platform
Store and organize data within workflows (leads, queues, reference data)
Supports triggers: New Record Created, Record Updated, Record Deleted
Actions: Create/Delete Table, Create/Update/Delete/Get/Find Records, Clear Table, Download as CSV
Acts as structured context storage for AI agents
2.4 To-Dos (Human-in-the-Loop)
Pause flows until a human completes a task or approves an action
Essential for critical workflows: content review, invoice approvals, support escalation, QA
Captures required edits or confirmations, then resumes execution
2.5 MCP (Model Context Protocol)
Turn your LLMs (ChatGPT, Claude, Cursor, Windsurf) into agents by giving them access to your tools and workflows
Exposes Activepieces flows and API actions as callable tools from external AI clients
Connects AI assistants to 300+ tools without writing code
Supports MCP flows — complex multi-app workflows triggered by natural language from AI assistants
3. Integrations (Pieces)
640+ to 740+ pre-built integrations (called “Pieces”) and growing weekly
Covers CRMs, finance tools, project managers, AI services, communication, e-commerce, databases, and more
Examples: Gmail, Slack, HubSpot, Salesforce, Notion, Google Sheets, Microsoft Excel 365, Stripe, QuickBooks, Shopify, WordPress, OpenAI, Anthropic Claude, Discord, Telegram, Twilio, Calendly, Typeform, Jira, Microsoft Teams, SharePoint, OneDrive, Snowflake, PostHog, Mailchimp, ActiveCampaign, Facebook Lead Ads, Airtable, and many more
Custom Pieces: Developers can build new integrations using TypeScript; all pieces are open-source and published on npm
HTTP Piece: Connect to any API immediately even if no pre-built piece exists
4. AI & Agent Capabilities
4.1 AI Copilot
Assists users inside the builder to design flows faster by suggesting steps
4.2 AI Steps in Workflows
Ask ChatGPT / Ask Assistant
Text-to-speech
Vision prompt
Transcribe audio
Extract structured data from text
Custom API calls to AI providers
AI text generation, image generation, and embedding steps
4.3 AI Agent Builder
Build autonomous AI agents with unlimited MCP servers
Multi-step workflow orchestration and intelligent automation
Agents can use tools (web search, database lookups, app actions) and make decisions
4.4 MCP Support
Native Model Context Protocol integration
Lets AI agents connect to diverse data sources for context-rich automation
AI assistants can trigger Activepieces workflows as actions from within a chat
5. Chat to Automation
Conversational interface to build automations
Chat with your tools to get answers and take action
Turn repetitive tasks into automations as fast as you can describe them
Gradually rolling out to users
6. Document Workflow Automation
Automate document-heavy processes: invoices, contracts, onboarding, expense reports, compliance
Automated routing, approvals, version control, audit logs
AI-enhanced: read documents, extract data, flag fraud, determine risk levels, route to correct approvers
Integrates with storage, email, spreadsheets, finance tools, CRMs
7. Data Integration & Sync
510+ to 640+ data integrations
Sync data across revenue stack, CRMs, analytics, marketing platforms
ETL-like capabilities without being a pure ETL tool
Route marketing data through flows so reports stay current
Bi-directional sync between systems
8. Embeddable Automation (Activepieces Embed)
JavaScript SDK to embed the automation builder inside your own SaaS product
White-label: custom branding, styling (light/dark mode, custom fonts)
Your users never leave your product
Features include:
Embeddable builder iframe
User provisioning via JWT
Connection management
Piece management
Template management
MCP settings dialog inside host app
Hide/show UI elements (sidebar, tables, global search, active users, export/import, duplicate flow, folders, page headers)
Localization support (14 languages)
Navigation handler for route sync
Pricing: Starts at ~$30K/year for Embed license
9. Self-Hosting & Deployment
Community Edition: Free, open-source (MIT license), self-hosted via Docker/Kubernetes/Helm
No limits on tasks, runs, users, or flows
Full data control — ideal for regulated industries, HIPAA, data residency
Same updates as cloud version
Every paid plan also works on-prem
10. Enterprise & Security Features
SSO (SAML/OIDC)
SCIM provisioning
Custom RBAC (Role-Based Access Control)
Audit logs
Secret managers
Event streaming
Private pieces (custom integrations not shared publicly)
Git Sync with releases — version control for flows
Platform governance
SOC 2 Type II certified cloud
Network isolation / air-gapped deployment options
Data masking — sensitive details never appear in logs
Encrypted credentials
11. Collaboration & Team Features
Multi-user workspaces
Projects (team isolation)
Team analytics
Active users / presence indicators in builder
Per-project execution priority
Human approvals within flows
12. Pricing Plans (Feature Tiers)
Plan
Price
Key Limits
Free
$0
1 user, daily credit refresh, community support
Plus
~$16/mo
Up to 5 users, unlimited flows, 3× credits, email support
Team
Higher tier
Unlimited users, SSO, standard roles, team analytics, onboarding call
Ultimate
Custom quote
SCIM, custom RBAC, audit logs, secret managers, event streaming, private pieces, Git Sync, dedicated support
Embed
~$30K+/yr
Everything in Ultimate + embeddable builder, JS SDK, branding, user provisioning
Credit system: Running a flow = 1 credit (unlimited steps inside). AI steps = 2–20 credits depending on model. Bring your own AI key = 1 credit.
Self-hosted: Free Community Edition has no run limits; paying unlocks team/admin features, agents/chat, API access, and support.
13. Use Cases by Department
Department
What Activepieces Does
Sales
Lead reply in minutes, CRM updates, lead scoring, outreach sequences, territory assignment
Marketing
Campaign deployment, social posts, SEO workflows, lead enrichment, analytics dashboards
Support
24/7 ticket routing, categorization, escalation, CRM sync, AI-powered responses
Finance
Faster month-end close, invoice processing, receipt categorization, payment tracking, QuickBooks/Stripe sync
People/HR
New hire setup before day one, onboarding workflows, resume screening, interview transcription
IT
Access provisioning in minutes, fully logged, permission management
14. Developer & Extensibility Features
TypeScript-based framework for building custom pieces
Hot reloading during development
Open-source ecosystem on GitHub (23,978+ stars)
npm-published pieces — community contributes new integrations regularly
Webhook support: inbound (trigger flows) and outbound (POST to endpoints)
API access for programmatic control
Formula editor with custom documentation links for embedded use
15. Supported Languages (Localization)
The embed SDK and UI support: English, Dutch, Italian, German, French, Bulgarian, Ukrainian, Hungarian, Spanish, Japanese, Indonesian, Vietnamese, Chinese, Portuguese, Chinese-Taiwan, Russian.
Summary
Activepieces is an AI-first, open-source automation platform combining: - Visual/no-code workflow builder - AI agents & copilot - 640–740+ app integrations - Native databases (Tables) - Human approvals (To-Dos) - MCP protocol for AI-tool connectivity - Embeddable white-label SDK - Free self-hosting + enterprise cloud tiers
It competes with Zapier, Make.com, and n8n, differentiated by its open-source MIT license, unlimited runs pricing model, native AI agent support, and embeddable builder for SaaS companies.
User:
now giveme full featuere flow how integreatoin and workflow autoiimation wiht actoin works in this https://www.activepieces.com/ ok
Kimi:
Here is the complete feature flow of how integrations and workflow automation with actions work in Activepieces — from the moment you open the builder to when a live automation executes across your apps.
Activepieces: Full Feature Flow — Integrations & Workflow Automation
1. The Four Core Building Blocks
Everything in Activepieces is built from four primitives:
Block
What It Is
Role
Piece
An integration (app connector) — e.g., Gmail, Slack, HubSpot, OpenAI
Provides Triggers + Actions for that app
Flow
A complete automation — one Trigger + any number of Actions/Logic
The executable workflow
Trigger
The starting event that fires the flow
Watches an app and passes data into the flow
Action
A task executed after the trigger
Performs work: send email, update record, call AI, etc.
2. The Workflow Builder: Visual Canvas
2.1 Creating a Flow
Start from scratch or pick a pre-built template (200+ templates covering sales, marketing, support, finance).
The builder opens as a vertical diagram — steps stack top-to-bottom, connected by data lines.
Drag-and-drop pieces from the sidebar onto the canvas.
2.2 The Builder Interface
Left sidebar: All available Pieces (640+ integrations), organized by category
Canvas: Visual flow diagram showing Trigger → Action 1 → Action 2 → etc.
Right panel: Configuration panel for the selected step
Data to Insert panel: Pops up when you click into any input field — shows all data from previous steps that you can map forward
3. Step 1: Setting the Trigger
The trigger is always the first step at the top of the flow. It defines when the automation runs.
3.1 Trigger Types
Type
How It Works
Example
Event Trigger (Webhook)
Real-time. The external app pushes data to Activepieces instantly when something happens.
“New email in Gmail” — Gmail sends a webhook, flow fires immediately
Polling Trigger
Activepieces checks the app at set intervals (e.g., every 5 minutes) for new data.
“New row in Google Sheets” — polls the sheet periodically
Schedule Trigger
Fires on a cron schedule (every hour, daily at 9 AM, etc.)
“Run every Monday at 8 AM”
Manual Trigger
User clicks a button to run the flow on demand
“Run this flow now” button
Form Trigger
A public form interface that anyone can fill out to start the flow
Customer submits a support request form
Chat Trigger
A conversation interface that triggers flows from chat messages
User asks an AI agent to perform a task
3.2 Configuring a Trigger
Select a Piece (e.g., Gmail)
Pick the trigger event (e.g., “New Email”)
Authenticate — connect your account via OAuth2 or API key
Set filters (optional) — e.g., only trigger on emails with subject containing “Invoice”
Load Sample Data — pulls real recent data from the connected app so you can see exactly what fields are available (subject, body, sender, attachments, etc.)
4. Step 2: Adding Actions
After the trigger, you add Action steps that execute sequentially.
4.1 Action Categories
Category
What It Does
Examples
App Actions
Perform tasks in connected apps
Send Gmail email, post Slack message, create HubSpot contact, update Notion page
AI Actions
Call AI models
Ask ChatGPT, summarize text, extract data, transcribe audio, generate images
Core Actions
Built-in platform utilities
HTTP request, Code (TypeScript/JavaScript with npm), Filter, Loop, Delay, Storage
Human Actions
Pause for human input
Approval request, To-Do task, Form response
Data Actions
Manipulate data
Text helper, Date helper, Image helper, Cryptography, JSON operations
4.2 Configuring an Action
Select a Piece (e.g., Slack)
Pick the action (e.g., “Send Message to Channel”)
Authenticate — connect your Slack workspace
Map data — use the Data to Insert panel to pull fields from previous steps:
{{trigger.subject}} — email subject from the trigger
{{openai.response}} — AI-generated summary from a previous AI step
{{step_2.record_id}} — ID created in a previous database step
Add static text mixed with dynamic data:
New lead from {{trigger.sender}}: {{trigger.body}}
Test the step — run just this action with sample data to verify it works
5. Data Flow: How Information Moves Through Steps
Activepieces uses a parent-to-child data flow:
Trigger (Step 1)    ↓ produces dataAction 1 (Step 2) — can access ALL data from Step 1    ↓ produces dataAction 2 (Step 3) — can access ALL data from Steps 1 AND 2    ↓ produces dataAction 3 (Step 4) — can access ALL data from Steps 1, 2, AND 3
Data flows downward only — child steps access parent output, not sibling or downstream data
Each step’s output becomes available in the Data to Insert panel for all subsequent steps
You can expand nested objects (indicated by a caret ⌄) to drill into specific fields
6. Logic & Control Flow
Between actions, you add logic to make workflows intelligent:
6.1 Branch (If/Else)
Split the flow into two paths based on conditions
Example: If lead_score > 80 → send to sales team; Else → add to nurture sequence
6.2 Switch (Multiple Branches)
Sort data into many paths based on a field value
Example: If ticket_priority = "High" → escalate; "Medium" → queue; "Low" → auto-respond
6.3 Loop
Run the same action for each item in a list
Example: For each email attachment → upload to Google Drive
6.4 Delay
Pause execution for a set time (minutes, hours, days)
Example: Wait 2 hours → send follow-up email
6.5 Auto-Retries
If an action fails, automatically retry with exponential backoff
Configurable retry count and delay
6.6 Human in the Loop (To-Do / Approval)
Pause the flow until a human approves or completes a task
Sends a notification with approve/reject buttons
Captures required edits before resuming
7. The Piece Framework: How Integrations Work
7.1 What Is a Piece?
A Piece is a TypeScript npm package that defines: - Authentication methods (OAuth2, API Key, Basic Auth) - Triggers (events that start flows) - Actions (tasks the piece can perform) - Input properties (forms for configuring each trigger/action)
7.2 Piece Architecture
// Simplified conceptPiece: {  name: "slack",  auth: OAuth2,  triggers: [    "New Message",    "New Channel Created"  ],  actions: [    "Send Message",    "Create Channel",    "Add Reaction"  ]}
7.3 How Pieces Connect to Apps
OAuth2 Flow — User clicks “Connect,” grants permissions via the app’s OAuth screen, Activepieces stores an encrypted token
API Key — User pastes their API key, stored encrypted with 256-bit keys
Polling — For triggers without webhooks, the piece calls the app’s API on a schedule
Webhooks — For real-time triggers, Activepieces registers a webhook URL with the app; when events occur, the app POSTs data to that URL
7.4 Custom Pieces
Developers build new pieces using the TypeScript framework
Hot reloading during local development
Pieces are published to npm and become automatically available
60% of pieces are community-contributed
All pieces are open-source and also exposed as MCP servers for LLM use
8. AI & MCP Integration Flow
8.1 AI Steps Inside Workflows
You can add AI as an action step: 1. Select an AI Piece (OpenAI, Anthropic Claude, Google AI, etc.) 2. Choose the model (GPT-4o, Claude 3.5, etc.) 3. Write the prompt — mix static text with dynamic data from previous steps: Summarize this email in 3 bullet points:    Subject: {{trigger.subject}}    Body: {{trigger.body}} 4. Map the AI response to the next action (e.g., save summary to Notion, send via Slack)
8.2 MCP (Model Context Protocol) Flow
Activepieces pieces are automatically exposed as MCP servers: 1. Any piece you create becomes callable from Claude Desktop, Cursor, or Windsurf 2. Your LLM can trigger Activepieces workflows as tools 3. Example: In Claude, you say “Add this lead to HubSpot and send a welcome email” → Claude calls the Activepieces MCP server → the flow executes
9. End-to-End Execution Flow
Here is exactly what happens when a flow runs:
┌─────────────────────────────────────────────────────────────┐│  STEP 1: TRIGGER MONITORING                                  ││  • Activepieces watches the connected app (via webhook      ││    or polling)                                               ││  • Event occurs: "New email received in Gmail"               ││  • Trigger fires, captures all email data (subject, body,    ││    sender, attachments, timestamp)                           │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  STEP 2: FLOW INITIALIZATION                                 ││  • A new "Flow Run" is created with a unique ID              ││  • Trigger data is serialized and passed to Step 2           ││  • 1 credit is consumed for the flow run                     │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  STEP 3: SEQUENTIAL ACTION EXECUTION                         ││  • Action 1 receives trigger data via Data to Insert panel   ││  • Action 1 executes (e.g., "Ask ChatGPT to summarize")      ││  • AI response is captured and stored                        ││  • Action 2 receives trigger data + Action 1 output           ││  • Action 2 executes (e.g., "Send Slack message")           ││  • Continue until all steps complete or an error occurs      │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  STEP 4: ERROR HANDLING                                      ││  • If an action fails: retry up to N times (auto-retry)    ││  • If still failing: flow pauses, user gets an alert         ││  • User can inspect the failed step, fix config, and resume  │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  STEP 5: LOGGING & MONITORING                                ││  • Every step's input/output is logged (sensitive data masked)││  • User views execution history in the dashboard              ││  • Can replay specific runs or debug step-by-step            │└─────────────────────────────────────────────────────────────┘
10. Testing, Publishing & Monitoring
10.1 Testing
Test individual steps — run a single action with sample data without running the whole flow
Test the entire flow — simulate the trigger and watch each step execute
Sample data — real data from your connected apps is loaded for realistic testing
10.2 Publishing
Flows are draft until you click Publish
Once published, the trigger becomes active (webhooks registered, polling starts)
Versioning — every publish creates a new version; you can roll back to previous versions
10.3 Monitoring
Execution history — see every run, its status (success/failed), and duration
Step-by-step logs — inspect exactly what data entered and exited each step
Replay — re-run a failed flow from any step
Team analytics (Team/Ultimate plans) — see which flows run most, credit usage, etc.
11. Human Interfaces (Forms & Chat)
11.1 Form Trigger
Build a form with text inputs, file uploads, etc.
Publish the form — get a public URL
Anyone filling the form triggers the flow
Flow can return a response (markdown text or file download) back to the user
11.2 Chat Interface
Users chat with an AI agent inside Activepieces
The agent can trigger flows as tools
Flow executes and returns results to the chat
12. Complete Example Flow
Scenario: When a new lead fills out a Typeform, summarize their answers with AI, create a HubSpot contact, notify Slack, and if the deal value is >$10K, request manager approval.
┌─────────────────────────────────────────────────────────────┐│ TRIGGER: Typeform — "New Form Submission"                    ││ • Captures: name, email, company, budget, use_case           │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│ ACTION 1: OpenAI — "Ask ChatGPT"                             ││ • Prompt: "Summarize this lead: {{trigger.use_case}}"         ││ • Output: lead_summary                                      │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│ ACTION 2: HubSpot — "Create Contact"                         ││ • Name: {{trigger.name}}                                    ││ • Email: {{trigger.email}}                                   ││ • Company: {{trigger.company}}                               ││ • Notes: {{openai.lead_summary}}                            │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│ ACTION 3: Slack — "Send Message to #sales"                   ││ • Message: "New lead: {{trigger.name}} from                  ││   {{trigger.company}}. Budget: ${{trigger.budget}}."         │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│ LOGIC: Branch — "If budget > 10000"                          ││ ├─ TRUE → ACTION 4a: To-Do — "Request manager approval"    ││ │         • Assign to: Sales Manager                        ││ │         • Details: {{trigger.name}} — ${{trigger.budget}}   ││ │         • Flow PAUSES until approved                       ││ │         • On approval → Resume → ACTION 5: Mark "Hot Lead" ││ └─ FALSE → ACTION 4b: HubSpot — "Update Contact Status"      ││           • Status: "Nurture"                               │└─────────────────────────────────────────────────────────────┘
13. Credit System (How Execution Is Metered)
Action
Credits
Run a flow (any number of steps)
1 credit
Each step inside a flow
Free (included in the 1 credit)
Agentic action
1 credit
AI step — Fast model
2 credits
AI step — Smart model
10 credits
AI step — Frontier model
20 credits
AI step — Bring your own API key
1 credit
Summary: The Activepieces Automation Flow
Phase
What Happens
Design
Drag-and-drop builder → add trigger → add actions → map data → add logic
Connect
OAuth/API auth to apps → load sample data → test each step
AI Enhancement
Add AI steps (summarize, extract, generate) → use MCP to expose flows to LLMs
Human Gate
Insert approvals, to-dos, or form triggers where human judgment is needed
Publish
Click publish → trigger goes live → webhooks registered
Execute
Event occurs → trigger fires → sequential action execution → data passes step-to-step
Monitor
View logs, replay failures, version history, team analytics
Extend
Build custom TypeScript pieces → publish to npm → auto-available as MCP servers
User:
now i need inner full processs of workflow createion and integratoins ok lke zapire and activepirsces fulll feature descriopnt
Kimi:
Here is the complete inner process breakdown of how workflow creation and integrations work in both Zapier and Activepieces — step by step, feature by feature.
Part 1: Zapier — Full Inner Process
1. The Core Building Blocks
Block
What It Is
Zap
A complete automation — one Trigger + one or more Actions
Trigger
The event that starts the Zap (e.g., “New email in Gmail”)
Action
What Zapier does after the trigger fires (e.g., “Send Slack message”)
Task
Each successful action execution counts as 1 task
2. Workflow Creation Process (Step-by-Step)
Step 1: Create a New Zap
Click “Create a Zap” or start from a pre-built template (thousands available)
Or use Zapier Copilot (AI) — describe what you want in natural language, and AI builds the draft Zap structure including multi-step sequences, conditional filters, and data field mappings
Step 2: Set Up the Trigger
Search and select your trigger app (e.g., Gmail, Typeform, Slack)
Pick the trigger event (e.g., “New Email,” “New Form Response,” “New Message”)
Connect your account via OAuth2 or API key
Configure trigger options (e.g., specific label, channel, or form)
Test the trigger — Zapier pulls real recent data from your connected app to verify it works
Review the sample data (fields like subject, body, sender, timestamp)
Step 3: Add Actions
Click the + icon to add an action step
Search and select your action app (e.g., Slack, Google Sheets, HubSpot)
Pick the action event (e.g., “Send Channel Message,” “Create Spreadsheet Row”)
Connect your account to that app
Map data fields — click into any input field and a modal appears showing all data from previous steps. Type / to open the data picker and map dynamic values:
Channel: #salesMessage: New lead from {{trigger.email}} — {{trigger.subject}}
Test the action — runs with sample data to verify output
Step 4: Add Built-in Tools (Logic & Control)
Zapier provides several built-in tools to customize flows:
Tool
What It Does
Filter
Stops the Zap unless conditions are met (e.g., only if email contains “Invoice”)
Paths
Branch the Zap into up to 3 paths based on conditions (Pro plans+)
Formatter
Transform data — text formatting, date conversion, number operations, line items
Delay
Pause execution for a set time (minutes, hours, days)
Schedule
Run the Zap on a recurring schedule instead of an event trigger
Search Step
Find existing records in apps before creating new ones
Webhooks by Zapier
Send/receive custom HTTP requests to any API
Code by Zapier
Run custom JavaScript or Python code (max 2 code steps per Zap)
AI by Zapier
Add AI steps — summarize, translate, classify, generate text with OpenAI models
Step 5: Test and Publish
Test individual steps or the entire Zap
Review the Zap History to see all data in/out of each step
Click Publish — the Zap goes live, webhooks are registered, and polling begins
Zapier runs your action steps each time the trigger event occurs
3. How Integrations (Apps) Work in Zapier
3.1 App Directory
7,000+ to 9,000+ app integrations — the largest ecosystem in automation
Browse by category: CRM, Email, Marketing, Project Management, AI, etc.
Each app exposes its triggers and actions to Zapier via API
3.2 Authentication Methods
Method
How It Works
OAuth2
User clicks “Connect,” grants permissions via the app’s OAuth screen, Zapier stores an encrypted token
API Key
User pastes their API key into Zapier’s secure connection form
Basic Auth
Username/password for legacy systems
3.3 Trigger Mechanisms
Type
How It Works
Instant (Webhook)
Real-time — the app pushes data to Zapier instantly when an event occurs
Polling
Zapier checks the app’s API at intervals (typically 1–15 minutes depending on plan) for new data
3.4 Data Mapping
When configuring any action, click into input fields
A data picker modal appears showing all available fields from previous steps
Map dynamic data by clicking fields (e.g., {{1.subject}} for trigger subject)
Mix static text with dynamic data freely
3.5 AI Integration in Zapier
AI by Zapier — built-in AI steps powered by OpenAI
Choose model tier: Auto, Advanced, Premium, or Bring Your Own Key
Add tools: app actions, knowledge sources, web search
Map AI output to subsequent steps
Zapier Central — create custom AI chatbots/agents that can trigger Zaps
Zapier Copilot — AI assistant inside the builder that helps write prompts and configure steps
4. Zapier Pricing & Limits (2026)
Plan
Price
What You Get
Free
$0
100 tasks/mo, 5 Zaps, 15-min polling
Starter
~$20/mo
750 tasks/mo, 20 Zaps, 15-min polling
Professional
~$49/mo
2,000 tasks/mo, unlimited Zaps, 2-min polling
Team
~$69/mo
50,000 tasks/mo, unlimited Zaps, 1-min polling, shared workspaces
Company
~$599/mo
100,000 tasks/mo, advanced admin, SAML SSO
Per-task billing: Every successful action = 1 task. Triggers are free.
Premium apps (Salesforce, HubSpot, etc.) require paid plans
No self-hosting option
Part 2: Activepieces — Full Inner Process
1. The Core Building Blocks
Block
What It Is
Flow
A complete automation — one Trigger + any number of Actions/Logic steps
Piece
An integration (app connector) — provides Triggers + Actions for an app
Trigger
The starting event that fires the flow
Action
A task executed after the trigger
Step
Any single node in the flow (trigger, action, or logic)
2. Workflow Creation Process (Step-by-Step)
Step 1: Create a New Flow
Click “New Flow” in the dashboard
Or pick from 200+ pre-built templates
Or use the AI Copilot — describe what you want in English, and the system suggests steps or writes code for custom blocks
Step 2: The Builder Interface
Vertical diagram — steps stack top-to-bottom, connected by data lines
Left sidebar: All available Pieces (640+ integrations), organized by category
Canvas: Visual flow diagram showing the full structure at a glance
Right panel: Configuration for the selected step
Data to Insert panel: Pops up when you click any input field — shows all data from previous steps
Step 3: Set Up the Trigger
Select a Piece (e.g., Gmail)
Pick the trigger event (e.g., “New Email”)
Authenticate — connect via OAuth2 or API key
Set filters (optional) — e.g., only trigger on emails with subject containing “Invoice”
Load Sample Data — pulls real recent data from the connected app so you can see exactly what fields are available
Step 4: Add Actions
Drag a Piece from the sidebar onto the canvas below the trigger
Select the action (e.g., Slack → “Send Message”)
Authenticate the app
Map data using the Data to Insert panel:
Message: New lead from {{trigger.sender}}: {{trigger.body}}
Test the step — each block has a Test button that pulls real trigger data
Step 5: Add Logic & Control Flow
Activepieces places logic blocks directly in the main flow as visual nodes:
Logic Block
What It Does
Branch
If/Else split — two paths based on conditions
Loop
Iterate over arrays (e.g., process each email attachment)
Delay
Pause execution for a set time
Code
Run custom JavaScript or Python with npm support
HTTP Request
Call any API directly
Storage
Read/write key-value data across flow runs
To-Do / Approval
Pause flow until a human approves or completes a task
Filter
Stop the flow unless conditions are met
Step 6: Test and Publish
Test individual steps — run a single action with sample data
Test the entire flow — simulate the trigger and watch each step execute
Execution history appears in the dashboard — open any run to see exactly what data passed through each step
Click Publish — the trigger becomes active (webhooks registered or polling starts)
Version history — every publish creates a new version; rollback available
3. How Integrations (Pieces) Work in Activepieces
3.1 Piece Framework
A Piece is a TypeScript npm package that defines: - Authentication methods (OAuth2, API Key, Basic Auth, Custom) - Triggers (events that start flows) - Actions (tasks the piece can perform) - Input properties (forms for configuring each trigger/action)
3.2 Trigger Types
Type
How It Works
Webhook (Instant)
Real-time — app pushes data to Activepieces via webhook
Polling
Activepieces checks the app’s API at intervals for new data
Schedule
Cron-based — fires on a schedule (every hour, daily, etc.)
Manual
User clicks a button to run on demand
Form Trigger
Public form that anyone can fill out to start the flow
Chat Trigger
Conversation interface that triggers flows from chat
3.3 Authentication
OAuth2: Standard OAuth flow with redirect
API Key: Encrypted storage of API keys
Custom Auth: For apps with unique auth mechanisms
All credentials encrypted with 256-bit keys
3.4 Data Flow
Parent-to-child flow: Data moves downward only
Child steps access ALL output data from parent steps
Each step’s output appears in the Data to Insert panel for subsequent steps
Nested objects can be expanded (caret ⌄) to drill into specific fields
3.5 Custom Pieces & Community
Open-source TypeScript framework for building pieces
Hot reloading during local development
Pieces published to npmjs.com — automatically available in the platform
60% of pieces are community-contributed
All pieces are also exposed as MCP servers for LLM use
4. AI Integration in Activepieces
AI Feature
How It Works
AI Copilot
Chat-like assistant inside the builder — describe what you want, AI suggests steps or writes code
AI Steps
Add OpenAI, Claude, Google AI as action nodes — write prompts mixing static text with dynamic data from previous steps
AI Agents
Build autonomous agents that can reason, use tools, and make decisions across multiple steps
MCP Support
All pieces become callable tools from Claude Desktop, Cursor, Windsurf — your LLM can trigger Activepieces workflows
5. Activepieces Pricing & Limits (2026)
Plan
Price
What You Get
Free (Cloud)
$0
1,000 tasks/mo, 2 active flows, 200 AI credits, 1 user
Plus
~$16–25/mo
Unlimited tasks, 10 active flows, AI agents, 500 AI credits
Business/Team
~$150/mo
50 active flows, 5+ users, 1,000 AI credits, team collaboration
Enterprise
Custom
Unlimited flows, SSO, audit logs, Git Sync, private pieces
Community (Self-Hosted)
$0
Unlimited everything — runs, flows, users, pieces. No AI agents/chat, no team admin, no SSO
Credit system: 1 flow run = 1 credit (unlimited steps inside). AI steps = 2–20 credits depending on model.
Self-hosting: Free, open-source (MIT license), Docker/Kubernetes deployment
Part 3: Side-by-Side Comparison
Feature
Zapier
Activepieces
Workflow Structure
Linear: Trigger → Action 1 → Action 2…
Vertical diagram: Trigger → Action/Logic nodes stacked top-to-bottom
Builder UI
Clean step-by-step wizard
Visual canvas with full flow visible at once
Total Integrations
7,000–9,000+ apps
640+ native pieces (growing weekly)
AI Building
Zapier Copilot — natural language draft
AI Copilot — suggests steps and writes code
AI Steps
AI by Zapier (OpenAI models)
Native OpenAI, Claude, Google AI, custom models
AI Agents
Zapier Central (chatbots)
Full AI agents with tool use + MCP support
Branching Logic
Paths (max 3 branches per step, Pro+)
Unlimited Branch nodes with If/Else
Loops
Limited (via Line Items/Formatter)
Full Loop nodes — iterate over any array
Code Steps
JavaScript or Python (max 2 per Zap)
JavaScript or Python (unlimited, with npm)
Human Approval
Not native (requires third-party apps)
Built-in To-Do/Approval nodes
Data Storage
Tables (Zapier Tables)
Built-in Tables (spreadsheet-like databases)
Forms
Not native
Built-in Form Trigger
Webhooks
Webhooks by Zapier
Native inbound/outbound HTTP + webhooks
Version History
7 days for logs only
Full version history with rollback
Self-Hosting
❌ Not available
✅ Free, open-source, Docker/K8s
Pricing Model
Per-task billing (scales with usage)
Per-credit or flat-rate (unlimited tasks on paid plans)
Open Source
❌ Closed source
✅ MIT license, full source code
Custom Integrations
Limited (via webhooks/API requests)
Full TypeScript framework — build and publish pieces
Embed in Products
❌ Not available
✅ White-label embed SDK for SaaS
Execution History
30 days (free), 90 days (paid)
90 days (cloud), unlimited (self-hosted)
Team Collaboration
Shared workspaces (Team+)
Projects, team analytics, role-based access
Part 4: End-to-End Example — Same Workflow on Both Platforms
Scenario: When a new lead fills out a Typeform, summarize their answers with AI, create a HubSpot contact, and notify Slack. If deal value >$10K, request manager approval.
Zapier Version
Trigger: Typeform — "New Form Submission"    ↓Action 1: AI by Zapier — "Summarize lead answers"    Prompt: "Summarize: {{1.use_case}}"    ↓Action 2: HubSpot — "Create Contact"    Name: {{1.name}}, Email: {{1.email}}, Notes: {{2.output}}    ↓Action 3: Slack — "Send Message to #sales"    Message: "New lead: {{1.name}} — ${{1.budget}}"    ↓Path A (Filter: budget > 10000):    → Action 4a: [Requires third-party app or manual process for approval]Path B (Filter: budget ≤ 10000):    → Action 4b: HubSpot — "Update Contact Status" = "Nurture"
Activepieces Version
Trigger: Typeform — "New Form Submission"    ↓Action 1: OpenAI — "Ask ChatGPT"    Prompt: "Summarize this lead: {{trigger.use_case}}"    ↓Action 2: HubSpot — "Create Contact"    Name: {{trigger.name}}, Email: {{trigger.email}}, Notes: {{step_1.response}}    ↓Action 3: Slack — "Send Message to #sales"    Message: "New lead: {{trigger.name}} — ${{trigger.budget}}"    ↓Branch: If {{trigger.budget}} > 10000    ├─ TRUE → To-Do: "Request manager approval"    │         • Assign to: Sales Manager    │         • Flow PAUSES until approved    │         • On approval → Resume → HubSpot: Mark "Hot Lead"    └─ FALSE → HubSpot: "Update Contact Status" = "Nurture"
Summary
Aspect
Zapier
Activepieces
Best For
Non-technical users who need 7,000+ app connections instantly
Teams wanting open-source, unlimited tasks, self-hosting, AI agents
Ease of Use
Easiest — wizard-style, minimal learning curve
Modern visual builder — slightly steeper but still no-code friendly
Power & Flexibility
Good for standard business workflows
Superior for complex logic, custom code, AI integration, human approvals
Cost at Scale
Expensive — per-task billing grows fast
Cheap/Free — flat rate or self-hosted with unlimited runs
Data Control
Cloud-only, vendor lock-in
Full control — self-host on your own infrastructure
AI Capabilities
Built-in AI steps + Zapier Central chatbots
Native AI agents, MCP protocol, custom model support
Extensibility
Limited to webhooks and 2 code steps
Full TypeScript framework — build unlimited custom pieces
User:
also what wil hpaoone whenn i rurn automatoin and alll full details
Kimi:
Here is the complete inner execution process of what happens the moment you hit “Publish” and an automation actually runs — covering both Zapier and Activepieces from trigger fire to final log entry.
Part 1: Zapier — Full Runtime Execution Process
1. The Moment a Zap Goes Live
When you click Publish, Zapier does three things immediately:
Registers webhooks (for instant triggers) — Zapier tells the source app: “When X happens, POST to this URL”
Starts polling jobs (for polling triggers) — Zapier schedules API checks at your plan’s interval (1–15 minutes)
Activates the Zap state — The Zap moves from draft to “On” in Zapier’s database
2. Trigger Detection Phase
2.1 Webhook Triggers (Instant)
The source app detects the event (e.g., “New email in Gmail”)
The app pushes a JSON payload to Zapier’s unique webhook URL
Zapier receives it, validates the signature (if required), and immediately queues a Task
2.2 Polling Triggers
Zapier’s scheduler calls the app’s API at intervals based on your plan:
Free/Starter: ~15 minutes
Professional: ~2 minutes
Team/Company: ~1 minute
Zapier compares the latest API response against a stored cursor/timestamp
If new data is found, it creates a Task for each new item
3. Task Creation & Queuing
Each trigger event becomes a Task in Zapier’s cloud queue
Zapier processes 3+ billion tasks per month across its infrastructure
Tasks are distributed across Zapier’s serverless workers
Each Zap execution is isolated — one Task does not affect another
4. Sequential Step Execution
Once a Task is picked up by a worker, Zapier executes steps strictly in sequence:
Step 1 (Trigger): Data captured → Serialized as JSON    ↓Step 2 (Action 1): Receives Step 1's output → Executes API call → Captures response    ↓Step 3 (Action 2): Receives Steps 1+2 output → Executes → Captures response    ↓Step 4 (Logic/Filter): Evaluates condition → Routes to next step or stops    ↓...continues until final step
Data Passing Between Steps
Each step’s output is stored as a JSON object in Zapier’s internal state
Subsequent steps access previous data via the Data Picker ({{step.field}} syntax)
Data is immutable — once a step completes, its output is frozen for that Task
5. Action Execution Details
For each action step, the worker:
Resolves mapped fields — substitutes {{}} variables with actual values from previous steps
Authenticates — retrieves the encrypted OAuth token or API key from Zapier’s secure vault
Makes the API call — sends the request to the target app
Handles the response — parses JSON/XML, stores output for next steps
Logs the result — success or failure recorded in Task History
6. Built-In Logic Execution
Logic
How It Executes
Filter
Evaluates condition after data resolution. If false → Task stops immediately. No subsequent steps run.
Paths
Evaluates path conditions sequentially. Only matching branches execute. Max 3 nested Path steps, 10 branches per group.
Loop
Repeats the action for each item in a line-item array. Each iteration is part of the same Task.
Delay
Schedules the remaining steps for future execution. The Task pauses and resumes at the scheduled time.
Formatter
Runs transformation in-memory (text, numbers, dates) before passing to next step.
Code by Zapier
Spins up a sandboxed environment (JavaScript/Python), executes your code, returns output. Max 2 code steps per Zap.
7. Error Handling & Retries
7.1 Automatic Retries
If an action fails, Zapier automatically retries up to 3 times over approximately one hour
Uses exponential backoff — waits longer between each retry
Handles transient failures: network timeouts, 5xx errors, rate limits (429)
7.2 What Happens on Persistent Failure
After 3 failed retries, the Task is marked “Errored”
The Zap stops for that specific Task — subsequent steps do not run
You receive an email notification (if enabled)
7.3 Error Types That Skip Retries
Authentication errors (401/403) → Immediate fail, no retries
Invalid data / 400 errors → Immediate fail, no retries
These require manual fixes (reconnect account, fix mapping)
8. Task Billing Metering
Triggers are FREE — they never count as tasks
Each successful action = 1 Task
Failed actions that succeed on retry = 1 Task (only the successful execution counts)
Filters, Formatters, and built-in tools = 1 Task each when they execute
Paths: Each branch that executes counts its actions separately
Loops: Each iteration of an action inside a loop = 1 Task per iteration
Example: A 5-step Zap with a Loop that runs 3 times = approximately 13+ Tasks per run.
9. Logging & Monitoring
Task History
Every execution attempt is logged with:
Input data sent to each step
Output data returned from each step
Exact error messages and HTTP status codes
Timestamps for each step
Free plan: 30 days of history
Paid plans: 90 days+ of history
Replay
You can manually replay a failed Task after fixing the issue
Zapier re-runs from the failed step using the original trigger data
10. Security During Execution
All credentials stored with 256-bit encryption
OAuth tokens refreshed automatically before API calls
Data in transit over TLS 1.2+
Zapier’s workers run in isolated containers
No self-hosting — all execution happens on Zapier’s cloud
11. What Happens When You Turn a Zap Off
Webhooks are deregistered from the source app
Polling jobs are removed from the scheduler
Tasks already in the queue may still process (depending on timing)
No new Tasks are created until re-enabled
Part 2: Activepieces — Full Runtime Execution Process
1. The Moment a Flow Goes Live
When you click Publish, Activepieces does the following:
Saves the flow version — Every publish creates a new version; previous versions are preserved for rollback
Registers webhooks (for webhook triggers) — Activepieces generates a unique URL and registers it with the source app
Starts polling jobs (for polling triggers) — The scheduler begins checking the app’s API at set intervals
Activates the trigger listener — The flow state changes to “Published” in the database
2. Trigger Detection Phase
2.1 Webhook Triggers (Real-Time)
External app sends a POST request to Activepieces’ webhook endpoint
Activepieces validates the payload, parses it, and immediately creates a Flow Run
No polling delay — execution starts within milliseconds
2.2 Polling Triggers
Activepieces queries the app’s API on a schedule (configurable cron interval)
Compares results against stored state (cursor/timestamp)
New items spawn new Flow Runs
2.3 Schedule Triggers
Cron-based firing (e.g., every hour, daily at 9 AM)
Trigger data may be minimal (just a timestamp)
2.4 Manual / Form / Chat Triggers
Manual: User clicks “Run” → Flow Run created immediately
Form: HTTP POST from form submission → Flow Run created
Chat: Message received → Flow Run created with message content
3. Flow Run Creation & Queuing
Activepieces uses a queue-based architecture:
Trigger Event Detected    ↓Flow Run Created (unique ID assigned)    ↓Added to Execution Queue (Redis/BullMQ)    ↓Worker Picks Up the Job    ↓Sequential Step Execution Begins
Self-hosted: Queue and workers run in Docker containers. You control worker count.
Cloud: Managed queue with auto-scaling workers
Multiple Flow Runs can execute concurrently (limited by worker count and plan)
4. Sequential Step Execution with Data Flow
Activepieces executes steps top-to-bottom in the vertical diagram:
Step 1 (Trigger): Produces data → Stored in execution context    ↓Step 2 (Action): Accesses Step 1 data → Executes → Produces output → Added to context    ↓Step 3 (Action): Accesses Steps 1+2 data → Executes → Produces output → Added to context    ↓Step 4 (Branch): Evaluates condition using any parent data → Routes to branch    ↓...continues until final step or termination
Data Passing Between Steps
All step outputs are stored in a shared execution context (JSON object)
Child steps access ALL parent step outputs — not just the immediately previous step
Data is referenced via {{step_name.field}} syntax in the Data to Insert panel
Parent-to-child only — downstream steps cannot access sibling branch data that didn’t execute
5. Action Execution Details
For each action step, the worker:
Resolves dynamic fields — replaces {{}} tokens with values from the execution context
Retrieves connection — fetches encrypted OAuth/API credentials from the database
Refreshes tokens if OAuth2 token is expired
Executes the piece logic — runs the TypeScript code defined in the piece
Makes HTTP API calls to the target app
Parses the response — handles JSON, XML, or binary data
Stores output in the execution context for downstream steps
Logs the step result
6. Built-In Logic Execution
Logic Block
Runtime Behavior
Branch
Evaluates the condition using execution context. Only the matching branch’s steps execute. The other branch is skipped entirely.
Loop
Iterates over an array. For each item, the enclosed steps execute once. Loop index and item are added to context.
Delay
Worker schedules a delayed job. The Flow Run pauses. A future worker resumes from the next step after the delay expires.
Code
Spawns a sandboxed VM, runs JavaScript/Python with npm packages, returns output. Unlimited code steps allowed.
HTTP Request
Direct HTTP call with configurable method, headers, body. Response parsed and stored.
Storage
Reads/writes to a key-value store persisted across Flow Runs.
Filter
Evaluates condition. If false → Flow Run stops immediately.
To-Do / Approval
Flow Run enters PAUSED state. A notification is sent. The run waits in the database until a human approves/rejects via the UI. On approval, a worker resumes execution from the next step.
7. Error Handling & Retries
7.1 Automatic Retries
If an action fails, Activepieces retries with exponential backoff
Configurable retry count (default applies)
Handles: network timeouts, 5xx errors, temporary API unavailability
7.2 What Happens on Persistent Failure
After retries are exhausted, the Flow Run is marked “Failed”
The specific step that failed is highlighted in the execution log
Subsequent steps do not execute for that run
User can inspect the failed step, fix the configuration, and replay from that step
7.3 Error Types
Auth errors → Immediate fail, requires reconnecting the piece
Validation errors (400) → Immediate fail, fix mapping/config
Rate limits (429) → Retried with backoff
8. Credit Billing Metering
Activepieces uses a credit system:
Event
Credits Consumed
Flow Run (regardless of step count)
1 credit
Each step inside a flow
FREE (included in the 1 credit)
Agentic action
1 credit
AI step — Fast model
2 credits
AI step — Smart model
10 credits
AI step — Frontier model
20 credits
AI step — Bring your own key
1 credit
Free plan: Daily credit refresh. If exhausted, flows stay ON but new runs queue until tomorrow.
Plus/Team: Pay-as-you-go overage at ~$0.007 per extra credit
Self-hosted Community: Unlimited runs, zero credits — no metering at all
9. Logging & Monitoring
Execution History
Every Flow Run is logged in the dashboard with:
Step-by-step status (success/failed/paused)
Input/output data for each step
Execution time per step
Error messages with stack traces
Self-hosted: Unlimited log retention (depends on your database)
Cloud: 90 days retention
Replay & Debugging
Test individual steps before publishing
Replay failed runs from any step after fixing the issue
Version rollback — revert to any previous published version instantly
10. Security During Execution
Credentials encrypted with 256-bit keys
OAuth2 tokens refreshed automatically
Self-hosted: Data never leaves your infrastructure
Cloud: TLS 1.2+ in transit, encrypted at rest
Data masking: Sensitive fields can be masked in logs
Audit logs (Enterprise): Who changed what, when
11. Self-Hosted Runtime Specifics
When you self-host Activepieces:
Component
Role
App (API + UI)
Serves the web interface and REST API
Worker
Picks up jobs from the queue and executes flows
Queue (Redis)
Holds pending Flow Runs
Database (PostgreSQL)
Stores flows, connections, execution logs, versions
Scheduler
Cron service that fires polling/schedule triggers
Horizontal scaling: Add more Worker containers to process more Flow Runs concurrently
No limits: Unlimited flows, runs, users, pieces
Trade-off: You manage uptime, backups, updates, and infrastructure
12. What Happens When You Unpublish a Flow
Webhooks are deregistered from source apps
Polling jobs are stopped
Schedule triggers are removed from the cron scheduler
Flow Runs already in the queue continue processing
No new Flow Runs are created until republished
Part 3: Side-by-Side Runtime Comparison
Aspect
Zapier
Activepieces
Execution Model
Cloud serverless workers
Queue-based async workers (cloud or self-hosted)
Trigger → First Action Latency
Webhook: near-instant; Polling: 1–15 min
Webhook: near-instant; Polling: configurable
Step Execution
Strictly sequential
Sequential with full context access to all parents
Max Steps
100 steps per Zap
No hard limit (practical limits based on memory/timeout)
Branching Depth
Max 3 nested Paths, 10 branches each
Unlimited Branch nodes
Code Steps
Max 2 per Zap (JS/Python)
Unlimited (JS/Python + npm)
Human Approval
Not native — requires third-party workaround
Built-in To-Do/Approval — flow pauses and resumes
Auto-Retries
3 retries over ~1 hour
Configurable exponential backoff
Billing Unit
Per successful action (Task)
Per flow run (1 credit = 1 run, unlimited steps)
Failed Run Behavior
Stops, logs error, can replay
Stops, highlights failed step, can replay from that step
Execution History
30 days (free), 90 days (paid)
90 days (cloud), unlimited (self-hosted)
Concurrency
Managed by Zapier (opaque)
Controlled by worker count (transparent in self-host)
Data Storage During Run
Step output frozen per Task
Shared execution context, all parent data accessible
AI Step Runtime
AI by Zapier (OpenAI only)
Multi-provider (OpenAI, Claude, Google, custom)
Where It Runs
Zapier’s cloud only
Your cloud or self-hosted infrastructure
Pause/Resume
Delay steps only
Delay + Approval/To-Do (human pause)
Versioning
No workflow versioning
Full version history with one-click rollback
Scale Ceiling
3 billion+ tasks/month platform-wide
Limited by your worker infrastructure (unlimited in theory)
Part 4: Complete End-to-End Example — Same Event on Both Platforms
Event: A customer submits a Typeform. Deal value = $15,000.
Zapier Runtime Log
[T+0ms]   Webhook received from Typeform → Task created[T+50ms]  Step 1 (Trigger): Parsed form data → {name, email, budget: 15000}[T+200ms] Step 2 (AI by Zapier): Called OpenAI API → Summary generated[T+2.5s]  Step 3 (HubSpot): Created contact → Contact ID returned[T+3.1s]  Step 4 (Slack): Posted message to #sales[T+3.2s]  Step 5 (Filter): budget > 10000? → TRUE[T+3.3s]  Step 6a (Path A): Attempted "Send email to manager"          → FAILED: No native approval mechanism          → ERROR logged, Zap stopped          → 6 Tasks consumed (Trigger free + 5 actions + Filter)[T+3.3s]  Email notification sent to Zap owner
Activepieces Runtime Log
[T+0ms]   Webhook received from Typeform → Flow Run #4821 queued[T+80ms]  Worker picks up job[T+120ms] Step 1 (Trigger): Parsed form data → context.budget = 15000[T+300ms] Step 2 (OpenAI): Called GPT-4o → context.summary = "..."[T+2.8s]  Step 3 (HubSpot): Created contact → context.contact_id = "123"[T+3.4s]  Step 4 (Slack): Posted message to #sales[T+3.5s]  Step 5 (Branch): budget > 10000? → TRUE branch selected[T+3.6s]  Step 6a (To-Do): Created approval task for Sales Manager          → Flow Run #4821 status: PAUSED          → 1 credit consumed so far[...waits 4 hours...][T+4h]    Manager clicks "Approve" in UI[T+4h+50ms] Worker resumes from Step 6b[T+4h+300ms] Step 6b (HubSpot): Updated contact status → "Hot Lead"[T+4h+400ms] Flow Run #4821 status: SUCCEEDED          → Total: 1 credit for entire run
Summary
What Happens
Zapier
Activepieces
Trigger fires
Creates a Task in Zapier’s cloud queue
Creates a Flow Run in the execution queue
Worker picks it up
Zapier’s managed serverless worker
Your worker (self-hosted) or managed worker (cloud)
Steps execute
One by one, left-to-right in the editor
One by one, top-to-bottom in the diagram
Data moves
Step output → next step’s input via data picker
All parent outputs available to all children via context
If an action fails
3 auto-retries → then error → stop
Auto-retries → then error → stop → can replay
If human needed
No native pause — must fail or use workaround
Native pause (To-Do/Approval) → resume later
You get billed
Per successful action (Task)
Per flow run (1 credit = unlimited steps)
You monitor
Task History (30–90 days)
Execution logs (90 days cloud / unlimited self-hosted)
Where data lives
Zapier’s servers only
Your choice: Activepieces cloud OR your own servers
User:
also giv eme fulll featuer info how all integartoins and connections and wokrs hrer with wokrflwo wiht how connect and then usr full feature expanatoin
Kimi:
Here is the complete feature breakdown of how integrations, connections, and workflows work together in Activepieces — from the framework level down to the exact user experience.
Part 1: The Integration Framework — “Pieces”
1. What Is a Piece?
A Piece is Activepieces’ name for an integration. Every app connector is a TypeScript npm package that defines:
Authentication methods — how users log in to that app
Triggers — events that start flows (e.g., “New Email”)
Actions — tasks the app can perform (e.g., “Send Message”)
Input properties — the form fields users fill when configuring a trigger or action
2. Piece Types
Type
What It Is
Examples
Official Pieces
Built and maintained by the Activepieces team
Gmail, Slack, HubSpot, OpenAI, Google Sheets
Community Pieces
Contributed by the open-source community
~60% of all pieces are community-built
Private Pieces
Custom pieces built by your team, not published publicly
Internal company APIs, proprietary tools
HTTP Piece
Generic connector to any REST API
Call any endpoint with custom headers/body
3. How Pieces Are Built (Developer View)
Pieces are written in TypeScript and published to npmjs.com. Once published, they automatically appear in the Activepieces piece catalog. The framework supports:
Hot reloading during local development
Custom npm packages inside code steps
Open-source contribution — anyone can build and publish a piece
Part 2: Authentication & Connections — How Apps Connect
4. Supported Authentication Methods
Every piece declares what type of authentication it requires. Activepieces supports five auth types:
Auth Type
How It Works
Best For
OAuth 2.0
Standard redirect flow. User clicks “Connect,” gets redirected to the app’s OAuth screen, grants permissions, and is sent back to Activepieces with a token.
Google, Slack, HubSpot, Salesforce, Microsoft 365
API Key
User generates an API key in the target app and pastes it into Activepieces. Stored encrypted.
CometAPI, Stripe, SendGrid, internal tools
Secret Text
A generic secret string (like a webhook secret or bearer token).
Webhook signatures, custom services
Basic Auth
Username + password, Base64-encoded in the Authorization header.
Legacy systems, internal databases
Custom Auth
Fully flexible — define your own fields (e.g., API key + subdomain + region).
Complex enterprise APIs, multi-tenant services
4.1 OAuth 2.0 Flow in Detail
User clicks "Create Connection" on a piece    ↓Activepieces opens a popup with the app's OAuth URL    ↓User logs into the app and clicks "Authorize"    ↓App redirects back to Activepieces with an authorization code    ↓Activepieces exchanges the code for an access token (+ refresh token)    ↓Token is encrypted with 256-bit keys and stored in the database    ↓Connection is labeled with a human-readable identifier (e.g., "john@company.com")
4.2 API Key Flow in Detail
User opens a piece that uses API key auth    ↓Clicks "Create Connection"    ↓Enters the API key (copied from the target app's dashboard)    ↓Optionally adds a display name (e.g., "Production Stripe Key")    ↓Activepieces encrypts and stores the key    ↓Connection is available across all flows in the project
4.3 Connection Identifier
Every connection gets a human-readable label so you can tell which account it is: - For OAuth: automatically derived from the token’s claims (email, name, workspace) - For API keys: uses whatever display name the user entered - Developers can define custom getConnectionIdentifier logic in the piece code
5. Connection Management
5.1 Where Connections Live
Connections are stored per project (or globally, depending on setup)
They are reusable — connect Gmail once, use it in 50 different flows
Each connection is encrypted at rest with 256-bit encryption
5.2 Connection Status
Active — token/key is valid, ready to use
Expired — OAuth token expired and refresh failed (user must reconnect)
Error — API key revoked or invalid
5.3 Reusing Connections
When building a flow, after you add a piece action, you see a dropdown: - “Create new connection” — set up a new auth - “Select existing connection” — pick from previously connected accounts
This means you never have to re-authenticate the same app twice.
5.4 Security Notes
API keys entered in the Connection section are encrypted
API keys typed directly into HTTP request headers (in a Code or HTTP step) are not encrypted — they are visible in the flow editor
Best practice: always use the piece’s built-in auth or the Connections system
Part 3: The User Experience — From Signup to Live Automation
6. Step-by-Step: Building Your First Flow
Step 1: Sign Up & Dashboard
Sign up for Activepieces Cloud (free, no credit card) or self-host via Docker
Land on the Dashboard showing your projects, flows, and templates
Step 2: Create a New Flow
Click “+ New Flow” or “Create Flow”
Choose:
From Scratch — blank canvas
From Template — 200+ pre-built templates (lead routing, reporting, content repurposing)
Step 3: Add a Trigger
The builder opens with an empty Trigger slot at the top
Click it → search for an app (e.g., “Gmail”)
Select the trigger event (e.g., “New Email Received”)
Connect your account — this is where OAuth or API key auth happens (see Section 4)
Configure trigger options (e.g., only emails with label “Invoices”)
Load Sample Data — Activepieces pulls a real recent email from your account so you can see exactly what data fields are available (subject, body, sender, attachments, etc.)
Step 4: Add Actions
Click the + button below the trigger
Search for an app (e.g., “Slack”)
Select the action (e.g., “Send Channel Message”)
Select an existing connection or create a new one
Map data — click into any input field, the Data to Insert panel pops up showing all fields from previous steps:
Channel: #salesMessage: New lead from {{trigger.sender}}: {{trigger.subject}}
Mix static text with dynamic data freely
Step 5: Add Logic (Optional)
Between actions, add logic blocks by clicking + and selecting: - Branch — If/Else split based on conditions - Loop — Repeat for each item in a list - Delay — Wait X minutes/hours/days - Code — Run JavaScript/Python with npm support - HTTP Request — Call any API directly - To-Do / Approval — Pause for human input
Step 6: Test
Click Test on any individual step — runs it with sample data
Or click Test Flow — simulates the trigger and runs the entire sequence
Inspect the output of each step in real time
Step 7: Publish
Click Publish — the flow goes live
The trigger starts monitoring (webhooks registered or polling begins)
Every publish creates a new version — you can roll back anytime
Part 4: How Data Flows Through Connected Apps
7. The Data Pipeline
┌─────────────────────────────────────────────────────────────┐│  TRIGGER APP (e.g., Gmail)                                   ││  • Event occurs: "New email received"                         ││  • Gmail sends webhook OR Activepieces polls Gmail API        │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  ACTIVEPIECES TRIGGER STEP                                   ││  • Receives raw event data (JSON)                           ││  • Parses and normalizes it                                   ││  • Stores in execution context as: trigger.subject,          ││    trigger.body, trigger.sender, trigger.attachments          │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  ACTION 1 (e.g., OpenAI)                                     ││  • Accesses: {{trigger.body}}                                 ││  • Sends to OpenAI API using stored connection token           ││  • Receives AI summary                                       ││  • Stores in context: step_2.summary                         │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  ACTION 2 (e.g., Slack)                                      ││  • Accesses: {{trigger.sender}} + {{step_2.summary}}         ││  • Sends message to Slack API using stored connection        ││  • Receives confirmation (message ID, timestamp)             ││  • Stores in context: step_3.message_id                      │└────────────────────────┬────────────────────────────────────┘                         ↓┌─────────────────────────────────────────────────────────────┐│  ACTION 3 (e.g., HubSpot)                                    ││  • Accesses: {{trigger.sender}}, {{step_2.summary}}          ││  • Creates contact via HubSpot API using stored connection   ││  • Receives contact ID                                       ││  • Flow completes successfully                               │└─────────────────────────────────────────────────────────────┘
8. Key Data Flow Rules
Rule
Explanation
Parent-to-Child Only
A step can only access data from steps above it in the diagram
All Parent Data Available
Step 5 can access outputs from Steps 1, 2, 3, and 4 — not just Step 4
Immutable Per Run
Once a step executes, its output is frozen for that run
Nested Objects
Click the caret (⌄) in the Data to Insert panel to drill into nested JSON fields
Part 5: Advanced Connection Features
9. API Connector (Custom Integrations)
When no pre-built piece exists for an app, use the API Connector:
Add an HTTP Request step or a Code step
Enter the API endpoint, method, headers, and body
For auth, either:
Use a stored Connection (if you created a custom auth piece)
Or enter the API key directly in the header (less secure, visible in editor)
Parse the JSON response and map fields to subsequent steps
10. Global Connections vs. Project Connections
Type
Scope
Use Case
Global Connection
Available across all projects in the workspace
Shared services (company Slack, main CRM)
Project Connection
Only available within one project
Client-specific accounts, sandbox environments
11. Connection Health & Token Refresh
OAuth tokens are refreshed automatically before each API call if expired
If refresh fails, the connection status changes to “Error” and the flow run fails
Users receive notifications to reconnect the app
API keys never expire unless revoked in the source app
12. MCP (Model Context Protocol) & Connections
All Activepieces pieces are exposed as MCP servers: - Your AI assistant (Claude, Cursor, Windsurf) can call any connected app through Activepieces - The AI uses the same connections you’ve already set up - Example: “Send an email to john@company.com” → Claude calls the Gmail MCP tool → Activepieces uses your stored Gmail connection → email sends
Part 6: Complete Feature Summary Table
Feature
How It Works
Piece Catalog
640+ pre-built integrations, searchable in the builder sidebar
Auth Methods
OAuth 2.0, API Key, Secret Text, Basic Auth, Custom Auth
Connection Storage
Encrypted with 256-bit keys, reusable across flows
Connection Labels
Human-readable names (email, workspace, custom display name)
Sample Data
Real data pulled from connected apps for testing
Data Mapping
Click any input field → Data to Insert panel shows all parent step outputs
Reusable Connections
Connect once, use in unlimited flows
Custom Pieces
Build in TypeScript, publish to npm, auto-appears in catalog
HTTP Connector
Call any REST API when no piece exists
Token Auto-Refresh
OAuth tokens refreshed automatically before API calls
Connection Errors
Clear status indicators; email notifications when reconnect needed
MCP Integration
All pieces become AI-callable tools via MCP protocol
Security
Encrypted at rest, TLS in transit, data masking in logs
Bottom Line
In Activepieces, integrations are Pieces, connections are encrypted reusable auth sessions, and workflows are vertical diagrams where data flows from parent steps to children. You connect an app once via OAuth or API key, then drag its triggers and actions onto the canvas, map data between steps using the Data to Insert panel, and publish. The platform handles token refresh, encryption, retry logic, and execution — while giving you full visibility into every step’s input and output.
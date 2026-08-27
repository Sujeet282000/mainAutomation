ZAPIER
Complete Feature, Architecture & Implementation Reference
Every Product, Every Feature, Every Integration Step — Extracted Directly From Zapier, With a Full Build-Your-Own-Zapier Architecture
Product, Platform & Engineering Reference — v1.0
Sourced from zapier.com, help.zapier.com, docs.zapier.com and Zapier's public pricing/product pages (2026)
Covers: Zap workflows, Tables, Forms, Interfaces, Canvas, Agents, Chatbots, MCP, SDK, Developer Platform, security/compliance, pricing, and a full production architecture for building an equivalent platform.
Table of Contents
1.  Executive Summary & Company Overview
2.  The Zapier Product Suite — Full Map
3.  Core Concepts & Terminology
4.  Step-by-Step: Building a Zap From Scratch
5.  Triggers — Full Feature Deep Dive
6.  Actions — Full Feature Deep Dive
7.  Built-In Tools (The Utility Apps)
8.  Multi-Step Zaps & Advanced Editor Features
9.  AI by Zapier — Full Feature Deep Dive
10.  Zapier Agents — Full Feature Deep Dive
11.  Zapier Chatbots — Full Feature Deep Dive
12.  Zapier Tables — Full Feature Deep Dive
13.  Zapier Forms — Full Feature Deep Dive
14.  Zapier Canvas — Full Feature Deep Dive
15.  Zapier Interfaces — Full Feature Deep Dive
16.  Zapier MCP — Full Feature Deep Dive
17.  Zapier SDK — Full Feature Deep Dive
18.  Developer Platform (Powered by Zapier)
19.  The App Directory — 9,000+ Integrations
20.  Connections & Authentication
21.  Zapier's Internal System Architecture
22.  Runtime Execution — What Happens When a Zap Runs
23.  Task Billing & Metering — Full Rules
24.  Security, Compliance & Enterprise Governance
25.  Admin, Teams & Collaboration
26.  Pricing — Full Plan-by-Plan Breakdown
27.  Templates & Use-Case Library
28.  End-to-End Reference Workflows
29.  Building Your Own Zapier — Reference Architecture
30.  Appendix — Glossary & FAQ
1. Executive Summary & Company Overview
Zapier is an American software company providing business-process automation and application-integration services, founded in 2011 in Columbia, Missouri by Wade Foster, Bryan Helmig, and Mike Knoop, and launched publicly in 2012 through Y Combinator. Zapier is a fully remote, distributed company headquartered nominally in San Francisco, with roughly 730 employees as of 2025.
Zapier now describes itself as “the infrastructure for AI-powered automation”: it connects a user's apps, data, and processes to the AI models teams already use — ChatGPT, Claude, Gemini, and others — so people can build automations wherever they work, while Zapier centrally runs and governs everything.
Scale, as published by Zapier
9,000+ integrated apps in the directory — the largest catalog of any automation platform
Raw API access to 3,000+ apps via the Zapier SDK for coding agents and developers
No-code, low-code, and full-code tools in a single platform
A single shared task pool spans Zap workflows, AI steps, Code, MCP, and SDK usage
This document's purpose
This reference extracts and organizes every publicly documented Zapier feature — product by product, screen by screen, setting by setting — into a single implementation-grade reference. It closes with a full technical architecture (Section 29) for engineering teams who want to design and build a production platform with equivalent capability.
2. The Zapier Product Suite — Full Map
As of 2026, Zapier organizes its offering into a core automation platform plus a set of adjacent products that all draw from the same underlying task pool and app connections.
Product
What It Does
Zap workflows
Trigger-and-action automations connecting 9,000+ apps; supports filters, paths, loops, webhooks, scheduling, and AI steps
Zapier MCP
Connects AI clients (Claude, ChatGPT, Cursor, etc.) to a user's Zapier apps via the Model Context Protocol, available on every plan
Zapier SDK
Gives coding agents and developers authenticated, code-level access to 9,000+ apps, including raw API access to 3,000+ apps; free during open beta
Tables
A built-in database for automation: store, manage, and act on structured data, and use it as a knowledge source for AI
Forms
Hosted, brandable forms and pages that trigger workflows; the only market product connecting a form directly to 9,000+ integrations
Interfaces
No-code web-app builder for portals, forms, kanban boards, link pages, and AI/chat components wired to Zaps and Tables
Canvas
AI-assisted diagramming tool to plan, document, and visualize workflows and systems
Agents
Autonomous AI teammates that proactively monitor for triggers and take multi-step action across connected apps
Chatbots
Custom AI chatbots with configurable instructions/knowledge that can trigger Zap automations from a conversation
Developer Platform (Powered by Zapier)
Lets companies embed Zapier's automation and 9,000+ integrations directly inside their own product via a Workflow API
2.1 Zapier by Company Size
Segment
Zapier's Positioning
Startups
Fast time-to-value automations to replace manual ops work before headcount exists to do it manually; startup-friendly free trial and Free plan on-ramp
Small & Medium Business
Team plan collaboration features (shared connections, shared workspace) to coordinate automation across a growing staff without a dedicated ops/engineering team
Enterprise
Governance-first: SSO, SCIM, audit logs, custom data retention, and admin controls so IT/security can safely let many employees build automations, agents, and MCP-connected AI at once
2.2 How the Products Interconnect
A Zap can read from and write to Tables, be triggered by a Form submission, be visualized in Canvas, and be called as a tool from an Agent, a Chatbot, or an external MCP client.
All usage — Zap tasks, AI model calls, Code runtime, MCP tool calls, and SDK action calls — draws from one shared, plan-based task allocation.
Agents and Chatbots have their own separate metering (“activities” and per-tier chatbot limits respectively) layered on top of the core platform.
3. Core Concepts & Terminology
Term
Definition
App
A web service or application Zapier can connect to (e.g., Gmail, Slack, Salesforce); 9,000+ apps are supported
Zap
An automated workflow that connects apps: one trigger plus one or more actions. Turning a Zap on makes it run its action steps every time the trigger event fires
Trigger
The event that starts a Zap (e.g., “New Lead”). Triggers never consume tasks
Action
An event that happens automatically after the Zap is triggered (e.g., “Send Slack Message”). Each successful action consumes one task (rates can vary by step type)
Task
The billing unit: consumed whenever a Zap successfully moves data or completes an action. Failed actions do not consume a task
Zap Editor
The visual, step-based interface used to build, test, and publish a Zap
Connection
An authenticated, reusable link between Zapier and an app account (OAuth, API key, or other credential)
Premium App
An app that requires a paid Zapier plan to use
Zap History
The execution log for a Zap, showing every run, its status, and the data in/out of each step
Draft
An unpublished, in-progress Zap that cannot yet run
Version
A named, restorable snapshot of a Zap's configuration created whenever meaningful changes are saved
4. Step-by-Step: Building a Zap From Scratch
This section walks every screen of the Zap creation flow exactly as a user experiences it, from account sign-in to a published, live automation.
4.1 Step 1 — Start a New Zap
1.	Sign in to your Zapier account and open the dashboard.
2.	In the left panel, select Create, then select Zaps — or choose a pre-built template from the Explore/Templates gallery to start pre-filled.
3.	Name the Zap by clicking the editable title in the top-left corner of the builder.
4.2 Step 2 — Configure the Trigger
1.	Select the Trigger step and search for the app that should start the Zap (e.g., “Gmail”).
2.	Choose the Trigger event from that app's list (e.g., “New Email”, “New Row”, “New Lead”).
3.	Connect the account: sign in via OAuth, or paste an API key/token, depending on what the app requires.
4.	Configure trigger-specific fields in the Setup panel (e.g., which folder, label, or spreadsheet to watch).
5.	Select Continue, then Test trigger — Zapier pulls a real, recent record from the connected account so you can see the exact fields available downstream.
4.3 Step 3 — Add and Configure an Action
1.	Select the + icon below the trigger to add an Action step.
2.	Search for and select the action app (e.g., “Slack”).
3.	Choose the Action event (e.g., “Send Channel Message”).
4.	Connect or select an existing authenticated account for that app.
5.	Map fields: click into any input box and a data-picker panel shows every field returned by upstream steps; click a field to insert it, or type “/” to search available fields; mix static text and dynamic data freely.
6.	Select Continue, then Test step — the action runs once, live, using the sample data, and shows the returned output.
4.4 Step 4 — Add More Steps (Optional)
Repeat the action-adding process for as many downstream steps as the workflow needs (multi-step Zaps, Professional plan and above).
Insert built-in tools (Filter, Paths, Formatter, Delay, Sub-Zap, Looping) between any two steps by clicking the + icon and choosing them instead of an app.
4.5 Step 5 — Test and Publish
1.	Test individual steps at any point using the Test button on that step, or use Test Zap to simulate the trigger and run every step in sequence.
2.	Review the output of each step inline before proceeding.
3.	Select Publish (top-right of the editor).
4.	The Zap moves from Draft to On: webhooks are registered with source apps and/or polling begins at the plan's configured interval.
5.	Every future publish creates a new Version; any prior version can be restored (Team/Enterprise: Compare Versions).
4.6 Viewing Results
Navigate to Zaps in the dashboard to see every Zap's on/off state and last-run status.
Open Zap History for a step-by-step log of every run: input data, output data, timing, and any errors, with the option to Replay a specific run.
5. Triggers — Full Feature Deep Dive
5.1 Trigger Mechanisms
Mechanism
How It Works
Latency
Instant / Webhook
The source app pushes an HTTP POST to a unique Zapier URL the moment the event occurs
Near real-time
Polling
Zapier calls the app's API on an interval and compares results to a stored cursor/timestamp to find new items
15 min (Free) down to 1 min (Team/Enterprise)
Scheduled
Zapier fires on a cron-like interval (every N minutes/hours, specific days/times) with no external event needed
Exact, per schedule
Manual / Webhook (Catch Hook)
A generic inbound webhook endpoint (“Webhooks by Zapier → Catch Hook”) that any external system or script can POST to directly
Near real-time
5.2 Trigger Configuration Options
Trigger event selection specific to the chosen app (each app defines its own list of supported triggers)
Field-level Setup options (e.g., which folder/list/pipeline/channel to watch)
Sample data loading — Zapier fetches real, recent records so the builder can see and map exact field names and types
Multiple trigger accounts — a Zap can be re-pointed at any previously connected account for that app
5.3 Polling Interval by Plan
Plan
Polling Interval
Free
15 minutes
Professional
2 minutes
Team
1 minute
Enterprise
1 minute
Checking (polling) for new data never consumes a task — only a successfully completed action consumes a task.
6. Actions — Full Feature Deep Dive
6.1 Action Types
Create actions — create a new record/object in the target app (e.g., “Create Contact”)
Update actions — modify an existing record
Search actions — find an existing record to use its data in later steps (“Search” or “Find” events), essential in multi-step Zaps when needed data isn't present in the trigger
Search-or-Create actions — search first, and create a new record only if nothing is found
Custom Actions — AI-assisted, user-defined actions built against an app's API when no pre-built action covers the need
6.2 Configuring an Action — Full Flow
1.	Add the action step and choose the app and event.
2.	Connect or select an account.
3.	Map each input field using the data-picker: click a field name from any prior step to insert a live reference, or type static text.
4.	Use inline formulas directly inside a field (transform data without a separate Formatter step) where supported.
5.	Test the step to confirm the live API call succeeds and inspect the returned payload.
6.3 Input Field Types You'll Encounter
Field Type
Behavior
Static Dropdown
A fixed list of choices defined by the app's integration (e.g., a status enum)
Dynamic Dropdown
Populated live from the connected account (e.g., “choose a Slack channel” fetches your actual channels)
Search Field
Lets you type to search a connected app's records and pick one as the field's value
Line Item / Array Field
Accepts multiple values (e.g., multiple product line items on an order), often paired with Looping or the Formatter Line Itemizer
Subfields
A nested group of fields representing one structured object (e.g., a billing address block)
File Field
Accepts an uploaded file or a file reference/URL from an upstream step
Checkbox / Boolean
A true/false toggle
Free Text / Long Text
Open text entry, supports mixing static text and {{dynamic}} fields, including multi-line content
6.4 AI Custom Actions
AI Custom Actions let a user describe, in plain language, what they want an action to do against a connected app's API; Zapier's AI assists in generating the correct API call, fields, and mapping without the user hand-writing the integration.
7. Built-In Tools (The Utility Apps)
Zapier ships a set of first-party “apps” that provide logic, data-shaping, and flow-control inside any Zap. None of these count as a task when they execute.
Tool
Function
Filter by Zapier
Stops the Zap unless the data passing through matches specified conditions — the Zap simply does not continue for that run
Paths by Zapier
If/then branching into up to multiple parallel paths (interactive editor supports up to 10 paths) based on conditions evaluated against the trigger/action data
Formatter by Zapier
Text, date/time, numeric, and utility transformations (e.g., reformat a date, title-case a string, extract a number) applied inline to any field; “Formatter with AI” adds AI-assisted transformations
Delay by Zapier
Pauses the Zap for a fixed duration or until a specific date/time before continuing
Looping by Zapier
Iterates over a list of items, running the downstream steps once per item
Sub-Zap by Zapier
Calls another Zap as a reusable sub-routine from within the current Zap
Digest by Zapier
Collects trigger data over time and delivers it as a single batched summary on a schedule you define
Schedule by Zapier
Fires a Zap on a recurring schedule with no external trigger app needed
Storage by Zapier
A simple key-value store for persisting small values between Zap runs
Zapier Manager
Meta-triggers/actions on your own Zapier account activity (e.g., trigger when a Zap turns off, or when you approach your task limit)
Webhooks by Zapier
Generic inbound (Catch Hook) and outbound (POST/GET/PUT) HTTP requests to/from any endpoint that doesn't have a dedicated app
Email Parser by Zapier
Extracts structured data out of incoming emails using a trained parsing template, turning unstructured email into usable fields
Transfer by Zapier
One-time or scheduled bulk migration of existing/historical data between two apps, rather than only new events going forward
7.1 Setting Up Each Built-In Tool — Step by Step
Filter by Zapier
1.	Add a step and search for “Filter by Zapier” instead of an app.
2.	Choose the field to check (e.g., {{trigger.amount}}).
3.	Choose a condition (e.g., “Greater than”) and enter the comparison value.
4.	Add additional AND/OR condition rows if needed, then save — the Zap will now stop silently for any run that doesn't match.
Paths by Zapier
1.	Add a Paths step; Zapier creates an initial Path A and Path B branch.
2.	For each path, define one or more rules (field/condition/value) that must all be true.
3.	Add up to 10 total paths using the interactive branch editor; each path can contain its own multi-step sequence of actions.
4.	Optionally mark one path as a fallback (“else”) to catch any run that matches none of the explicit paths.
Formatter by Zapier
1.	Add a Formatter step and choose a category: Text, Numbers, Date / Time, or Utilities.
2.	Choose the specific transform (e.g., “Date / Time → Format”, “Text → Titlecase”, “Utilities → Line Itemizer”).
3.	Map the input field, set any transform-specific options (e.g., target date format string), and test.
4.	Reference the Formatter step's output in any later step just like any other step's data.
Delay by Zapier
Delay For — pause a fixed duration (minutes, hours, days) before continuing.
Delay Until — pause until an exact date/time, optionally computed from a field (e.g., “3 days after {{due_date}}”).
Looping by Zapier
1.	Add a Looping step and choose the source: a line-item field, a comma-separated value, or a fixed number of iterations.
2.	Every step placed after the Loop step re-runs once per item; use {{loop.value}} / {{loop.index}} to reference the current item.
Sub-Zap by Zapier
1.	Create the reusable child Zap first (a normal Zap that starts with a “Sub-Zap” trigger and accepts defined input fields).
2.	In the parent Zap, add a “Call Sub-Zap” action, choose the child Zap, and map its required inputs.
Digest by Zapier
1.	Add a Digest step and give it a unique Digest Name (multiple Zaps can feed the same digest).
2.	Choose a delivery schedule (e.g., daily at 9am, or every Friday) and a sort order for collected entries.
3.	Map the fields to include in each digest entry; on the scheduled delivery time, all entries collected since the last delivery are released as one combined output for downstream steps (e.g., one email listing every lead from the week).
Schedule by Zapier
Choose a frequency (every N minutes/hours/days/weeks/months) and specific time-of-day/day-of-week as needed — no external app is required to start the Zap.
Storage by Zapier
Set a value: define a key and a value to persist between runs (e.g., a running counter or a “last processed ID”).
Get a value: retrieve a previously stored value by key in a later run or a different Zap entirely.
Zapier Manager
Triggers include events like “Zap Turned Off” (e.g., due to repeated errors) or nearing the account's task limit — useful for meta-monitoring your own automation health.
Webhooks by Zapier
1.	As a trigger: choose “Catch Hook”, copy the generated unique URL, and configure any external system to POST JSON to it.
2.	As an action: choose “POST”, “GET”, or “PUT”, enter the target URL, headers, and body, mapping in data from prior steps.
Email Parser by Zapier
1.	Create a parser mailbox and get its unique forwarding address.
2.	Forward (or auto-forward) a sample email to that address.
3.	Highlight the pieces of the email you want extracted (e.g., order number, customer name) to train the parsing template.
4.	Use “Email Parser by Zapier → New Email” as a trigger in any Zap, with each highlighted piece available as its own field.
Transfer by Zapier
Choose a source app/object (e.g., all existing Trello cards) and a destination app/object (e.g., a Table).
Map fields once, then run the transfer as a one-time backfill or on a recurring schedule for ongoing bulk sync, separate from a normal event-by-event Zap.
8. Multi-Step Zaps & Advanced Editor Features
8.1 Multi-Step Workflows
Free plan: two-step Zaps only (one trigger, one action)
Professional and above: unlimited multi-step Zaps with Filters, Paths, and Formatter available inline
8.2 Zap Management Features
Feature
What It Does
Drafts
Work-in-progress Zaps saved automatically before publishing
Versions
Every meaningful save creates a restorable snapshot; Team/Enterprise can Compare Versions side by side
Autoreplay
Automatically retries a failed action step rather than requiring a manual replay (Professional+)
Custom error notifications
Configure who is emailed, and under what conditions, when a Zap errors
Custom polling time
Override the plan default and set a specific polling cadence per Zap (higher plans)
Flood protection settings
Guard rails to stop a Zap from running away (e.g., an accidental infinite loop) and consuming excessive tasks
Global variables
Reusable, named values referenceable across every Zap in an account
Custom test records
Define your own sample payloads for testing instead of relying only on live pulled data
Alerts
Proactive notifications on Zap health and run outcomes
8.3 Code by Zapier
Code by Zapier runs custom JavaScript or Python directly inside a Zap step, with access to thousands of npm and PyPI packages, AI-assisted code generation, and (for JavaScript) the Zapier SDK for calling connected-app actions from inside your code. Included runtime per step scales by plan: 1 second (Free) up to 2 minutes (Enterprise). Zapier Functions, a previous standalone code product, is deprecated as of September 1, 2026 in favor of Code by Zapier.
9. AI by Zapier — Full Feature Deep Dive
9.1 AI Steps in a Zap
Add an “AI by Zapier” action step to summarize, classify, draft, extract data, or make decisions using an LLM, using data from any prior step in the prompt
Connect your own AI provider account (bring-your-own-key) to power AI steps at the lowest task rate
Build AI agents that work across connected apps autonomously (see Section 10, Zapier Agents, for the dedicated product)
9.2 Model-Tier Pricing (effective June 15, 2026)
Tier
Base Cost Per Run
Notes
Standard
1x tasks
No tool calls available
Advanced (default)
3x tasks
Allows tool calls; default tier for new steps
Premium
5x tasks
Tool calls plus more sophisticated reasoning
Bring your own AI account
1x task (flat)
Uses your own connected model API key
Tool calls made by an AI step add to the base cost at the same per-tier rate.
A per-step safety limit pauses the Zap and asks for approval if a single run reaches 75 tasks, protecting against runaway usage.
9.3 Zapier Copilot
Copilot is a conversational assistant embedded in the Zap editor: describe an automation in plain language and Copilot proposes a draft Zap — trigger, steps, filters, and field mappings — which the user can then refine manually.
9.4 AI Guardrails by Zapier
AI Guardrails screen AI-generated output for safety and policy compliance before it is allowed to flow into downstream steps, giving teams a governance checkpoint over model output used in production automations.
9.5 AI in Tables
AI fields — a prompt run against every row of a column (including existing rows); if a referenced field changes, the AI field automatically regenerates so output never goes stale
AI enrichment — a table-level prompt that fills multiple columns of a newly added row based on one seed value (does not backfill existing rows)
9.6 AI Custom Actions & Formatter with AI
AI Custom Actions: describe an action in plain language and AI assists in building the correct API call against a connected app
Formatter with AI: AI-assisted data transformations inside the Formatter tool for cases plain formulas can't easily express
10. Zapier Agents — Full Feature Deep Dive
Zapier Agents (originally launched as Zapier Central in March 2024, rebranded to Agents in January 2025, reaching general availability in December 2025) let a user create custom AI agents by describing what they want in plain language. Unlike a chat-only assistant, Agents proactively monitor for triggers and take action automatically.
10.1 The 2026 Agent Model
As of the May 2025 product change, Agents focus on automation rather than pure chat; you can still chat with an agent, but its primary job is running automations.
“Behaviors” (the earlier sub-unit of an agent) were removed — each behavior became its own individual Agent.
Multiple related Agents can be grouped into a Pod so their activity can be reviewed together, separate from other Agents.
Agents can be versioned and published, with the ability to manage and roll back agent versions.
10.2 Capabilities
Proactive monitoring for triggers (not just responding when prompted)
Live data sources the agent can query at run time
Web browsing for information the agent doesn't already have
Action execution across any app the user has connected, limited strictly to the triggers/actions already set up for that connection
Interaction via the Chrome extension in addition to the web app
10.3 Use Cases Advertised by Zapier
Department
Example Agent Use
Sales
Lead qualification, CRM record updates
Customer Support
Ticket triage, response drafting
Marketing
Content creation, campaign monitoring
Operations
Meeting prep, data synchronization
HR
Onboarding automation, hiring workflows
10.4 Anatomy of an Agent Interaction
User (in chat or via a monitored trigger):  "A new deal just closed in HubSpot over $50k."Agent reasoning loop:  1. Detect the trigger condition (deal stage = Closed Won, amount > 50000)  2. Consult live data source: look up the account owner and territory  3. Decide on actions: notify Finance, create an onboarding Table row,     schedule a kickoff task  4. Execute each action using the user's already-connected app accounts  5. Log the full activity trail for review inside the Agent's PodResult: three downstream actions taken with no additionalmanual step from the user, fully visible in the Agent's activity log.
10.5 Agents Plans
Plan
Price
Included
Agents Free
$0 forever
400 activities/month, live data sources, web browsing, Chrome extension
Agents Pro
$33.33/mo billed annually ($400/yr)
1,500 activities/month plus Free-tier capabilities
Agents Enterprise
Contact sales
Custom activity volume, org-wide agent sharing, enterprise audit logs, restricted-app support
An “activity” is any action an agent takes in a behavior/automation or in chat, including browsing the web or consulting attached knowledge. Team accounts share one pooled activity allowance. Agents do not currently support the same app/action restrictions available on an Enterprise Zapier account.
11. Zapier Chatbots — Full Feature Deep Dive
Zapier Chatbots are custom, AI-powered chat assistants that answer questions using your own instructions and knowledge sources, and can trigger Zap automations directly from a conversation.
11.1 Feature Matrix by Plan
Capability
Free
Pro
Advanced
Number of chatbots
2
5
20
Conversation history retained
7 days
14 days
30 days
Models available
GPT-4o mini & GPT-3.5
+ Advanced AI models
+ Advanced AI models
Knowledge connected
500 kB
up to 50 MB
up to 50 MB
Zap button / Keyword actions / Lead collection
Included
Included
Included
Sharing
Public link
Public link + Embed
Public link + Embed + Interfaces sharing
Branding / remove Zapier label
—
Custom theme
Remove Zapier label
11.2 Pricing
Chatbots Free — $0 forever, up to 2 bots
Chatbots Pro — $13.33/mo billed annually ($160/yr), up to 5 bots
Chatbots Advanced — $66.67/mo billed annually ($800/yr), up to 20 bots
Chatbots Custom — contact sales for more than 20 bots
11.3 How Chatbots Connect to Automation
A chatbot can be configured to call a specific Zap directly (a “Zap button”), fire on detected keywords, collect lead or custom information from the conversation and hand it to a Zap, and be embedded on a website or shared as a link or via Zapier Interfaces.
12. Zapier Tables — Full Feature Deep Dive
Tables is Zapier's built-in database for automation: a spreadsheet-like structure for storing, managing, and acting on data, designed to plug directly into Zap workflows, Forms, and AI steps.
12.1 Limits by Plan
Capability
Free
Professional
Team
Enterprise
Number of Tables
Unlimited
Unlimited
Unlimited
Unlimited
Fields per table
100
100
100
100
Records per account
2,500
100,000
500,000
Contact Sales
Views per table
3
50
50
50+
12.2 Field & Data Features
Formulas — spreadsheet-style computed fields
Linked Record fields — relational references between rows in different Tables
AI fields — a prompt-driven column that regenerates automatically when its inputs change
AI enrichment — auto-populate several columns of a new row from one seed value
Advanced roles and permissions (coming soon per Zapier's published roadmap at time of writing)
12.3 How Tables Connect to Zaps and Forms
Triggers: New Record Created, Record Updated, Record Deleted
Actions: Create/Update/Delete/Find records, and more, callable from any Zap
A Form submission can write directly into a Table, and a Table record change can trigger a Zap — closing the loop between capture, storage, and automation
Reading/writing Tables never consumes a task
13. Zapier Forms — Full Feature Deep Dive
Zapier Forms lets anyone build a hosted form, web page, or embeddable widget that connects directly to Zapier's 9,000+ app integrations without code — Zapier markets this as the only form product on the market with that breadth of native integration.
13.1 Limits by Plan
Capability
Free
Professional
Team
Enterprise
Form projects
Unlimited
Unlimited
Unlimited
Unlimited
Pages per account
10
50
150
Contact Sales
Editors with managed access
—
—
100 users
500+ users
File upload limit
5 MB, 3 files max
10 MB, 100 files max
25 MB, 100 files max
25 MB+
13.2 Feature Set
Basic components: text, number, dropdown, multi-select, file upload, and more
Navigation — multi-page forms with configurable flow between pages
Web embedding — drop a form into any existing website
Dynamic filtering and conditional form logic (show/hide fields based on prior answers) — conditional logic is a Professional+ feature
Branding: custom colors, custom domain, password protection, and (on higher plans) removing the Zapier logo
Payments component — collect payments via Stripe directly inside a form (paid plans)
A Form submission can trigger a Zap immediately and can write into a Table in the same flow
14. Zapier Canvas — Full Feature Deep Dive
Zapier Canvas, launched in 2023, is an AI-assisted diagramming and visualization tool for planning and documenting workflows and broader business systems — independent of whether every box in the diagram is a live, published Zap.
Auto-generated canvases: Zapier can generate a Canvas diagram automatically from an existing Zap or set of Zaps, giving teams a visual map of what's already live
Freeform planning: teams can sketch a target process before building anything, then convert pieces of that plan into real Zaps
Useful as living documentation for onboarding, audits, and cross-team alignment on how an automated system fits together
15. Zapier Interfaces — Full Feature Deep Dive
Zapier Interfaces is a no-code web-app and page builder used to create custom front ends — client portals, internal tools, dashboards, and forms — that connect directly to Zaps and Tables.
15.1 Builder Capabilities
Visual, drag-and-drop layout builder — no code required
Component library: forms, Kanban boards, link cards, AI prompt boxes, embedded chatbots, and more
Full customization of colors, fonts, and layout to match brand identity
Two broad interface categories: multi-step apps/portals, and simple single-purpose pages
15.2 Automation Integration
Any component can read from or write to Zapier Tables
Form-like components can trigger Zap workflows directly, with free automation between Interfaces and Tables
Chatbots can be shared and embedded through an Interface page as an alternative to a public link or website embed
16. Zapier MCP — Full Feature Deep Dive
Zapier MCP implements the Model Context Protocol so external AI clients — Claude, ChatGPT, Cursor, and others — can securely take action inside a user's connected apps directly from an AI conversation, without the user leaving that conversation.
16.1 How It Works
1.	The user sets up Zapier MCP once, exposing their existing app connections as a set of callable tools.
2.	Any supported AI client connects to the Zapier MCP endpoint.
3.	Inside a normal chat, the user asks the AI to take an action (e.g., “Add this lead to Salesforce and post it in #sales”).
4.	The AI client calls the appropriate Zapier MCP tool, which executes against the already-authenticated app connection and returns a result to the conversation.
16.2 Availability, Cost, and Security
Available on every Zapier plan, including Free.
One MCP tool call consumes two tasks from the account's plan quota.
MCP endpoints include built-in authentication so connections remain secure between the AI client and the user's Zapier account.
MCP connects to the full 9,000+ app directory — any action available to a normal Zap is potentially callable by an authorized MCP client.
17. Zapier SDK — Full Feature Deep Dive
Zapier SDK gives developers and coding agents authenticated, code-level access to the same 9,000+ app ecosystem used by the visual builder — for cases where an agent needs to write logic, call APIs, and chain multi-step actions programmatically rather than through the drag-and-drop editor.
Discover available apps and inspect their actions and required inputs directly from code.
Manage connections and run actions across the full app catalog, including raw API access to 3,000+ apps for cases needing lower-level control.
Zapier handles authentication, token refresh, and rate limiting on the developer's behalf.
Free during open beta, with advance notice promised before the beta ends or pricing changes.
Once out of beta, SDK usage draws from the same unified task pool as Zap workflows, AI steps, and Code by Zapier.
18. Developer Platform (Powered by Zapier)
Powered by Zapier is aimed at companies that want to embed automation inside their own product, using Zapier's Workflow API and 9,000+ integrations so their end users get a built-in automation experience without the company building or maintaining the integrations itself.
18.1 What Zapier Handles For You
Authentication and credential storage for every connected third-party app
Infrastructure for trigger detection, polling, and execution
End-user support for the underlying app connections
18.2 Building a Custom Integration
Build your own private integration (a “private app”) so your own internal or proprietary tools can be triggers/actions inside any Zap, using the developer platform's guided builder
Create a custom action against any REST API even without a full private-app integration, for one-off needs
The zapier-platform CLI is the primary tool for scaffolding, developing, and publishing an integration; the legacy standalone zapier CLI binary has been retired in favor of zapier-platform
18.3 Platform Safeguards (2026)
Automatic breaking-change detection during promotion, guiding developers to the correct semantic version bump
New invoke auth template / invoke auth render commands to inspect exactly what an app's auth request looks like before publishing
JSON input field type support, versions-command improvements, and function-based dynamic dropdown fixes shipped as part of ongoing platform releases
Migration tooling blocks promoting users across integration versions when source and target versions diverge too far, protecting against silent breakage
18.4 Anatomy of a Private Integration (zapier-platform)
const App = {  version: require('./package.json').version,  platformVersion: require('zapier-platform-core').version,  authentication: {    type: 'oauth2',    oauth2Config: { /* authorize / getAccessToken / refreshAccessToken */ },  },  triggers: {    new_ticket: {      key: 'new_ticket',      noun: 'Ticket',      display: { label: 'New Ticket', description: 'Fires on a new support ticket.' },      operation: {        perform: async (z, bundle) => {          const response = await z.request({ url: 'https://api.example.com/tickets' });          return response.data;        },      },    },  },  creates: {    create_ticket: {      key: 'create_ticket',      noun: 'Ticket',      display: { label: 'Create Ticket', description: 'Creates a new support ticket.' },      operation: {        inputFields: [          { key: 'subject', required: true, type: 'string' },          { key: 'priority', choices: ['low', 'normal', 'high'] },        ],        perform: async (z, bundle) => {          const response = await z.request({            method: 'POST',            url: 'https://api.example.com/tickets',            body: bundle.inputData,          });          return response.data;        },      },    },  },};module.exports = App;
zapier-platform validate checks the app definition for structural errors before publishing.
zapier-platform push publishes a new private version visible immediately to your own team; zapier-platform promote makes a version public to all Zapier users after review.
18.5 Embedding an Integration
Once built, an integration can be embedded directly into your own product's UI so your customers configure Zaps without ever leaving your app
The Integration Partner Program provides co-marketing and support pathways for companies publishing a public integration
19. The App Directory — 9,000+ Integrations
Zapier's directory is the largest in the automation industry. Apps are organized by category and by popular use case, and each app exposes its own set of triggers, actions, and (for search-capable apps) searches.
19.1 Representative Categories
Category
Example Apps
CRM & Sales
Salesforce, HubSpot, Pipedrive, Microsoft Dynamics CRM
Communication
Slack, Microsoft Teams, Gmail, Zoom
Productivity & Project Mgmt
Notion, Asana, Trello, Jira Software Cloud
Commerce & Payments
Shopify, Stripe, QuickBooks
Marketing
Mailchimp, ActiveCampaign, Facebook Lead Ads
AI Platforms
ChatGPT (OpenAI), Anthropic Claude, Google AI
Data & Spreadsheets
Google Sheets, Microsoft Excel, Airtable
ERP / Ops
NetSuite, Zendesk
19.2 Step-by-Step Setup Walkthroughs for Popular Integrations
Every app in the directory follows the same underlying connect-configure-test pattern from Section 4, but the exact fields differ per app. The walkthroughs below cover ten of the most-used integrations end to end.
Gmail
1.	Search for Gmail as the trigger app and choose an event: New Email, New Attachment, New Labeled Email, or New Thread.
2.	Select Sign in with Google and grant Zapier the requested Gmail scopes in the OAuth popup.
3.	Configure optional filters: label/mailbox to watch, and a search string to narrow matching emails.
4.	Test the trigger — Zapier pulls your most recent matching email so you can see fields like From, Subject, Body Plain, and Attachments.
5.	As an action, choose Send Email, Create Draft, or Reply to Email, map the To/Subject/Body fields from upstream data, and test.
Slack
1.	Choose Slack and a trigger such as New Message Posted to Channel or New Mention.
2.	Authorize the Zapier Slack app for your workspace and select which channels it can access.
3.	For the action side, the most common choice is Send Channel Message: pick the channel from the dynamic dropdown (populated live from your workspace) and compose the message text, mixing in fields from prior steps.
4.	Optionally configure Send as a Bot, a custom username/icon, and thread-reply behavior.
5.	Test the step — a real message is posted to the chosen channel immediately.
Google Sheets
1.	As a trigger, choose New Spreadsheet Row (fires once a row is fully populated) or New or Updated Spreadsheet Row.
2.	Connect your Google account and select the Drive, Spreadsheet, and Worksheet via cascading dynamic dropdowns.
3.	As an action, Create Spreadsheet Row lets you map each column to a field from an earlier step; Update Spreadsheet Row requires selecting the target row first via a lookup value.
4.	Test to confirm a real row is written to the sheet.
Salesforce
1.	Choose a trigger such as New Record, Updated Record, or New Outbound Message; Salesforce requires configuring an Outbound Message/Workflow Rule in Salesforce itself for the most instant trigger option.
2.	Authenticate via Salesforce OAuth, selecting Production or Sandbox environment.
3.	Choose the Salesforce object (Lead, Contact, Opportunity, custom object, etc.) to watch or act on.
4.	For actions like Create Record or Update Record, map every required Salesforce field; use Find Record first if you need to look up an existing record by a non-ID value.
5.	Test against your real Salesforce org before publishing.
HubSpot
1.	Choose a trigger such as New Contact, New Deal, or Contact Property Change.
2.	Connect your HubSpot account and select the Hub/portal if you have more than one.
3.	Configure any property filters (e.g., only a specific lifecycle stage).
4.	For actions, Create/Update Contact and Create Deal are the most common; HubSpot's custom properties appear automatically as mappable fields once the account is connected.
Trello
1.	Choose a trigger like New Card, Card Updated, or New Board.
2.	Authenticate with your Trello account (API key/token flow).
3.	Select the Board and, if relevant, the List via dynamic dropdowns.
4.	As an action, Create Card lets you set the name, description, due date, labels, and target list; Move Card to List is common as a second step after another action completes.
Stripe
1.	Choose a trigger such as New Payment, New Customer, or New Invoice Payment.
2.	Connect your Stripe account with a restricted or full API key, or via OAuth depending on the integration version.
3.	Test to pull a real recent object (e.g., the latest charge) and confirm amount, currency, and customer fields.
4.	Common downstream actions: create an invoice, create a customer, or (more often) send the Stripe event onward into a CRM or spreadsheet action.
QuickBooks Online
1.	Choose a trigger like New Invoice, New Customer, or New Payment.
2.	Sign in with Intuit and select the specific QuickBooks company file if multiple are connected.
3.	For actions such as Create Invoice, map line items using the Line Item field type, one row per product/service.
4.	Test against a sandbox or live company file before publishing broadly.
Typeform
1.	Choose the New Entry trigger and select the specific form.
2.	Authenticate with your Typeform account.
3.	Test to load a sample submission — every Typeform question becomes an individually mappable field.
4.	Common next steps: create a CRM lead, add a Table row, or send a personalized confirmation email.
Facebook Lead Ads
1.	Choose the New Lead trigger and select the Facebook Page and specific Lead Ad Form.
2.	Authenticate with Facebook and grant the requested Pages/Lead-Ads permissions.
3.	Test to pull a recent lead submission; every question field on the ad form appears as a mappable field.
4.	Typical downstream actions: create/update a CRM contact and notify the sales team in Slack or email, often combined with a Path step to route by ad campaign.
19.3 Directory Mechanics
Premium apps require a paid plan; Free-plan users are limited to non-premium apps
Every app integration is maintained and continuously updated — Zapier ships dozens of new actions, triggers, and bug fixes to existing integrations every month (60–75+ updated integrations per monthly release cadence through 2026)
Any app without a dedicated integration can still be connected generically via Webhooks by Zapier
20. Connections & Authentication
OAuth 2.0 — the most common method; the user authorizes Zapier in a popup and Zapier stores an encrypted access/refresh token pair
API Key / token auth — the user pastes a key generated in the target app's own settings
Custom / multi-field auth — for apps with bespoke handshakes (e.g., subdomain + key + secret combinations)
A single connected account can be reused across any number of Zaps without reconnecting
Zaps now require owner-level access to all app connections they use, tightening account-connection security account-wide
Static IP addresses are available (Enterprise) so downstream systems (e.g., firewalled databases) can allowlist Zapier's traffic
21. Zapier's Internal System Architecture (Inferred Production Model)
Zapier does not publish its internal source architecture; the model below is the standard, industry-accepted architecture for a platform exhibiting Zapier's publicly documented behavior (webhook + polling triggers, per-task billing, 3+ billion tasks/month scale, autoreplay, versioning) and is the reference model engineering teams use when reproducing Zapier-equivalent behavior.
┌─────────────────────┐        │      Web Client        │        │ (Zap editor, Tables,    │        │  Forms, Interfaces)     │        └──────────┬──────────┘                    │ HTTPS        ┌──────────▼──────────┐        │     API Gateway         │        │ (auth, rate limiting)   │        └──────────┬──────────┘      ┌─────────────┼─────────────┐      ▼             ▼             ▼┌───────────┐ ┌───────────┐ ┌───────────────┐│ Zap Config  │ │ Connection  │ │ App Directory   ││ Service     │ │ / Auth Vault│ │ / Piece Registry │└─────┬─────┘ └─────┬─────┘ └───────┬───────┘      └─────────────┼───────────────┘                     ▼          ┌─────────────────────┐          │  Trigger Subsystem     │          │ (webhook receiver,     │          │  poller fleet,          │          │  cron scheduler)        │          └──────────┬──────────┘                      ▼          ┌─────────────────────┐          │   Task Queue            │          │ (distributed, at-scale   │          │  message broker)         │          └──────────┬──────────┘                      ▼          ┌─────────────────────┐        ┌─────────────────────┐          │  Worker Fleet            │◄──────►│  AI Orchestration      │          │ (serverless, isolated     │        │  Layer (model routing,  │          │  per-task execution)      │        │  MCP, Agents, Copilot)  │          └──────────┬──────────┘        └─────────────────────┘                      ▼          ┌─────────────────────┐          │  Task History / Log     │          │  Store (masked payloads) │          └──────────┬──────────┘                      ▼          ┌─────────────────────┐          │   Billing / Metering    │          │   Service (task pool)    │          └─────────────────────┘
21.1 Design Principles Implied by Public Behavior
Queue-based, at-least-once task execution: Zapier states it processes 3+ billion tasks per month, requiring a horizontally scaled, stateless worker fleet
Isolated execution per task: “Each Zap execution is isolated — one Task does not affect another”
Separation of trigger detection (webhook receivers + poller fleet + scheduler) from step execution (worker fleet), matching the free polling-vs-task distinction Zapier bills on
A unified task-metering layer sits behind every product (Zaps, AI, Code, MCP, SDK) so usage can be billed from one shared pool
22. Runtime Execution — What Happens When a Zap Runs
22.1 The Moment a Zap Is Turned On
1.	Webhooks are registered with source apps for instant triggers.
2.	Polling jobs are scheduled at the plan's configured interval for polling triggers.
3.	Schedule triggers are registered with the internal cron scheduler.
4.	The Zap's state flips from Draft/Off to On in Zapier's systems.
22.2 Trigger Fires → Task Created
Event occurs in source app        │        ▼Webhook POST received  OR  Poller detects new record via cursor        │        ▼Trigger data captured & normalized        │        ▼New Task/run created in Zapier's execution queue        │        ▼Available worker dequeues the run
22.3 Sequential Step Execution
Each action step resolves its mapped fields against all upstream step output (not just the immediately previous step).
The worker authenticates using the stored, encrypted connection credential, refreshing an OAuth token automatically if expired.
The API call to the target app executes; the response is parsed and stored for use by any downstream step.
Filters halt the run entirely if their condition isn't met; Paths route execution down exactly one matching branch.
22.4 Error Handling
Situation
Behavior
Transient failure (timeout, 5xx, rate limit)
Retried automatically if Autoreplay is enabled (Professional+); otherwise logged as an error
Authentication failure
Immediate fail; user is prompted to reconnect the affected account
Persistent failure after retries
Zap run marked Errored; downstream steps do not execute; error notification sent per configured settings
Flood/runaway detection
Flood protection settings can pause a Zap that is running or erroring abnormally often
22.5 Logging & Replay
Every run is recorded in Zap History with per-step input/output data, timestamps, and status.
A failed run can be manually replayed after the underlying issue is fixed, re-running from the original trigger data.
History retention is configurable on Enterprise (custom data retention); other plans use Zapier's standard retention window.
23. Task Billing & Metering — Full Rules
23.1 What Counts As a Task
Each successful action step = 1 task (rates can vary: AI steps and some connector calls use more than 1 task depending on model tier).
Triggers never consume a task, including polling checks that find nothing new.
Failed actions do not consume a task — only successful completions bill.
A Zapier MCP tool call consumes 2 tasks.
23.2 What Never Counts As a Task
Zapier Tables and Zapier Forms usage
Filter by Zapier, Formatter by Zapier, Path by Zapier
Delay, Looping, Sub-Zap, Digest, Zapier Manager, Storage by Zapier
23.3 Published Task Tiers
Zapier's pricing page lets you slide between task tiers on Professional, Team, and Enterprise; published tier stops include:
Tier
Tier
Tier
100/mo (Free)
750/mo
1,500/mo
2,000/mo
5,000/mo
10,000/mo
20,000/mo
50,000/mo
100,000/mo
200,000/mo
300,000/mo
400,000/mo
500,000/mo
750,000/mo
1,000,000/mo
1,500,000/mo
1,750,000/mo
2,000,000/mo
Custom (Enterprise)
The effective per-task price decreases as the committed tier increases, rewarding accounts that commit to higher volume.
Paying annually rather than monthly is discounted roughly 33% across every tier.
23.4 Task Tiers & Overage
Task tiers scale from 100/month (Free) up to 2M+/month (custom) on paid plans, with per-task cost decreasing at higher tiers.
When an account reaches its task limit, Zapier emails a warning, then switches the account to pay-per-task billing (a higher per-task rate) if enabled, or pauses Zaps until the next billing period if not.
Annual billing saves roughly a third compared to paying monthly.
23.5 Shared Pool Across Products
As of 2026, Zap workflows, AI steps, Code by Zapier, MCP, and SDK usage all draw from the same shared task allocation — there is no separate budget per product. Usage scales with complexity: a Standard-tier AI step, more tool calls, or longer Code runtime all consume proportionally more of the shared pool.
24. Security, Compliance & Enterprise Governance
24.1 Admin & Security Controls by Plan
Control
Free
Professional
Team
Enterprise
Two-factor authentication
Yes
Yes
Yes
Yes
Pay-per-task billing
Yes
Yes
Yes
Yes
Static IP
—
—
—
Yes
Audit log
—
—
—
Yes
Owner access controls
—
—
—
Yes
SAML single sign-on (SSO)
—
—
Yes
Yes
User provisioning (SCIM)
—
—
—
Yes
Domain capture
—
—
—
Yes
Super Admin / advanced admin permissions
—
—
—
Yes
App access controls / action restrictions
—
—
—
Yes
Custom data retention
—
—
—
Yes
Observability API / Analytics
—
—
—
Yes
Annual task limits
—
—
—
Yes
Managed app connections / domain restrictions
—
—
—
Yes
Bring Your Own Model
—
—
—
Yes
Log Streams
—
—
—
Yes
24.2 Compliance
SOC 2 Type II and SOC 3 certification of Zapier's cloud platform
Enterprise plan built explicitly for “governing AI and automation at scale” — rules set once apply across workflows, agents, and MCP usage org-wide
Custom data retention lets regulated customers define exactly how long Zap History and related data are kept
25. Admin, Teams & Collaboration
Feature
Free
Professional
Team
Enterprise
Seats
1
1
25
Unlimited
Shared app connections
—
—
Yes
Yes
Shared workspace
—
—
Yes
Yes
Folder permissions
—
—
—
Yes
Approval requests (Beta)
—
—
—
Yes
Team plan is aimed at multiple people collaborating on the same automations with shared connections and a shared workspace.
Enterprise adds folder-level permissions and (in beta) an approval-request workflow for governed changes.
Support tiers scale from standard email support (Free) up to 24/7 email, live chat, priority support, and screen-sharing support (Enterprise), plus a Technical Account Manager at a set usage threshold or as an add-on.
26. Pricing — Full Plan-by-Plan Breakdown
26.1 Core Platform Plans
Plan
Starting Price
Key Included Features
Free
$0/month forever
100 tasks/mo; unlimited Zap workflows, Tables & Forms; two-step Zaps; Zapier Copilot
Professional
From $19.99/month
Multi-step Zaps; unlimited premium apps; Webhooks; email & live chat support; AI fields; conditional form logic
Team
From $69/month
25 seats; shared Zaps/folders; shared app connections; SAML SSO; priority support
Enterprise
Contact sales
Unlimited seats; advanced admin permissions & app controls; advanced deployment options; annual task limits; observability; Technical Account Manager; priority support with screen sharing
Every paid plan includes: the full no-code visual editor, Tables and Forms, unlimited app integrations, all built-in data/AI workflow tools, advanced Zap management, version control, custom error notifications, and access to the full Zapier toolkit (Forms, Tables, Zaps, Canvas, MCP, SDK).
26.2 Free Plan Detail
The Free plan includes basic Zaps and a limited monthly task allowance. Upgrading unlocks premium apps, multi-step Zaps, larger Table/Form limits, Version history, AI Fields in Tables, the Stripe payments component in Forms, Autoreplay, faster polling, and expanded support options.
26.3 Non-Profit & Trial Terms
New accounts get an automatic 14-day free trial of the Professional plan, no credit card required.
Non-profits receive a 15% discount on any paid plan (excluding pay-per-task overage charges).
Annual Team/Enterprise plans support invoice or wire-transfer payment.
27. Templates & Use-Case Library
Zapier maintains a large public template gallery organized by team and by use case, letting users start from a proven workflow instead of a blank canvas.
Axis
Examples
By team
RevOps, Marketing, IT, HR, Sales, Customer Support, Leaders, Executive Assistants
By use case
Lead management, Sales pipeline, Marketing campaigns, Customer support, Data management, Project management, Tickets & incidents
By app
NetSuite, Salesforce, HubSpot, Slack, ChatGPT (OpenAI), Microsoft Dynamics CRM, Microsoft Teams, Zendesk, Jira Software Cloud
Guided templates let a builder share a partially pre-filled Zap with teammates so they only need to connect their own accounts, rather than configuring every field from scratch.
28. End-to-End Reference Workflows
28.1 Lead Capture → CRM → Notification → Approval
TRIGGER: Zapier Forms — "New Submission"    -> name, email, company, budget, use_case        |        vSTEP 1: AI by Zapier — "Summarize lead"    prompt: "Summarize this lead: {{use_case}}"        |        vSTEP 2: Salesforce — "Create Lead"    name: {{name}}, email: {{email}}, notes: {{step1.summary}}        |        vSTEP 3: Slack — "Send Channel Message" to #sales        |        vPATH: If {{budget}} > 10000    TRUE  -> Zapier Manager/Table To-Do row + Slack approval request             (manager approves manually; Zap resumes via a second Zap              triggered by the Table row update)    FALSE -> Salesforce — "Update Lead Status" = Nurture
28.2 Support Ticket Triage With an Agent
Trigger: New ticket in Zendesk.
Zapier Agent reads the ticket, classifies urgency using a live data source, and drafts a first response.
If urgency is High, the Agent posts to a Slack escalation channel and tags the on-call engineer; otherwise it replies directly via Zendesk.
28.3 E-Commerce Order Fulfillment
TRIGGER: Shopify — "New Order"        |        vSTEP 1: Filter — continue only if {{fulfillment_status}} != "fulfilled"        |        vSTEP 2: Zapier Tables — "Create Record" (Orders table, status = Processing)        |        vSTEP 3: Looping by Zapier — iterate {{line_items}}        |        v    STEP 3a: QuickBooks Online — "Create Invoice Line" per item        |        vSTEP 4: Slack — notify #fulfillment channel with order summary        |        vSTEP 5: Gmail — send order-confirmation email to the customer
28.4 Employee Onboarding
TRIGGER: Zapier Forms — "New Hire Details Submitted" by HR        |        vSTEP 1: Zapier Tables — "Create Record" (Onboarding tracker)        |        vSTEP 2: Paths — branch by {{department}}    Engineering -> Create accounts in GitHub + Jira, add to #eng-new-hires    Sales       -> Create account in Salesforce, add to #sales-new-hires        |        vSTEP 3 (all paths): Google Calendar — schedule a 30-minute welcome call        |        vSTEP 4: Delay — wait until 1 day before start date        |        vSTEP 5: Gmail — send a "getting started" email with links and login info
28.5 MCP-Driven Ad Hoc Automation
A user, inside Claude, says: “Add jane@example.com to our HubSpot list and email her the onboarding guide.”
Claude calls the Zapier MCP tools for HubSpot and Gmail using the user's existing connections.
Two tasks are consumed per MCP tool call; both actions appear in the user's normal Zap History for auditing.
29. Building Your Own Zapier — Reference Architecture
This section distills Sections 1–28 into a build plan for engineering teams constructing a Zapier-equivalent platform from scratch.
29.1 Minimum Viable Feature Set (Launch)
1.	Trigger-and-action Zap builder with OAuth2/API-key connections and a step-based editor (Setup → Configure → Test).
2.	Webhook + polling trigger infrastructure with per-plan interval tiers.
3.	A queue-based worker fleet executing steps sequentially with per-task isolation.
4.	Filter, Formatter, Delay, and Paths as free, first-party built-in tools.
5.	Zap History with per-step input/output logging and manual replay.
6.	A task-based billing engine metering successful actions only, with tiered plans and pay-per-task overage.
29.2 Growth-Stage Additions
A built-in database product (Tables-equivalent) with formulas, linked records, and AI-driven fields.
A forms/pages builder wired directly into the trigger system.
AI action steps with tiered model pricing and a bring-your-own-key option.
An MCP server exposing every connected action as a callable AI tool, metered distinctly from standard tasks.
A code-execution step (JS/Python) with package-manager access and AI-assisted code generation.
29.3 Platform / Enterprise-Stage Additions
Autonomous agents that combine triggers, tool-calling, and live data lookups into a single proactive unit.
A developer platform (CLI + hosted SDK) so third parties can publish new integrations without a core deployment.
SSO (SAML), SCIM provisioning, audit logs, custom data retention, and static IP egress for enterprise buyers.
An embeddable Workflow API so other companies can white-label the automation engine inside their own product.
29.4 Architecture Diagram (Consolidated)
Web Client (editor, Tables, Forms, Interfaces, Canvas)        │        ▼API Gateway  ──►  Connection/Auth Vault        │        ▼Trigger Subsystem (webhook receiver / poller / scheduler)        │        ▼Task Queue  ──►  Billing/Metering Service        │        ▼Worker Fleet  ◄──►  AI Orchestration Layer (models, MCP, Agents)        │        ▼Task History / Log Store  ──►  Analytics & Audit
29.5 Key Non-Functional Targets, Benchmarked to Zapier's Public Numbers
Metric
Target
Directory breadth
9,000+ integrations at maturity; launch with the top 200–300 apps by category coverage
Execution scale
Design for 3B+ tasks/month at full scale; horizontally scaled, stateless workers
Trigger latency
Sub-second for webhook triggers; 1–15 minute configurable polling tiers
Isolation
Every task execution isolated so one failure cannot affect another concurrent run
Metering granularity
Per-successful-action billing; free triggers and free built-in logic tools
29.6 Core Data Model
A relational schema sufficient to reproduce every behavior documented in Sections 1–28:
Table
Key Columns
Notes
accounts
id, plan_tier, task_tier, tasks_used_this_period, billing_cycle_start
One row per customer; backs the shared task pool described in 23.4
users
id, account_id, email, role, sso_subject
SCIM-synced on Enterprise-equivalent plan
connections
id, account_id, app_key, auth_type, encrypted_credentials, status, owner_user_id
Owner-only access mirrors Zapier's 2026 owner-access requirement (Section 20)
zaps
id, account_id, name, status(draft/on/off), current_version_id
Top-level workflow object
zap_versions
id, zap_id, version_number, definition_json, published_at
Immutable snapshot per publish (Section 8.2 Versions)
zap_steps
id, zap_version_id, step_type(trigger/action/filter/path/formatter/delay/loop/subzap/digest), app_key, event_key, config_json, position
One row per step in the flow graph
tasks
id, zap_version_id, status, started_at, finished_at, task_count_billed
One row per run; task_count_billed feeds billing (23.1)
task_steps
id, task_id, step_id, input_json, output_json, status, duration_ms
Per-step execution record for Zap History (22.5)
webhooks
id, zap_id, url_token, secret
Backs Catch Hook and app-registered instant triggers
poll_cursors
id, zap_id, cursor_value, last_polled_at
Backs polling triggers and interval tiers (5.3)
tables / table_records
id, account_id, schema_json / table_id, data_json
Backs the Tables product (Section 12)
agents / agent_activities
id, account_id, pod_id, config_json / id, agent_id, type, cost
Backs Agents and its separate activity metering (10.5)
29.7 Public API Endpoint Reference
Method & Path
Purpose
POST /v1/zaps
Create a draft Zap
PUT /v1/zaps/{id}/steps
Add or update a step in a draft Zap
POST /v1/zaps/{id}/publish
Publish the current draft as a new version, registering triggers
POST /v1/zaps/{id}/run
Manually trigger a run
GET /v1/zaps/{id}/history
List runs with per-step status (Zap History equivalent)
POST /v1/tasks/{id}/replay
Replay a failed or completed run
POST /v1/connections
Start a new OAuth2/API-key connection
GET /v1/apps
List available integrations and their triggers/actions/searches
POST /v1/tables/{id}/records
Create a record in a Table
POST /v1/webhooks/{token}
Public inbound endpoint (Catch Hook equivalent)
GET /v1/accounts/{id}/usage
Return current task usage against the account's tier
POST /v1/mcp/tools/{tool}/call
Invoke a connected action as an MCP tool (2x task cost per 23.1)
29.8 Execution Engine — Reference Pseudocode
function onTriggerEvent(zapId, rawEvent):    zap = loadPublishedVersion(zapId)    normalized = zap.trigger.normalize(rawEvent)    task = Task.create(zapVersionId=zap.versionId, status="QUEUED")    enqueue(task.id, normalized)          # never billed — triggers are freefunction workerLoop():    while True:        job = queue.dequeue()        task = Task.get(job.taskId)        context = { "trigger": job.triggerData }        for step in task.zapVersion.steps:            if step.type == "filter":                if not evalCondition(step.config, context):                    task.status = "FILTERED"; break            elif step.type == "path":                branch = selectMatchingBranch(step.config, context)                if branch is None: continue                runBranchSteps(branch, context, task)            elif step.type == "action":                result = executeAction(step, context)   # 1 task on success                context[step.name] = result.output                TaskStep.record(task.id, step.id, result)                if result.billed: task.billedCount += 1            elif step.type in ("delay", "digest"):                dehydrateAndScheduleResume(task, step, context)                return   # worker slot freed; resumes later via scheduler        finalizeTask(task)function executeAction(step, context):    conn = ConnectionVault.getDecrypted(step.connectionId)    if conn.isExpired(): conn = refreshOAuthToken(conn)    payload = resolveTemplateFields(step.config, context)    response = callAppApi(step.appKey, step.eventKey, payload, conn)    return ActionResult(output=response, billed=response.success)function finalizeTask(task):    Billing.debit(task.accountId, task.billedCount)   # Section 23 rules    task.status = "SUCCEEDED" if task.allStepsOk else "ERRORED"    if task.status == "ERRORED" and task.zap.autoreplayEnabled:        scheduleRetry(task, backoff=exponential(task.attempt))
29.9 Task-Metering Hook — Implementing Section 23's Rules
Bill exactly once per successfully completed action step; never bill triggers, polling checks, or built-in logic tools (Filter/Paths/Formatter/Delay/Looping/Sub-Zap/Digest/Manager/Storage).
AI action steps multiply the base 1-task cost by the selected model tier (1x/3x/5x) plus tool-call surcharges, mirroring Section 9.2; a bring-your-own-key path flattens this back to 1x.
MCP tool invocations bill at a fixed 2x multiplier regardless of the underlying action's normal cost, per Section 16.2.
A per-run safety ceiling (e.g., 75 billed units) should pause the run and require explicit approval before continuing, matching the AI-step guardrail described in Section 9.2.
Every debit should be idempotent per task_step id so a replay never double-bills the same successful step.
30. Appendix — Glossary & FAQ
30.1 Glossary
Term
Definition
Zap
A workflow of one trigger and one or more actions
Task
The billing unit consumed by each successful action
Piece / App
An integration to a specific external service
Path
A conditional branch inside a Zap
Pod
A group of related Zapier Agents reviewed together
Activity
The billing unit for Zapier Agents
MCP
Model Context Protocol — lets AI clients call Zapier actions as tools
Interface
A no-code web app/page built on Zapier Interfaces
30.2 Common Errors & Fixes
Symptom
Likely Cause
Fix
Zap turned itself off
Repeated action failures tripped Zapier's automatic protection
Fix the underlying field/permission issue, then turn the Zap back on; consider Autoreplay
“Authentication error” on a step
The connected account's token expired or was revoked
Reconnect the account from the step's account dropdown
Trigger never fires
Webhook deregistered, or polling interval hasn't elapsed yet
Re-save/publish the Zap to re-register the webhook; check the plan's polling interval
Field shows blank at runtime despite test data present
The field was referencing a branch of a Path that didn't execute for that run
Reference only fields from steps guaranteed to run before this one
Task usage higher than expected
AI step tier set to Advanced/Premium, or tool calls/MCP calls adding up
Review Section 23; switch to Standard tier or bring your own AI key where appropriate
30.3 Frequently Asked Questions
Do I need to know how to code?
No — Zapier is designed for non-developers to move data between apps, with optional code steps for advanced users.
What counts as a task?
Every successful action step; triggers, polling checks, and Zapier's built-in logic tools never count.
What happens when I hit my task limit?
Zapier emails a warning as you approach the limit, then either switches you to pay-per-task billing (if enabled) or pauses your Zaps until the next billing period.
How many apps does Zapier support?
9,000+, the largest directory of any automation platform, with raw API access to 3,000+ of them via the Zapier SDK.
Does checking for new data (polling) ever use a task?
No. Zapier only charges a task when a Zap successfully completes an action — polling checks that find nothing new are always free.
What happens if an action fails?
A failed action does not consume a task. With Autoreplay enabled (Professional+) Zapier automatically retries it; otherwise it's logged as an error in Zap History and can be replayed manually once fixed.
Can I connect an internal or proprietary tool that isn't in the directory?
Yes — build a private integration on the Developer Platform, or use Webhooks by Zapier for a quick, code-free generic connection.
What's the difference between Zapier Agents and an AI step inside a Zap?
An AI step is one action inside a larger, explicitly built Zap. An Agent is a standing, proactive unit that monitors for triggers and decides its own multi-step course of action across your connected apps.
Is my data secure when I connect an app?
Connections use OAuth2 or API-key authentication with encrypted credential storage; Enterprise adds static IPs, custom data retention, and SOC 2/3-certified infrastructure.
Can I roll back a Zap to a previous configuration?
Yes — every meaningful save creates a Version, and any prior version can be restored; Team and Enterprise can additionally Compare Versions side by side.
How is Zapier MCP billed differently from a normal Zap?
A standard Zap action costs 1 task on success; each Zapier MCP tool call costs 2 tasks, reflecting the additional AI-client round trip.
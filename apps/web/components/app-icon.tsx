"use client";

import {
  Bot,
  Braces,
  Calendar,
  Code2,
  CreditCard,
  Database,
  FileSpreadsheet,
  Filter,
  Folder,
  FormInput,
  GitBranch,
  Github,
  Globe,
  Hash,
  Layers,
  Mail,
  MessageCircle,
  MessageSquare,
  Repeat,
  Send,
  ShoppingCart,
  Slack,
  Sparkles,
  Table2,
  Trello,
  Timer,
  TrendingUp,
  Truck,
  Users,
  Webhook,
  Workflow,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, { icon: typeof Mail; bg: string; fg: string }> = {
  // ── Core / Logic ──
  webhook: { icon: Webhook, bg: "bg-ink", fg: "text-elevated" },
  schedule: { icon: Timer, bg: "bg-info", fg: "text-white" },
  manual: { icon: Zap, bg: "bg-ok", fg: "text-white" },
  http: { icon: Globe, bg: "bg-ink", fg: "text-elevated" },
  filter: { icon: Filter, bg: "bg-warn", fg: "text-white" },
  paths: { icon: GitBranch, bg: "bg-info", fg: "text-white" },
  loop: { icon: Repeat, bg: "bg-teal", fg: "text-teal-fg" },
  delay: { icon: Timer, bg: "bg-ink-muted", fg: "text-white" },
  formatter: { icon: Braces, bg: "bg-muted", fg: "text-ink" },
  code: { icon: Code2, bg: "bg-ink", fg: "text-elevated" },
  approval: { icon: Zap, bg: "bg-[#EA580C]", fg: "text-white" },
  subflow: { icon: Workflow, bg: "bg-teal", fg: "text-teal-fg" },
  digest: { icon: Mail, bg: "bg-[#0F766E]", fg: "text-white" },
  storage: { icon: Database, bg: "bg-[#57534E]", fg: "text-white" },
  transfer: { icon: Repeat, bg: "bg-[#0F766E]", fg: "text-white" },
  tables: { icon: Table2, bg: "bg-teal", fg: "text-teal-fg" },
  forms: { icon: FormInput, bg: "bg-info", fg: "text-white" },

  // ── Google ──
  gmail: { icon: Mail, bg: "bg-[#EA4335]", fg: "text-white" },
  "google-sheets": { icon: FileSpreadsheet, bg: "bg-[#34A853]", fg: "text-white" },
  "google-calendar": { icon: Calendar, bg: "bg-[#4285F4]", fg: "text-white" },
  "google-drive": { icon: Folder, bg: "bg-[#F4B400]", fg: "text-white" },
  "google-docs": { icon: FileSpreadsheet, bg: "bg-[#4285F4]", fg: "text-white" },
  "google-slides": { icon: FileSpreadsheet, bg: "bg-[#FBBC04]", fg: "text-white" },
  "google-forms": { icon: FormInput, bg: "bg-[#673AB7]", fg: "text-white" },
  "google-chat": { icon: MessageSquare, bg: "bg-[#00AC47]", fg: "text-white" },
  "google-meet": { icon: Users, bg: "bg-[#00897B]", fg: "text-white" },
  "google-ads": { icon: TrendingUp, bg: "bg-[#4285F4]", fg: "text-white" },
  "google-analytics": { icon: TrendingUp, bg: "bg-[#F9AB00]", fg: "text-white" },
  "google-classroom": { icon: Users, bg: "bg-[#0D9D58]", fg: "text-white" },

  // ── Communication ──
  slack: { icon: Slack, bg: "bg-[#4A154B]", fg: "text-white" },
  whatsapp: { icon: MessageCircle, bg: "bg-[#25D366]", fg: "text-white" },
  discord: { icon: MessageSquare, bg: "bg-[#5865F2]", fg: "text-white" },
  telegram: { icon: MessageCircle, bg: "bg-[#229ED9]", fg: "text-white" },
  twilio: { icon: Send, bg: "bg-[#F22F46]", fg: "text-white" },
  "microsoft-teams": { icon: Users, bg: "bg-[#6264A7]", fg: "text-white" },
  outlook: { icon: Mail, bg: "bg-[#0078D4]", fg: "text-white" },
  email: { icon: Mail, bg: "bg-[#B45309]", fg: "text-white" },
  "email-parser": { icon: Mail, bg: "bg-[#7C3AED]", fg: "text-white" },
  vonage: { icon: Send, bg: "bg-[#00B9F1]", fg: "text-white" },
  messagebird: { icon: Send, bg: "bg-[#FF6200]", fg: "text-white" },
  zoom: { icon: Users, bg: "bg-[#2D8CFF]", fg: "text-white" },
  mattermost: { icon: MessageSquare, bg: "bg-[#0072C6]", fg: "text-white" },
  sendgrid: { icon: Send, bg: "bg-[#1A82E2]", fg: "text-white" },
  rss: { icon: Globe, bg: "bg-[#EA580C]", fg: "text-white" },

  // ── CRM ──
  hubspot: { icon: Layers, bg: "bg-[#FF7A59]", fg: "text-white" },
  salesforce: { icon: Database, bg: "bg-[#00A1E0]", fg: "text-white" },
  pipedrive: { icon: TrendingUp, bg: "bg-[#1B2C42]", fg: "text-white" },
  "zoho-crm": { icon: Database, bg: "bg-[#E42527]", fg: "text-white" },
  close: { icon: Database, bg: "bg-[#1F2937]", fg: "text-white" },
  copper: { icon: Database, bg: "bg-[#3282F6]", fg: "text-white" },
  freshsales: { icon: TrendingUp, bg: "bg-[#1F6DED]", fg: "text-white" },
  keap: { icon: Layers, bg: "bg-[#2B5AED]", fg: "text-white" },

  // ── Developer ──
  github: { icon: Github, bg: "bg-[#24292F]", fg: "text-white" },
  jira: { icon: Globe, bg: "bg-[#0052CC]", fg: "text-white" },
  linear: { icon: Globe, bg: "bg-[#5E6AD2]", fg: "text-white" },
  gitlab: { icon: Globe, bg: "bg-[#FC6D26]", fg: "text-white" },
  bitbucket: { icon: Globe, bg: "bg-[#2684FF]", fg: "text-white" },
  vercel: { icon: Globe, bg: "bg-ink", fg: "text-elevated" },
  netlify: { icon: Globe, bg: "bg-[#00C7B7]", fg: "text-white" },
  pagerduty: { icon: Zap, bg: "bg-[#06AC38]", fg: "text-white" },
  sentry: { icon: Globe, bg: "bg-[#362D59]", fg: "text-white" },
  datadog: { icon: TrendingUp, bg: "bg-[#632CA6]", fg: "text-white" },

  // ── AI ──
  openai: { icon: Sparkles, bg: "bg-[#10A37F]", fg: "text-white" },
  anthropic: { icon: Bot, bg: "bg-[#D97757]", fg: "text-white" },
  gemini: { icon: Sparkles, bg: "bg-[#4285F4]", fg: "text-white" },
  ai: { icon: Sparkles, bg: "bg-[#7C3AED]", fg: "text-white" },
  "ai-guardrails": { icon: Zap, bg: "bg-[#B45309]", fg: "text-white" },
  agents: { icon: Bot, bg: "bg-[#7C3AED]", fg: "text-white" },
  chatbots: { icon: MessageSquare, bg: "bg-[#2563EB]", fg: "text-white" },
  huggingface: { icon: Bot, bg: "bg-[#FFD21E]", fg: "text-ink" },
  cohere: { icon: Sparkles, bg: "bg-[#39594D]", fg: "text-white" },
  replicate: { icon: Globe, bg: "bg-ink", fg: "text-elevated" },
  elevenlabs: { icon: Sparkles, bg: "bg-[#000000]", fg: "text-white" },

  // ── Productivity ──
  notion: { icon: Hash, bg: "bg-[#111111]", fg: "text-white" },
  asana: { icon: Globe, bg: "bg-[#F06A6A]", fg: "text-white" },
  clickup: { icon: Globe, bg: "bg-[#7B68EE]", fg: "text-white" },
  monday: { icon: Globe, bg: "bg-[#FF3D57]", fg: "text-white" },
  trello: { icon: Trello, bg: "bg-[#0079BF]", fg: "text-white" },
  calendly: { icon: Calendar, bg: "bg-[#006BFF]", fg: "text-white" },
  basecamp: { icon: Globe, bg: "bg-[#1D2D35]", fg: "text-white" },
  wrike: { icon: Globe, bg: "bg-[#0E4DA4]", fg: "text-white" },
  smartsheet: { icon: FileSpreadsheet, bg: "bg-[#0073EA]", fg: "text-white" },
  todoist: { icon: Globe, bg: "bg-[#E44332]", fg: "text-white" },
  miro: { icon: Globe, bg: "bg-[#FFD02F]", fg: "text-ink" },
  confluence: { icon: Globe, bg: "bg-[#172B4D]", fg: "text-white" },
  "microsoft-excel": { icon: FileSpreadsheet, bg: "bg-[#217346]", fg: "text-white" },
  coda: { icon: Globe, bg: "bg-[#F46A54]", fg: "text-white" },

  // ── Storage / Files ──
  dropbox: { icon: Folder, bg: "bg-[#0061FF]", fg: "text-white" },
  box: { icon: Folder, bg: "bg-[#0061D5]", fg: "text-white" },
  onedrive: { icon: Folder, bg: "bg-[#0078D4]", fg: "text-white" },
  sharepoint: { icon: Folder, bg: "bg-[#038387]", fg: "text-white" },
  "amazon-s3": { icon: Database, bg: "bg-[#FF9900]", fg: "text-white" },

  // ── Payments / Commerce ──
  stripe: { icon: CreditCard, bg: "bg-[#635BFF]", fg: "text-white" },
  shopify: { icon: ShoppingCart, bg: "bg-[#96BF48]", fg: "text-white" },
  woocommerce: { icon: ShoppingCart, bg: "bg-[#7B5EA7]", fg: "text-white" },
  bigcommerce: { icon: ShoppingCart, bg: "bg-[#34313F]", fg: "text-white" },
  etsy: { icon: ShoppingCart, bg: "bg-[#F1641E]", fg: "text-white" },
  square: { icon: CreditCard, bg: "bg-ink", fg: "text-elevated" },
  paypal: { icon: CreditCard, bg: "bg-[#003087]", fg: "text-white" },
  chargebee: { icon: CreditCard, bg: "bg-[#48B89A]", fg: "text-white" },
  razorpay: { icon: CreditCard, bg: "bg-[#072654]", fg: "text-white" },

  // ── Finance / Accounting ──
  quickbooks: { icon: CreditCard, bg: "bg-[#2CA01C]", fg: "text-white" },
  xero: { icon: CreditCard, bg: "bg-[#13B5EA]", fg: "text-white" },
  freshbooks: { icon: CreditCard, bg: "bg-[#0075DD]", fg: "text-white" },
  expensify: { icon: CreditCard, bg: "bg-[#00A65E]", fg: "text-white" },

  // ── Support ──
  zendesk: { icon: Globe, bg: "bg-[#03363D]", fg: "text-white" },
  intercom: { icon: MessageSquare, bg: "bg-[#286EFA]", fg: "text-white" },
  freshdesk: { icon: Globe, bg: "bg-[#26A69A]", fg: "text-white" },
  helpscout: { icon: MessageSquare, bg: "bg-[#398CDE]", fg: "text-white" },
  front: { icon: MessageSquare, bg: "bg-[#4353FF]", fg: "text-white" },
  gorgias: { icon: MessageSquare, bg: "bg-[#4B5CFA]", fg: "text-white" },
  crisp: { icon: MessageSquare, bg: "bg-[#4B5CFA]", fg: "text-white" },

  // ── Marketing ──
  mailchimp: { icon: Mail, bg: "bg-[#FFE01B]", fg: "text-ink" },
  activecampaign: { icon: Mail, bg: "bg-[#356AE6]", fg: "text-white" },
  klaviyo: { icon: Mail, bg: "bg-[#1C1C1C]", fg: "text-white" },
  brevo: { icon: Mail, bg: "bg-[#0B9B5E]", fg: "text-white" },
  convertkit: { icon: Mail, bg: "bg-[#FB6970]", fg: "text-white" },
  mailerlite: { icon: Mail, bg: "bg-[#39C376]", fg: "text-white" },

  // ── Social ──
  linkedin: { icon: Users, bg: "bg-[#0077B5]", fg: "text-white" },
  facebook: { icon: Globe, bg: "bg-[#1877F2]", fg: "text-white" },
  instagram: { icon: Globe, bg: "bg-[#E4405F]", fg: "text-white" },
  youtube: { icon: Globe, bg: "bg-[#FF0000]", fg: "text-white" },
  twitter: { icon: Globe, bg: "bg-ink", fg: "text-elevated" },
  reddit: { icon: Globe, bg: "bg-[#FF4500]", fg: "text-white" },
  pinterest: { icon: Globe, bg: "bg-[#E60023]", fg: "text-white" },
  tiktok: { icon: Globe, bg: "bg-ink", fg: "text-elevated" },
  buffer: { icon: Globe, bg: "bg-[#168EEA]", fg: "text-white" },
  spotify: { icon: Globe, bg: "bg-[#1DB954]", fg: "text-white" },

  // ── Forms / Surveys ──
  typeform: { icon: FormInput, bg: "bg-[#262627]", fg: "text-white" },
  jotform: { icon: FormInput, bg: "bg-[#FF6100]", fg: "text-white" },
  surveymonkey: { icon: FormInput, bg: "bg-[#00BF6F]", fg: "text-white" },
  tally: { icon: FormInput, bg: "bg-[#7C3AED]", fg: "text-white" },

  // ── Databases ──
  postgresql: { icon: Database, bg: "bg-[#336791]", fg: "text-white" },
  mysql: { icon: Database, bg: "bg-[#4479A1]", fg: "text-white" },
  mongodb: { icon: Database, bg: "bg-[#116149]", fg: "text-white" },
  supabase: { icon: Database, bg: "bg-[#3ECF8E]", fg: "text-white" },
  firebase: { icon: Database, bg: "bg-[#FFCA28]", fg: "text-ink" },
  snowflake: { icon: Database, bg: "bg-[#29B5E8]", fg: "text-white" },
  bigquery: { icon: Database, bg: "bg-[#4285F4]", fg: "text-white" },
  airtable: { icon: Table2, bg: "bg-[#18BFFF]", fg: "text-white" },

  // ── HR ──
  bamboohr: { icon: Users, bg: "bg-[#7AC143]", fg: "text-white" },
  greenhouse: { icon: Users, bg: "bg-[#24A800]", fg: "text-white" },
  lever: { icon: Users, bg: "bg-[#3D6AFF]", fg: "text-white" },
  gusto: { icon: Users, bg: "bg-[#F45D48]", fg: "text-white" },
  workable: { icon: Users, bg: "bg-[#2B6FED]", fg: "text-white" },

  // ── CMS ──
  wordpress: { icon: Globe, bg: "bg-[#21759B]", fg: "text-white" },
  webflow: { icon: Globe, bg: "bg-[#146EF5]", fg: "text-white" },
  contentful: { icon: Globe, bg: "bg-[#2E96DB]", fg: "text-white" },
  ghost: { icon: Globe, bg: "bg-[#15171A]", fg: "text-white" },

  // ── Ads / Analytics ──
  "facebook-ads": { icon: TrendingUp, bg: "bg-[#1877F2]", fg: "text-white" },
  "linkedin-ads": { icon: TrendingUp, bg: "bg-[#0077B5]", fg: "text-white" },
  mixpanel: { icon: TrendingUp, bg: "bg-[#7856FF]", fg: "text-white" },
  amplitude: { icon: TrendingUp, bg: "bg-[#1B1F3B]", fg: "text-white" },
  segment: { icon: TrendingUp, bg: "bg-[#52BD95]", fg: "text-white" },

  // ── Scheduling ──
  "cal-com": { icon: Calendar, bg: "bg-[#292929]", fg: "text-white" },
  acuity: { icon: Calendar, bg: "bg-[#E8664A]", fg: "text-white" },

  // ── Legal ──
  docusign: { icon: Globe, bg: "bg-[#4C8C2B]", fg: "text-white" },
  pandadoc: { icon: Globe, bg: "bg-[#47805F]", fg: "text-white" },
  "dropbox-sign": { icon: Globe, bg: "bg-[#0061FF]", fg: "text-white" },
  clio: { icon: Globe, bg: "bg-[#47368A]", fg: "text-white" },

  // ── Logistics ──
  shipstation: { icon: Truck, bg: "bg-[#7AB648]", fg: "text-white" },
  shippo: { icon: Truck, bg: "bg-[#37B273]", fg: "text-white" },

  // ── ERP ──
  odoo: { icon: Globe, bg: "bg-[#875A7B]", fg: "text-white" },
  dynamics365: { icon: Globe, bg: "bg-[#002050]", fg: "text-white" },
  netsuite: { icon: Globe, bg: "bg-[#111E5C]", fg: "text-white" },

  // ── Events ──
  eventbrite: { icon: Globe, bg: "bg-[#F05537]", fg: "text-white" },
  meetup: { icon: Globe, bg: "bg-[#E0393E]", fg: "text-white" },

  // ── Notes ──
  evernote: { icon: Globe, bg: "bg-[#00A82D]", fg: "text-white" },
  onenote: { icon: Globe, bg: "bg-[#80397B]", fg: "text-white" },

  // ── Education ──
  teachable: { icon: Globe, bg: "bg-[#FF7A59]", fg: "text-white" },
  thinkific: { icon: Globe, bg: "bg-[#528BF0]", fg: "text-white" },

  // ── Security ──
  okta: { icon: Globe, bg: "bg-[#007DC1]", fg: "text-white" },
  auth0: { icon: Globe, bg: "bg-[#EB5424]", fg: "text-white" },

  // ── Real Estate ──
  "follow-up-boss": { icon: Globe, bg: "bg-[#2B47F4]", fg: "text-white" },
  appfolio: { icon: Globe, bg: "bg-[#00B4AA]", fg: "text-white" },

  // ── Platform ──
  manager: { icon: Zap, bg: "bg-[#334155]", fg: "text-white" }
};

export function AppIcon({ slug, size = "md", className }: { slug: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const cfg = MAP[slug] ?? { icon: Workflow, bg: "bg-muted", fg: "text-ink" };
  const Icon = cfg.icon;
  const box = size === "sm" ? "h-6 w-6 rounded-md" : size === "lg" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  const ic = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={cn("inline-flex items-center justify-center", box, cfg.bg, cfg.fg, className)}
      aria-label={`${slug.replace(/-/g, " ")} icon`}
      title={slug.replace(/-/g, " ")}
    >
      <Icon className={ic} />
    </span>
  );
}

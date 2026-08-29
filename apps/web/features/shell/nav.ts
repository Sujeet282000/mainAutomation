import {
  Activity,
  Blocks,
  Bot,
  BarChart3,
  CheckSquare,
  CreditCard,
  FileInput,
  LayoutDashboard,
  LayoutTemplate,
  MessageSquare,
  Network,
  Plug,
  Unplug,
  Settings,
  Sparkles,
  Table2,
  Workflow,
  Zap
} from "lucide-react";

export const NAV = [
  {
    label: "Automate",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/automations", label: "Workflows", icon: Workflow },
      { href: "/activity", label: "Runs", icon: Activity },
      { href: "/apps", label: "Apps", icon: Plug },
      { href: "/connections", label: "Connections", icon: Unplug },
      { href: "/integrations/health", label: "Integration Health", icon: Zap },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ]
  },
  {
    label: "Build",
    items: [
      { href: "/templates", label: "Templates", icon: LayoutTemplate },
      { href: "/tables", label: "Tables", icon: Table2 },
      { href: "/forms", label: "Forms", icon: FileInput },
      { href: "/interfaces", label: "Interfaces", icon: Blocks },
      { href: "/canvas", label: "Canvas", icon: Network }
    ]
  },
  {
    label: "AI",
    items: [
      { href: "/ai", label: "Copilot", icon: Sparkles },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/chatbots", label: "Chatbots", icon: MessageSquare },
      { href: "/approvals", label: "Approvals", icon: CheckSquare }
    ]
  },
  {
    label: "Workspace",
    items: [
      { href: "/developer", label: "Developer", icon: Plug },
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings }
    ]
  }
];

export const COMMANDS = [
  { href: "/dashboard", label: "Go to Dashboard" },
  { href: "/automations", label: "Go to Workflows" },
  { href: "/automations/new", label: "Create workflow" },
  { href: "/activity", label: "Go to Runs" },
  { href: "/apps", label: "Go to Apps" },
  { href: "/connections", label: "Go to Connections" },
  { href: "/templates", label: "Go to Templates" },
  { href: "/tables", label: "Go to Tables" },
  { href: "/forms", label: "Go to Forms" },
  { href: "/interfaces", label: "Go to Interfaces" },
  { href: "/canvas", label: "Go to Canvas" },
  { href: "/ai", label: "Open Copilot" },
  { href: "/agents", label: "Go to Agents" },
  { href: "/chatbots", label: "Go to Chatbots" },
  { href: "/approvals", label: "Go to Approvals" },
  { href: "/integrations/health", label: "Integration Health" },
  { href: "/analytics", label: "Analytics" },
  { href: "/developer", label: "Developer keys & MCP" },
  { href: "/billing", label: "Billing & usage" },
  { href: "/audit", label: "Audit log" },
  { href: "/notifications", label: "Notifications" },
  { href: "/settings", label: "Settings" }
];

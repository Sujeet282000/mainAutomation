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
  Slack,
  Sparkles,
  Table2,
  Timer,
  Webhook,
  Workflow,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, { icon: typeof Mail; bg: string; fg: string }> = {
  gmail: { icon: Mail, bg: "bg-[#EA4335]", fg: "text-white" },
  "google-sheets": { icon: FileSpreadsheet, bg: "bg-[#34A853]", fg: "text-white" },
  "google-calendar": { icon: Calendar, bg: "bg-[#4285F4]", fg: "text-white" },
  "google-drive": { icon: Folder, bg: "bg-[#F4B400]", fg: "text-white" },
  slack: { icon: Slack, bg: "bg-[#4A154B]", fg: "text-white" },
  whatsapp: { icon: MessageCircle, bg: "bg-[#25D366]", fg: "text-white" },
  stripe: { icon: CreditCard, bg: "bg-[#635BFF]", fg: "text-white" },
  hubspot: { icon: Layers, bg: "bg-[#FF7A59]", fg: "text-white" },
  salesforce: { icon: Database, bg: "bg-[#00A1E0]", fg: "text-white" },
  notion: { icon: Hash, bg: "bg-[#111111]", fg: "text-white" },
  github: { icon: Github, bg: "bg-[#24292F]", fg: "text-white" },
  discord: { icon: MessageSquare, bg: "bg-[#5865F2]", fg: "text-white" },
  telegram: { icon: MessageCircle, bg: "bg-[#229ED9]", fg: "text-white" },
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
  openai: { icon: Sparkles, bg: "bg-[#10A37F]", fg: "text-white" },
  anthropic: { icon: Bot, bg: "bg-[#D97757]", fg: "text-white" },
  gemini: { icon: Sparkles, bg: "bg-[#4285F4]", fg: "text-white" },
  tables: { icon: Table2, bg: "bg-teal", fg: "text-teal-fg" },
  forms: { icon: FormInput, bg: "bg-info", fg: "text-white" },
  subflow: { icon: Workflow, bg: "bg-teal", fg: "text-teal-fg" }
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

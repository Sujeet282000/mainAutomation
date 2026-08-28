"use client";

import { Calendar, ChevronRight, FileSpreadsheet, Mail, MessageSquare, Sparkles, Webhook, Workflow } from "lucide-react";

const ideas = [
  { title: "New email → spreadsheet", description: "Capture incoming emails in Google Sheets", icon: Mail, prompt: "When a new Gmail arrives, add the important details to a Google Sheets row" },
  { title: "Calendar reminder", description: "Send a reminder before an event", icon: Calendar, prompt: "When a Google Calendar event is coming up, send me a reminder" },
  { title: "Webhook automation", description: "Receive data and route the right action", icon: Webhook, prompt: "Catch a webhook, inspect the payload, branch on the data, and notify the right team" },
  { title: "AI lead routing", description: "Analyze a lead and send it where it belongs", icon: Sparkles, prompt: "When a new lead arrives, analyze it with AI and route it to the appropriate CRM and Slack channel" },
  { title: "WhatsApp notification", description: "Notify a customer automatically", icon: MessageSquare, prompt: "When a qualifying event happens, send a WhatsApp notification to the customer" },
  { title: "Sheet → email", description: "Turn new rows into personalized emails", icon: FileSpreadsheet, prompt: "When a new Google Sheets row is added, send a personalized email using the row data" },
];

export function IdeaSuggestions({ onSelect, compact = false }: { onSelect: (prompt: string) => void; compact?: boolean }) {
  return (
    <section className={compact ? "space-y-2" : "space-y-4"}>
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/10 text-violet-600"><Workflow className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold">Start with an idea</h3>
          </div>
          {!compact && <p className="mt-1 text-xs text-ink-muted">Pick a workflow and Copilot will turn it into a plan.</p>}
        </div>
        {!compact && <span className="text-[10px] text-ink-muted">Popular workflows</span>}
      </div>
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
        {ideas.map(({ title, description, icon: Icon, prompt }) => (
          <button key={title} type="button" onClick={() => onSelect(prompt)} className="group flex items-center gap-3 rounded-xl border border-line bg-elevated p-3 text-left transition-all hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-violet-600 transition-colors group-hover:bg-violet-600 group-hover:text-white"><Icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-ink">{title}</span><span className="mt-0.5 block truncate text-[11px] text-ink-muted">{description}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </section>
  );
}

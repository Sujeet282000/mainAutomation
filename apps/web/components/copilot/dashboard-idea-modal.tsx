"use client";

import { useState } from "react";
import { ArrowRight, Calendar, FileSpreadsheet, Lightbulb, Mail, MessageSquare, Sparkles, Webhook, X } from "lucide-react";
import { IdeaSuggestions } from "./idea-suggestions";

export function DashboardIdeaModal({ onSelect }: { onSelect: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:-translate-y-0.5 hover:bg-violet-100"><Lightbulb className="h-3.5 w-3.5" /> Ideas <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px]">6</span></button>;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}><div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-line bg-elevated shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="flex items-center gap-3 border-b border-line px-5 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white"><Lightbulb className="h-4 w-4" /></span><div className="flex-1"><h2 className="text-sm font-semibold">Start with an idea</h2><p className="text-[11px] text-ink-muted">Choose a goal and Copilot will turn it into a workflow plan.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-muted hover:bg-muted" aria-label="Close ideas"><X className="h-4 w-4" /></button></div><div className="max-h-[70vh] overflow-y-auto p-5"><IdeaSuggestions onSelect={(prompt) => { setOpen(false); onSelect(prompt); }} /></div></div></div>;
}

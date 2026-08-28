"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, CheckCircle2, FileSpreadsheet, Mail, MessageSquare, Sparkles, Webhook, WandSparkles, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { generateCopilotDraft, persistCopilotSession } from "@/lib/copilot";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

const examples = [
  { label: "New email → spreadsheet", description: "Capture important Gmail messages in Sheets", icon: Mail, prompt: "When a new Gmail email arrives, add the sender, subject, and body to a Google Sheets row." },
  { label: "Calendar → Slack", description: "Send a daily summary of today's events", icon: Calendar, prompt: "Every morning, find today's Google Calendar events and send a Slack summary." },
  { label: "Webhook → HTTP", description: "Receive data and forward it automatically", icon: Webhook, prompt: "When a webhook arrives, POST the body to an HTTP endpoint." },
  { label: "Lead → AI → Slack", description: "Analyze leads and alert the right team", icon: Sparkles, prompt: "When a new lead arrives, analyze it with AI and send qualified leads to Slack." },
  { label: "Sheets → email", description: "Turn new rows into personalized messages", icon: FileSpreadsheet, prompt: "When a new Google Sheets row is added, send a personalized email using the row data." },
  { label: "WhatsApp notification", description: "Notify customers when an event happens", icon: MessageSquare, prompt: "When a qualifying event happens, send a WhatsApp notification to the customer." },
];

export default function AiPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [msg, setMsg] = useState("");
  const [building, setBuilding] = useState(false);
  const build = async (value = prompt) => {
    if (!value.trim() || building) return;
    setPrompt(value); setMsg(""); setBuilding(true);
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
      const d = await generateCopilotDraft({ prompt: value, mode: "auto_build" }, undefined, controller.signal); clearTimeout(timeout);
      const created = await api<{ automation: { id: string } }>("/automations", { method: "POST", body: JSON.stringify({ name: value.slice(0, 60) || "Copilot draft", graph: d.graph, origin: "copilot" }) });
      persistCopilotSession(d.sessionId, created.automation.id).catch(() => undefined);
      router.push(`/automations/${created.automation.id}/editor?idea=${encodeURIComponent(value)}`);
    } catch (err) { setMsg(err instanceof DOMException && err.name === "AbortError" ? "Copilot took too long. Check your workflows before trying again." : err instanceof Error ? err.message : "Copilot unavailable"); } finally { setBuilding(false); }
  };
  return <div className="mx-auto max-w-5xl pb-10">
    <PageHeader title="Copilot" description="Turn a plain-language goal into a workflow draft, then review it before anything runs." />
    <section className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-elevated p-6 shadow-sm sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-muted/70 px-3 py-1 text-xs font-semibold text-ink"><Sparkles className="h-3.5 w-3.5 text-violet-600" /> AI workflow builder <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready</div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">What would you like to automate?</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">Tell Copilot the outcome you want. It will turn your idea into a real workflow with triggers, actions, and mappings.</p>
      </div>
      <form className="relative mt-7 rounded-2xl border border-line bg-muted/30 p-3 shadow-xl shadow-violet-500/5 transition-colors focus-within:border-violet-400 focus-within:bg-elevated" onSubmit={(e) => { e.preventDefault(); void build(); }}>
        <textarea className="min-h-[112px] w-full resize-y border-0 bg-transparent p-2 text-base text-ink outline-none placeholder:text-ink-muted/60" placeholder="Tell Copilot what result you want… e.g. “When I receive a new lead, qualify it with AI and notify sales.”" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-3"><div className="flex items-center gap-2 text-xs text-ink-muted"><Zap className="h-3.5 w-3.5 text-violet-600" /> You review the draft before it runs.</div><Button type="submit" disabled={!prompt.trim() || building} className="bg-violet-600 text-white hover:bg-violet-700">{building ? <><Sparkles className="mr-1.5 h-3.5 w-3.5 animate-pulse" /> Building…</> : <>Build workflow <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>}</Button></div>
      </form>
      {building && <div className="relative mt-3 flex items-center gap-3 rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-xs text-violet-700 dark:text-violet-300"><span className="relative flex h-5 w-5 items-center justify-center"><span className="absolute h-5 w-5 animate-ping rounded-full bg-violet-400/30" /><Sparkles className="relative h-3.5 w-3.5" /></span><div><p className="font-semibold">Copilot is building your draft</p><p className="text-violet-700/70 dark:text-violet-300/70">Mapping apps, events, and fields…</p></div></div>}
      {msg && <p className="relative mt-3 text-sm text-danger">{msg}</p>}
    </section>
    <section className="mt-8 rounded-3xl border border-line bg-elevated p-5 sm:p-6">
      <div className="flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600"><Sparkles className="h-4 w-4" /></span><h2 className="text-base font-semibold text-ink">Need a starting point?</h2></div><p className="mt-1 text-xs text-ink-muted">Pick a popular automation, then customize the idea in your own words.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-ink-muted">6 popular ideas</span></div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {examples.map(({ label, description, icon: Icon, prompt: examplePrompt }) => <button key={label} type="button" disabled={building} onClick={() => { setPrompt(examplePrompt); void build(examplePrompt); }} className="group relative overflow-hidden rounded-2xl border border-line bg-muted/20 p-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-violet-400/60 hover:bg-violet-500/[0.06] hover:shadow-lg hover:shadow-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:pointer-events-none disabled:opacity-60"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-elevated text-violet-600 shadow-sm transition-all group-hover:scale-105 group-hover:border-violet-400/50 group-hover:bg-violet-600 group-hover:text-white"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink transition-colors group-hover:text-violet-700 dark:group-hover:text-violet-300">{label}</span><span className="mt-1 block text-xs leading-relaxed text-ink-muted">{description}</span></span><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-all group-hover:translate-x-1 group-hover:text-violet-500" /></div></button>)}
      </div>
    </section>
    <section className="mt-6 grid gap-3 sm:grid-cols-3">
      {[{ icon: Sparkles, title: "Describe", body: "Start with the result you want. You don't need to know every technical field." }, { icon: CheckCircle2, title: "Review", body: "Check apps, triggers, actions, fields, and connections before building." }, { icon: WandSparkles, title: "Test", body: "Run a sample and verify the workflow before you put it live." }].map(({ icon: Icon, title, body }) => <div key={title} className="rounded-2xl border border-line bg-elevated p-4 transition-colors hover:border-violet-400/40 hover:bg-violet-500/[0.03]"><Icon className="h-4 w-4 text-violet-600" /><p className="mt-3 text-sm font-semibold text-ink">{title}</p><p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p></div>)}
    </section>
  </div>;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Mail, Plus, Sparkles, Table2, Webhook, WandSparkles } from "lucide-react";
import { api } from "@/lib/api";
import { generateCopilotDraft, persistCopilotSession } from "@/lib/copilot";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export default function AiPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [msg, setMsg] = useState("");
  const examples = [
    { label: "New email to spreadsheet", icon: Mail, prompt: "When a new Gmail email arrives, add the sender, subject, and body to a Google Sheets row." },
    { label: "Calendar reminder", icon: Calendar, prompt: "Every morning, find today's Google Calendar events and send a Slack summary." },
    { label: "Webhook automation", icon: Webhook, prompt: "When a webhook arrives, POST the body to an HTTP endpoint." }
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Copilot" description="Build an automation from a plain-language goal, then review every step before it runs." />
      <section className="relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-orange-50 p-6 shadow-sm sm:p-8">
        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700">
            <Sparkles className="h-3.5 w-3.5" /> Build-time Copilot
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">What would you like to automate?</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Copilot writes a real draft: apps, events, and mappings. You connect accounts and you publish.
          </p>
        </div>
        <form
          className="relative mt-7 rounded-xl border border-violet-200 bg-white p-3 shadow-lg"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!prompt.trim()) return;
            setMsg("");
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 45000);
              const d = await generateCopilotDraft({ prompt, mode: "auto_build" }, undefined, controller.signal);
              clearTimeout(timeout);
              const created = await api<{ automation: { id: string } }>("/automations", {
                method: "POST",
                body: JSON.stringify({ name: prompt.slice(0, 60) || "Copilot draft", graph: d.graph, origin: "copilot" })
              });
              persistCopilotSession(d.sessionId, created.automation.id).catch(() => undefined);
              router.push(`/automations/${created.automation.id}/editor?idea=${encodeURIComponent(prompt)}`);
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") {
                setMsg("Copilot took too long. The workflow may still have been created — check your workflows.");
              } else {
                setMsg(err instanceof Error ? err.message : "Copilot unavailable");
              }
            }
          }}
        >
          <textarea
            className="min-h-[120px] w-full resize-y border-0 bg-transparent p-2 text-base outline-none placeholder:text-ink-muted/70"
            placeholder="Example: When a new lead is added, enrich it and notify my sales team in Slack..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex items-center justify-between border-t border-line px-2 pt-3">
            <span className="text-xs text-ink-muted">Copilot is AI and can make mistakes. It cannot sign in or publish.</span>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={!prompt.trim()}>
                Build
              </Button>
            </div>
          </div>
        </form>
        {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      </section>
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Start with an idea</h2><span className="text-xs text-ink-muted">Popular workflows</span></div>
        <div className="grid gap-3 md:grid-cols-3">
          {examples.map(({ label, icon: Icon, prompt: examplePrompt }) => (
            <button key={label} type="button" className="flex items-center gap-3 rounded-xl border border-line bg-elevated p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm" onClick={() => setPrompt(examplePrompt)}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-violet-600"><Icon className="h-4 w-4" /></span>
              <span className="flex-1 text-sm font-medium">{label}</span><Plus className="h-4 w-4 text-ink-muted" />
            </button>
          ))}
        </div>
      </section>
      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        {[{ icon: Sparkles, title: "Describe", body: "Start with the result you want." }, { icon: Table2, title: "Review", body: "Check apps, fields, and connections." }, { icon: WandSparkles, title: "Test", body: "Run a sample before going live." }].map(({ icon: Icon, title, body }) => <div key={title} className="border-t border-line pt-3"><Icon className="h-4 w-4 text-violet-600" /><p className="mt-2 text-sm font-medium">{title}</p><p className="mt-1 text-xs text-ink-muted">{body}</p></div>)}
      </section>
    </div>
  );
}

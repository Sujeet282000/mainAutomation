"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate, Sparkles, Workflow } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { generateCopilotDraft, persistCopilotSession } from "@/lib/copilot";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

export default function NewAutomationPage() {
  const router = useRouter();
  const [name, setName] = useState("Untitled workflow");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<{ templates: Array<{ slug: string; name: string; description?: string }> }>("/templates")
  });

  async function createBlank() {
    setBusy(true);
    try {
      const d = await api<{ automation: { id: string } }>("/automations", { method: "POST", body: JSON.stringify({ name }) });
      router.push(`/automations/${d.automation.id}/editor`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create workflow" description="Start from a blank flow, a template, or describe what you want Copilot to build." />
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex flex-col">
          <Workflow className="mb-3 h-5 w-5 text-teal" />
          <h2 className="text-[15px] font-medium">Create from scratch</h2>
          <p className="mt-1 flex-1 text-sm text-ink-muted">Start with a blank workflow. Choose a trigger, then add actions.</p>
          <Input className="mt-4" value={name} onChange={(e) => setName(e.target.value)} />
          <Button className="mt-3" onClick={() => void createBlank()} disabled={busy}>
            {busy ? "Creating…" : "Open builder"}
          </Button>
        </Card>
        <Card className="flex flex-col">
          <LayoutTemplate className="mb-3 h-5 w-5 text-teal" />
          <h2 className="text-[15px] font-medium">Start from a template</h2>
          <p className="mt-1 flex-1 text-sm text-ink-muted">Use a prebuilt automation, then connect your accounts.</p>
          <Link href="/templates" className="mt-4">
            <Button variant="secondary" className="w-full">
              Browse templates
            </Button>
          </Link>
        </Card>
      </div>
      <Card className="mt-3">
        <div className="mb-2 flex items-center gap-2 text-[15px] font-medium">
          <Sparkles className="h-4 w-4 text-teal" /> Describe what you want to automate
        </div>
        <textarea
          className="min-h-[88px] w-full rounded-lg border border-line bg-elevated p-3 text-sm"
          placeholder="When I receive a new lead from WhatsApp, extract their details and create a CRM contact."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const copilot = await generateCopilotDraft({ prompt, mode: "auto_build" });
              const d = await api<{ automation: { id: string } }>("/automations", {
                method: "POST",
                body: JSON.stringify({ name: prompt.slice(0, 60) || name, graph: copilot.graph, origin: "copilot" })
              });
              await persistCopilotSession(copilot.sessionId, d.automation.id).catch(() => undefined);
              router.push(`/automations/${d.automation.id}/editor?idea=${encodeURIComponent(prompt)}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Create failed");
              setBusy(false);
            }
          }}
        >
          Generate workflow
        </Button>
        <p className="mt-2 text-xs text-ink-muted">Creates a draft you can refine in the builder. Copilot cannot publish or create accounts.</p>
      </Card>
      {!!templates.data?.templates.length && (
        <p className="mt-6 text-sm text-ink-muted">
          Suggested: {templates.data.templates.slice(0, 3).map((t) => t.name).join(" · ")}
        </p>
      )}
    </div>
  );
}

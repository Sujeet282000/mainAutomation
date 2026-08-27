"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { summarizeGraph, type GraphPayload } from "@/lib/graph";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

type Tpl = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  required_apps?: string[];
  graph?: GraphPayload;
};

export default function TemplatesPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<{ templates: Tpl[] }>("/templates")
  });
  const items = useMemo(
    () => (list.data?.templates ?? []).filter((t) => `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase())),
    [list.data, q]
  );

  return (
    <div>
      <PageHeader title="Templates" description="Start from a proven workflow. Using a template creates a real draft automation." />
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-line bg-ink">
        <img
          alt="Workspace templates"
          className="h-36 w-full object-cover"
          src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=80"
        />
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-ink/80 via-ink/10 p-5 text-white"><div><p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-violet-200"><Sparkles className="h-3.5 w-3.5" /> FlowShip library</p><p className="mt-1 text-lg font-semibold">Start with a working flow, then make it yours.</p></div></div>
      </div>
      <Input className="mb-4 max-w-sm" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.isLoading && !items.length && (
        <EmptyState icon={<LayoutTemplate className="h-10 w-10" />} title="No templates" description="Seed the database to load starter templates." />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((t) => {
          const sum = summarizeGraph(t.graph);
          const apps = t.required_apps?.length ? t.required_apps : sum.apps;
          return (
            <Card key={t.slug} className="group flex flex-col transition hover:-translate-y-1 hover:border-violet-300">
              <p className="inline-flex w-fit rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">{t.category ?? "Workflow"}</p>
              <h3 className="mt-1 text-[15px] font-medium">{t.name}</h3>
              <p className="mt-1 flex-1 text-sm text-ink-muted">{t.description}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="flex -space-x-1">
                  {apps.slice(0, 5).map((slug) => (
                    <AppIcon key={slug} slug={slug} size="sm" className="ring-2 ring-elevated" />
                  ))}
                </span>
                <span className="truncate text-xs text-ink-muted">{sum.path}</span>
              </div>
              <Button
                className="mt-4"
                disabled={busy === t.slug}
                onClick={async () => {
                  setBusy(t.slug);
                  try {
                    const d = await api<{ automation: { id: string } }>(`/templates/${t.slug}/use`, {
                      method: "POST",
                      body: JSON.stringify({ name: t.name, graph: t.graph }),
                    });
                    router.push(`/automations/${d.automation.id}/editor`);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === t.slug ? "Creating…" : "Use template"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Page = { type: string; text?: string; formId?: string | null; href?: string };
type Iface = { id: string; name: string; slug: string; pages: Page[]; is_public: boolean };

export default function InterfacesPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const list = useQuery({ queryKey: ["interfaces"], queryFn: () => api<{ interfaces: Iface[] }>("/interfaces") });
  const forms = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: Array<{ id: string; name: string }> }>("/forms") });
  const [name, setName] = useState("Client portal");
  const [formId, setFormId] = useState("");

  return (
    <div>
      <PageHeader
        title="Interfaces"
        description="No-code pages that embed forms, links, and table views — the Interfaces product, separate from the workflow editor."
      />
      <Card className="mb-4 space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Page name" />
        <select className="w-full rounded-lg border border-line bg-elevated p-2 text-sm" value={formId} onChange={(e) => setFormId(e.target.value)}>
          <option value="">Embed a form (optional)</option>
          {(forms.data?.forms ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <Button
          onClick={async () => {
            await api("/interfaces", {
              method: "POST",
              body: JSON.stringify({
                name,
                isPublic: true,
                pages: [
                  { type: "heading", text: name },
                  { type: "text", text: "Welcome. Submit the form below or open a linked workflow later." },
                  { type: "form", formId: formId || null }
                ]
              })
            });
            qc.invalidateQueries({ queryKey: ["interfaces"] });
          }}
        >
          Create interface
        </Button>
      </Card>
      {!list.data?.interfaces.length && !list.isLoading && (
        <EmptyState
          icon={<Blocks className="h-10 w-10" />}
          title="No interfaces yet"
          description="Create a page, then share the public /i link."
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(list.data?.interfaces ?? []).map((p) => (
          <Card key={p.id}>
            <p className="text-xs uppercase text-ink-muted">Interface</p>
            <h3 className="font-semibold">{p.name}</h3>
            <Link className="text-sm text-teal" href={`/i/${ws}/${p.slug}`}>
              Open public view
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

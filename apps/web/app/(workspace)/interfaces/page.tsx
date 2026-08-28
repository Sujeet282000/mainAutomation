"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, ExternalLink, Globe, Lock, Plus, Trash2 } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Page = { type: string; text?: string; formId?: string | null; href?: string };
type Iface = { id: string; name: string; slug: string; pages: Page[]; is_public: boolean; created_at?: string };

function InterfaceCard({ iface, onDelete }: { iface: Iface; onDelete: () => void }) {
  const ws = getWorkspaceId();
  const publicUrl = `/i/${ws}/${iface.slug}`;
  return (
    <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-orange-400/40">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
            <Blocks className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{iface.name}</h3>
            <p className="text-[11px] text-ink-muted">{iface.pages.length} pages · {iface.is_public ? "Public" : "Private"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {iface.is_public ? <Globe className="h-3.5 w-3.5 text-ok" /> : <Lock className="h-3.5 w-3.5 text-ink-muted" />}
          <button className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted" onClick={(e) => e.stopPropagation()}>
          <ExternalLink className="h-2.5 w-2.5" /> Public page
        </a>
        <span className="text-[10px] text-ink-muted">{iface.pages.map((p) => p.type).join(" · ")}</span>
      </div>
    </Card>
  );
}

export default function InterfacesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["interfaces"], queryFn: () => api<{ interfaces: Iface[] }>("/interfaces") });
  const [createName, setCreateName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <PageHeader
        title="Interfaces"
        description="No-code pages with forms, tables, buttons, and charts."
        actions={
          <div className="flex items-center gap-2">
            <PageInfo
              title="Interfaces"
              description="Interfaces are no-code pages that combine forms, tables, buttons, and text into a shareable portal or dashboard."
              tips={[
                "Add a heading, text, and form to create a portal page.",
                "Connect to a Table to display live data.",
                "Make it public to share with customers or team members.",
                "Use the public /i link to embed in websites or emails.",
              ]}
            />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />New interface
            </Button>
          </div>
        }
      />

      {showCreate && (
        <Card className="mb-4">
          <p className="mb-2 text-xs font-semibold text-ink-muted">Create interface</p>
          <div className="flex gap-2">
            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Page name (e.g. Customer Portal)" className="max-w-xs" autoFocus />
            <Button onClick={async () => {
              if (!createName.trim()) return;
              await api("/interfaces", { method: "POST", body: JSON.stringify({ name: createName, isPublic: true, pages: [{ type: "heading", text: createName }, { type: "text", text: "Welcome to this interface." }] }) });
              setCreateName(""); setShowCreate(false); qc.invalidateQueries({ queryKey: ["interfaces"] });
            }}>Create</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {!list.isLoading && !list.data?.interfaces.length && (
        <EmptyState icon={<Blocks className="h-10 w-10" />} title="No interfaces yet" description="Create a page with forms, tables, and buttons." />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.interfaces ?? []).map((p) => (
          <InterfaceCard key={p.id} iface={p} onDelete={async () => {
            if (confirm(`Delete "${p.name}"?`)) { await api(`/interfaces/${p.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["interfaces"] }); }
          }} />
        ))}
      </div>
    </div>
  );
}

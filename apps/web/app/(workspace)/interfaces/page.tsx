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
import { toast } from "sonner";

type Block = { type: string; text?: string; tableId?: string | null; formId?: string | null; automationId?: string | null; buttonLabel?: string };
type Page = Block;
type Iface = { id: string; name: string; slug: string; pages: Page[]; is_public: boolean; created_at?: string };

function InterfaceCard({ iface, onDelete }: { iface: Iface; onDelete: () => void }) {
  const ws = getWorkspaceId();
  const publicUrl = `/i/${ws}/${iface.slug}`;
  return (
    <Card interactive className="group hover:border-orange-400/40">
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
  const [editing, setEditing] = useState<Iface | null>(null);

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

      <div className="ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.interfaces ?? []).map((p) => (
          <div key={p.id} onClick={() => setEditing(p)} role="button" tabIndex={0}>
            <InterfaceCard iface={p} onDelete={async () => {
              if (confirm(`Delete "${p.name}"?`)) { await api(`/interfaces/${p.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["interfaces"] }); }
            }} />
          </div>
        ))}
      </div>

      {editing && <InterfaceEditor iface={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── Interface editor: add/edit/remove real blocks and save via PATCH ── */

const BLOCK_LIBRARY: Array<{ type: Block["type"]; label: string }> = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "table", label: "Live table" },
  { type: "form", label: "Embedded form" },
  { type: "button", label: "Run-workflow button" },
];

function InterfaceEditor({ iface, onClose }: { iface: Iface; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(iface.name);
  const [isPublic, setIsPublic] = useState(iface.is_public);
  const [pages, setPages] = useState<Block[]>(Array.isArray(iface.pages) ? iface.pages : []);
  const [saving, setSaving] = useState(false);
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string }> }>("/tables") });
  const forms = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: Array<{ id: string; name: string }> }>("/forms") });
  const automations = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations") });

  function update(i: number, patch: Partial<Block>) {
    setPages((p) => p.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/interfaces/${iface.id}`, { method: "PATCH", body: JSON.stringify({ name, isPublic, pages }) });
      toast.success("Interface saved");
      qc.invalidateQueries({ queryKey: ["interfaces"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          <Blocks className="h-5 w-5 text-orange-500" />
          <Input className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" className="h-3.5 w-3.5" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Public page
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 border-r border-line p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase text-ink-muted">Add block</p>
          {BLOCK_LIBRARY.map((b) => (
            <button
              key={b.type}
              className="mb-1.5 w-full rounded-lg border border-line px-2.5 py-2 text-left text-xs hover:border-orange-400/50"
              onClick={() => setPages((p) => [...p, b.type === "heading" ? { type: "heading", text: "New heading" } : b.type === "text" ? { type: "text", text: "New text block" } : b.type === "button" ? { type: "button", buttonLabel: "Run workflow", automationId: null } : { type: b.type, tableId: null, formId: null } as Block])}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-xl space-y-3">
            {pages.length === 0 && <p className="py-12 text-center text-sm text-ink-muted">Add blocks from the left panel.</p>}
            {pages.map((b, i) => (
              <div key={i} className="rounded-xl border border-line bg-elevated p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-muted">{b.type}</span>
                  <div className="flex items-center gap-1">
                    {i > 0 && <button className="px-1 text-xs text-ink-muted hover:text-ink" onClick={() => setPages((p) => { const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>}
                    {i < pages.length - 1 && <button className="px-1 text-xs text-ink-muted hover:text-ink" onClick={() => setPages((p) => { const n = [...p]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>↓</button>}
                    <button className="px-1 text-ink-muted hover:text-danger" onClick={() => setPages((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {(b.type === "heading" || b.type === "text") && (
                  <Input value={b.text ?? ""} placeholder="Text content" onChange={(e) => update(i, { text: e.target.value })} />
                )}
                {b.type === "table" && (
                  <select className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs" value={b.tableId ?? ""} onChange={(e) => update(i, { tableId: e.target.value || null })}>
                    <option value="">Select a table…</option>
                    {(tables.data?.tables ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {b.type === "form" && (
                  <select className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs" value={b.formId ?? ""} onChange={(e) => update(i, { formId: e.target.value || null })}>
                    <option value="">Select a form…</option>
                    {(forms.data?.forms ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
                {b.type === "button" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Button label" value={b.buttonLabel ?? ""} onChange={(e) => update(i, { buttonLabel: e.target.value })} />
                    <select className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs" value={b.automationId ?? ""} onChange={(e) => update(i, { automationId: e.target.value || null })}>
                      <option value="">Select workflow…</option>
                      {(automations.data?.automations ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

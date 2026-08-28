"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, FileInput, GripVertical, Plus, Trash2 } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string };
type FormRow = { id: string; name: string; slug: string; fields: Field[]; automation_id?: string | null; table_id?: string | null; created_at?: string };

const FIELD_TYPES = [
  { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "number", label: "Number" },
  { value: "textarea", label: "Long text" }, { value: "select", label: "Dropdown" }, { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" }, { value: "url", label: "URL" }, { value: "phone", label: "Phone" },
];

function FormBuilder({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const ws = getWorkspaceId();
  const publicUrl = `/f/${ws}/${form.slug}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex bg-bg">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <div className="flex items-center gap-3">
            <FileInput className="h-5 w-5 text-teal" />
            <span className="font-semibold">{form.name}</span>
            <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-medium text-teal">Form</span>
          </div>
          <div className="flex items-center gap-2">
            <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:bg-muted">
              <ExternalLink className="h-3 w-3" /> Public page
            </a>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={() => { navigator.clipboard.writeText(window.location.origin + publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Form preview */}
          <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/20 p-8">
            <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold">{form.name}</h2>
              <p className="mb-6 text-xs text-ink-muted">Fields marked with * are required</p>
              {form.fields.map((f) => (
                <div key={f.key} className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-ink">
                    {f.label}{f.required !== false && <span className="text-danger"> *</span>}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea className="w-full rounded-lg border border-line px-3 py-2 text-sm" rows={3} placeholder={f.placeholder} />
                  ) : f.type === "select" ? (
                    <select className="w-full rounded-lg border border-line px-3 py-2 text-sm"><option>Choose...</option></select>
                  ) : f.type === "checkbox" ? (
                    <div className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-line" /><span className="text-sm">{f.label}</span></div>
                  ) : (
                    <Input type={f.type} placeholder={f.placeholder ?? f.label} />
                  )}
                </div>
              ))}
              <Button className="mt-2 w-full">Submit</Button>
            </div>
          </div>
          {/* Fields panel */}
          <div className="w-72 border-l border-line bg-elevated p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase text-ink-muted">Form fields</p>
            {form.fields.map((f) => (
              <div key={f.key} className="mb-2 flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs">
                <GripVertical className="h-3 w-3 text-ink-muted" />
                <span className="flex-1 truncate font-medium">{f.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-ink-muted">{f.type}</span>
              </div>
            ))}
            <p className="mt-4 text-[10px] font-semibold uppercase text-ink-muted">Settings</p>
            <p className="mt-1 text-xs text-ink-muted">Table: {form.table_id ? "Connected" : "Not connected"}</p>
            <p className="text-xs text-ink-muted">Workflow: {form.automation_id ? "Connected" : "Not connected"}</p>
            <p className="mt-2 text-xs text-ink-muted">Submissions go directly to the connected table and can trigger a workflow.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FormsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const list = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: FormRow[] }>("/forms") });
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string }> }>("/tables") });
  const [createName, setCreateName] = useState("");
  const [tableId, setTableId] = useState("");
  const [open, setOpen] = useState<FormRow | null>(null);
  const [viewSubs, setViewSubs] = useState<string | null>(null);
  const [subs, setSubs] = useState<Array<{ id: string; data: unknown; created_at: string }>>([]);

  return (
    <div>      <PageHeader title="Forms" description="No-code forms that write to Tables and trigger workflows." actions={<div className="flex items-center gap-2"><PageInfo title="Forms" description="Forms collect data from users via a public link. Submissions can automatically write to a Table and trigger a Workflow." tips={["Create a form with fields like Name, Email, Phone, etc.","Connect to a Table to store submissions automatically.","Connect to a Workflow to process submissions (e.g. send welcome email).","Share the public /f link to collect responses from anyone.","View submissions inline or in the connected Table."]} /><Button onClick={async () => {
            const name = createName.trim() || "Untitled form";
            const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
            await api("/forms", { method: "POST", body: JSON.stringify({ name, slug, fields: [{ key: "name", type: "text", label: "Name" }, { key: "email", type: "email", label: "Email" }], tableId: tableId || undefined }) });
            setCreateName("");
            setTableId("");
            qc.invalidateQueries({ queryKey: ["forms"] });
          }}><Plus className="mr-1 h-3.5 w-3.5" />New form</Button></div>}
      />

      {createName === "" && !list.isLoading && !list.data?.forms.length && (
        <EmptyState icon={<FileInput className="h-10 w-10" />} title="No forms yet" description="Create a form, share the public link, and optionally write submissions into a table." />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.forms ?? []).map((f) => {
          const publicUrl = `/f/${ws}/${f.slug}`;
          return (
            <Card key={f.id} className="group cursor-pointer transition-all hover:shadow-md hover:border-teal/40" onClick={() => setOpen(f)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                    <FileInput className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{f.name}</h3>
                    <p className="text-[11px] text-ink-muted">{f.fields.length} fields · {f.table_id ? "→ Table" : "Standalone"}</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <ExternalLink className="h-2.5 w-2.5" /> Public link
                </a>
                {f.table_id && <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-medium text-teal">→ Table</span>}
                {f.automation_id && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">→ Workflow</span>}
              </div>
            </Card>
          );
        })}
      </div>

      {open && <FormBuilder form={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

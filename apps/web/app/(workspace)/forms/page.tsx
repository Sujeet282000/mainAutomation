"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, FileInput, GripVertical, Loader2, Plus, Table2, Trash2, Workflow } from "lucide-react";
import { api, API_URL, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string; options?: string[]; visibleWhen?: { field: string; op: string; value?: string | number } };

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Phone" },
  { value: "file", label: "File upload" },
  { value: "hidden", label: "Hidden field" },
];
type FormRow = { id: string; name: string; slug: string; fields: Field[]; table_id?: string | null; automation_id?: string | null; created_at?: string; submission_count?: number };
type Submission = { id: string; data: Record<string, unknown>; created_at: string };

const FIELD_TYPES = [
  { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "number", label: "Number" },
  { value: "textarea", label: "Long text" }, { value: "select", label: "Dropdown" }, { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" }, { value: "url", label: "URL" }, { value: "phone", label: "Phone" },
];

/* ── Form Builder ─────────────────────────────────────────────────────── */

function FormBuilder({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const publicUrl = `/f/${ws}/${form.slug}`;
  const [copied, setCopied] = useState(false);
  const [fields, setFields] = useState<Field[]>(form.fields);
  const [saving, setSaving] = useState(false);

  // Table sync state
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string; schema_json?: { fields?: Array<{ key: string; label?: string }> } }> }>("/tables") });
  const [connectTableId, setConnectTableId] = useState(form.table_id ?? "");
  const [syncFields, setSyncFields] = useState(true);

  // Workflow sync state
  const workflows = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations") });
  const [connectWorkflowId, setConnectWorkflowId] = useState(form.automation_id ?? "");

  // Submissions — server-paginated with CSV export
  const [showSubs, setShowSubs] = useState(false);
  const [subsBefore, setSubsBefore] = useState<string | null>(null);
  const subs = useQuery({
    queryKey: ["form-subs", form.id, subsBefore],
    queryFn: () => api<{ submissions: Submission[]; hasMore: boolean; nextBefore: string | null }>(
      `/forms/${form.id}/submissions?limit=50${subsBefore ? `&before=${encodeURIComponent(subsBefore)}` : ""}`,
    ),
    enabled: showSubs,
  });

  function exportCsv() {
    const token = localStorage.getItem("token") ?? "";
    window.open(`${API_URL}/forms/${form.id}/submissions?format=csv&limit=500`, "_blank");
  }

  async function saveConnections() {
    setSaving(true);
    try {
      await api(`/forms/${form.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tableId: connectTableId || null,
          automationId: connectWorkflowId || null,
          fields,
        }),
      });
      qc.invalidateQueries({ queryKey: ["forms"] });
    } finally { setSaving(false); }
  }

  async function saveFields() {
    setSaving(true);
    try {
      await api(`/forms/${form.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields }),
      });
      qc.invalidateQueries({ queryKey: ["forms"] });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* Top bar */}
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
          <button
            className="rounded-lg p-1.5 text-ink-muted hover:bg-muted"
            onClick={() => { navigator.clipboard.writeText(window.location.origin + publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Form preview */}
        <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/20 p-8">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-elevated p-6 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold">{form.name}</h2>
            <p className="mb-6 text-xs text-ink-muted">
              {connectTableId ? "Submissions will be saved to the connected table." : "Submissions are stored with this form."}
              {connectWorkflowId && " A workflow will be triggered on each submission."}
            </p>
            {fields.map((f, i) => (
              <div key={f.key} className="mb-4">
                <label className="mb-1 block text-xs font-medium text-ink">
                  {f.label}{f.required !== false && <span className="text-danger"> *</span>}
                </label>
                {f.type === "textarea" ? (
                  <textarea className="w-full rounded-lg border border-line px-3 py-2 text-sm" rows={3} placeholder={f.placeholder} readOnly />
                ) : f.type === "select" ? (
                  <select className="w-full rounded-lg border border-line px-3 py-2 text-sm" disabled>
                    <option>Choose…</option>
                    {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : f.type === "multiselect" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(f.options ?? []).length
                      ? (f.options ?? []).map((o) => <span key={o} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-muted">{o}</span>)
                      : <span className="text-[11px] text-ink-muted">No options configured.</span>}
                  </div>
                ) : f.type === "file" ? (
                  <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-ink-muted">File upload · max 5 MB</div>
                ) : f.type === "hidden" ? (
                  <div className="rounded border border-dashed border-line px-2 py-1 text-[10px] text-ink-muted">Hidden field — not shown publicly</div>
                ) : f.type === "checkbox" ? (
                  <div className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-line" disabled /><span className="text-sm">{f.label}</span></div>
                ) : (
                  <Input type={f.type === "phone" ? "tel" : f.type} placeholder={f.placeholder ?? f.label} readOnly />
                )}
              </div>
            ))}
            <Button className="mt-2 w-full" disabled>Submit (preview)</Button>
          </div>
        </div>

        {/* Settings panel */}
        <div className="w-80 border-l border-line bg-elevated overflow-y-auto">
          {/* Fields */}
          <div className="border-b border-line p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase text-ink-muted">Form fields ({fields.length})</p>
            {fields.map((f, i) => (
              <div key={f.key} className="mb-2 rounded-lg border border-line px-2.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-3 w-3 shrink-0 text-ink-muted" />
                  <input
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-line focus:border-teal focus:outline-none"
                    value={f.label}
                    placeholder="Field label"
                    onChange={(e) => { const n = [...fields]; n[i] = { ...f, label: e.target.value }; setFields(n); }}
                  />
                  <button
                    className="shrink-0 text-ink-muted hover:text-danger"
                    onClick={() => { const n = [...fields]; n.splice(i, 1); setFields(n); }}
                  >×</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <select
                    className="rounded border border-line bg-elevated px-1.5 py-1 text-[11px]"
                    value={f.type}
                    onChange={(e) => { const n = [...fields]; n[i] = { ...f, type: e.target.value }; setFields(n); }}
                  >
                    {FIELD_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input
                    className="rounded border border-line bg-elevated px-1.5 py-1 text-[11px]"
                    placeholder="Placeholder"
                    value={f.placeholder ?? ""}
                    onChange={(e) => { const n = [...fields]; n[i] = { ...f, placeholder: e.target.value || undefined }; setFields(n); }}
                  />
                </div>
                {(f.type === "select" || f.type === "multiselect") && (
                  <input
                    className="mt-1.5 w-full rounded border border-line bg-elevated px-1.5 py-1 text-[11px]"
                    placeholder="Options, comma-separated"
                    value={(f.options ?? []).join(", ")}
                    onChange={(e) => { const n = [...fields]; n[i] = { ...f, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }; setFields(n); }}
                  />
                )}
                <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-muted">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={f.required !== false}
                    onChange={(e) => { const n = [...fields]; n[i] = { ...f, required: e.target.checked }; setFields(n); }}
                  />
                  Required
                </label>
                {/* Conditional visibility — only validated/shown when the condition holds */}
                {i > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-ink-muted hover:text-teal">Show conditionally…</summary>
                    <div className="mt-1.5 grid grid-cols-3 gap-1">
                      <select
                        className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                        value={f.visibleWhen?.field ?? ""}
                        onChange={(e) => { const n = [...fields]; n[i] = { ...f, visibleWhen: e.target.value ? { field: e.target.value, op: f.visibleWhen?.op ?? "eq", value: f.visibleWhen?.value ?? "" } : undefined }; setFields(n); }}
                      >
                        <option value="">Always show</option>
                        {fields.filter((_, j) => j !== i && !/^(file|button|ai|formula|linked)$/.test(fields[j].type)).map((other) => (
                          <option key={other.key} value={other.key}>{other.label || other.key}</option>
                        ))}
                      </select>
                      {f.visibleWhen && (
                        <>
                          <select
                            className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                            value={f.visibleWhen.op}
                            onChange={(e) => { const n = [...fields]; n[i] = { ...f, visibleWhen: { ...f.visibleWhen!, op: e.target.value } }; setFields(n); }}
                          >
                            <option value="eq">equals</option>
                            <option value="neq">not equals</option>
                            <option value="contains">contains</option>
                            <option value="gt">&gt;</option>
                            <option value="lt">&lt;</option>
                            <option value="empty">is empty</option>
                            <option value="not_empty">is not empty</option>
                          </select>
                          {!/^(empty|not_empty)$/.test(f.visibleWhen.op) && (
                            <input
                              className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                              placeholder="Value"
                              value={String(f.visibleWhen.value ?? "")}
                              onChange={(e) => { const n = [...fields]; n[i] = { ...f, visibleWhen: { ...f.visibleWhen!, value: e.target.value } }; setFields(n); }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </div>
            ))}
            <button
              className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-muted hover:border-teal hover:text-teal"
              onClick={() => setFields([...fields, { key: `field_${Date.now()}`, type: "text", label: `Field ${fields.length + 1}`, required: true }])}
            >
              <Plus className="h-3 w-3" /> Add field
            </button>
            <Button size="sm" className="mt-2 w-full" onClick={saveFields} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save fields
            </Button>
          </div>

          {/* Table connection */}
          <div className="border-b border-line p-4">
            <div className="flex items-center gap-2 mb-3">
              <Table2 className="h-3.5 w-3.5 text-teal" />
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Table connection</p>
            </div>
            <p className="mb-2 text-[11px] text-ink-muted">
              Connect a table to store form submissions automatically. Each submission creates a new row.
            </p>
            <select
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs"
              value={connectTableId}
              onChange={(e) => setConnectTableId(e.target.value)}
            >
              <option value="">No table (standalone)</option>
              {(tables.data?.tables ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {connectTableId && (
              <div className="mt-2 rounded-lg bg-teal/5 p-2">
                <p className="text-[10px] font-medium text-teal">
                  ✓ Form fields will map to table columns. New submissions create new rows.
                </p>
              </div>
            )}
            {!connectTableId && (
              <button
                className="mt-2 text-[11px] text-teal hover:underline"
                onClick={async () => {
                  const name = prompt("Table name for form submissions:");
                  if (!name) return;
                  const d = await api<{ table: { id: string } }>("/tables", {
                    method: "POST",
                    body: JSON.stringify({ name, schema: { fields: fields.map((f) => ({ key: f.key, type: f.type, label: f.label })) } }),
                  });
                  if (d.table) { setConnectTableId(d.table.id); qc.invalidateQueries({ queryKey: ["tables"] }); }
                }}
              >
                + Create new table from form fields
              </button>
            )}
          </div>

          {/* Workflow connection */}
          <div className="border-b border-line p-4">
            <div className="flex items-center gap-2 mb-3">
              <Workflow className="h-3.5 w-3.5 text-violet-600" />
              <p className="text-[10px] font-semibold uppercase text-ink-muted">Workflow trigger</p>
            </div>
            <p className="mb-2 text-[11px] text-ink-muted">
              Connect a workflow to run automatically when someone submits this form.
            </p>
            <select
              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs"
              value={connectWorkflowId}
              onChange={(e) => setConnectWorkflowId(e.target.value)}
            >
              <option value="">No workflow</option>
              {(workflows.data?.automations ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {connectWorkflowId && (
              <div className="mt-2 rounded-lg bg-violet-50 p-2">
                <p className="text-[10px] font-medium text-violet-700">
                  ✓ Each submission will trigger this workflow with the form data.
                </p>
              </div>
            )}
          </div>

          {/* Submissions */}
          <div className="p-4">
            <button
              className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-xs hover:bg-muted"
              onClick={() => setShowSubs(!showSubs)}
            >
              <span className="font-medium">Submissions</span>
              <span className="flex items-center gap-2">
                {showSubs && subs.data?.submissions?.length ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-teal hover:text-teal"
                    onClick={(e) => { e.stopPropagation(); exportCsv(); }}
                  >
                    Export CSV
                  </span>
                ) : null}
                <span className="text-ink-muted">{showSubs ? "Hide" : "Show"}</span>
              </span>
            </button>
            {showSubs && subs.data && (
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                {subs.data.submissions.length === 0 && (
                  <p className="text-center text-[11px] text-ink-muted py-4">No submissions yet.</p>
                )}
                {subs.data.submissions.map((sub) => (
                  <div key={sub.id} className="rounded-lg border border-line p-2 text-[11px]">
                    <div className="flex items-center justify-between text-ink-muted">
                      <span>{new Date(sub.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(sub.data ?? {}).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="font-medium text-ink">{k}:</span>
                          <span className="truncate text-ink-muted">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {(subs.data.hasMore || subsBefore) && (
                  <div className="flex items-center justify-between pt-1">
                    <button
                      className="rounded border border-line px-2 py-1 text-[10px] text-ink-muted hover:border-teal hover:text-teal disabled:opacity-50"
                      disabled={!subsBefore}
                      onClick={() => setSubsBefore(null)}
                    >
                      Newest
                    </button>
                    <button
                      className="rounded border border-line px-2 py-1 text-[10px] text-ink-muted hover:border-teal hover:text-teal disabled:opacity-50"
                      disabled={!subs.data.hasMore}
                      onClick={() => setSubsBefore(subs.data!.nextBefore)}
                    >
                      Older →
                    </button>
                  </div>
                )}
              </div>
            )}
            {showSubs && subs.isError && (
              <p className="mt-2 rounded border border-danger/30 bg-danger/5 p-2 text-[11px] text-danger">
                Failed to load submissions. Please retry.
              </p>
            )}
          </div>

          {/* Save all */}
          <div className="sticky bottom-0 border-t border-line bg-elevated p-4">
            <Button className="w-full" onClick={saveConnections} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              Save connections
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────── */

export default function FormsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const list = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: FormRow[] }>("/forms") });
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string }> }>("/tables") });
  const [createName, setCreateName] = useState("");
  const [tableId, setTableId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [open, setOpen] = useState<FormRow | null>(null);

  return (
    <div>
      <PageHeader
        title="Forms"
        description="No-code forms that write to Tables and trigger workflows."
        actions={
          <div className="flex items-center gap-2">
            <PageInfo
              title="Forms"
              description="Forms collect data from users via a public link. Submissions can automatically write to a Table and trigger a Workflow."
              tips={[
                "Create a form with fields like Name, Email, Phone, etc.",
                "Connect to a Table to store submissions automatically.",
                "Connect to a Workflow to process submissions (e.g. send welcome email).",
                "Share the public /f link to collect responses from anyone.",
                "View submissions inline or in the connected Table.",
              ]}
            />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />New form
            </Button>
          </div>
        }
      />

      {showCreate && (
        <Card className="mb-4">
          <p className="mb-2 text-xs font-semibold text-ink-muted">Create a new form</p>
          <div className="flex gap-2 items-end">
            <div>
              <label className="mb-0.5 block text-[9px] text-ink-muted">Form name</label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Contact form, Survey, etc." className="max-w-xs" autoFocus />
            </div>
            <div>
              <label className="mb-0.5 block text-[9px] text-ink-muted">Connect to table (optional)</label>
              <select className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">No table</option>
                {(tables.data?.tables ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <Button onClick={async () => {
              if (!createName.trim()) return;
              const name = createName.trim();
              const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
              const fields = [{ key: "name", type: "text", label: "Name" }, { key: "email", type: "email", label: "Email" }];
              await api("/forms", { method: "POST", body: JSON.stringify({ name, slug, fields, tableId: tableId || undefined }) });
              setCreateName(""); setTableId(""); setShowCreate(false);
              qc.invalidateQueries({ queryKey: ["forms"] });
            }}>Create</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {!list.isLoading && !list.data?.forms.length && (
        <EmptyState
          icon={<FileInput className="h-10 w-10" />}
          title="No forms yet"
          description="Create a form, share the public link, and optionally write submissions into a table."
        />
      )}

      <div className="ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.forms ?? []).map((f) => {
          const publicUrl = `/f/${ws}/${f.slug}`;
          return (
            <Card key={f.id} interactive className="group hover:border-teal/40" onClick={() => setOpen(f)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                    <FileInput className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{f.name}</h3>
                    <p className="text-[11px] text-ink-muted">
                      {f.fields.length} fields · {f.submission_count ?? 0} submissions{f.table_id ? " · → Table" : ""}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href={publicUrl}
                  target="_blank"
                  className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted"
                  onClick={(e) => e.stopPropagation()}
                >
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

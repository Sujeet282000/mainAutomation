"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, Copy, ExternalLink, FileInput, GripVertical, Loader2, Plus, Save, Table2, Trash2, Workflow, X } from "lucide-react";
import { api, API_URL, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string; options?: string[]; visibleWhen?: { field: string; op: string; value?: string | number } };
type TableLite = { id: string; name: string; record_count?: number; schema_json?: { fields?: Array<{ key: string; type?: string; label?: string }> } };

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

function SectionHeader({ icon: Icon, step, title, badge, color }: { icon: typeof Table2; step: number; title: string; badge?: string; color: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className={cn("flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white", color)}>{step}</span>
      <Icon className="h-3.5 w-3.5 text-ink-muted" />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      {badge !== undefined && <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-ink-muted">{badge}</span>}
    </div>
  );
}

/* ── Form Builder ─────────────────────────────────────────────────────── */

function FormBuilder({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const publicUrl = `/f/${ws}/${form.slug}`;
  const [copied, setCopied] = useState(false);
  const [fields, setFields] = useState<Field[]>(form.fields);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Table sync state
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: TableLite[] }>("/tables") });
  const [connectTableId, setConnectTableId] = useState(form.table_id ?? "");
  const [creatingTable, setCreatingTable] = useState(false);
  const [newTableName, setNewTableName] = useState(`${form.name} submissions`);

  // Workflow sync state
  const workflows = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string; status: string }> }>("/automations") });
  const [connectWorkflowId, setConnectWorkflowId] = useState(form.automation_id ?? "");

  const connectedTable = (tables.data?.tables ?? []).find((t) => t.id === connectTableId);

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

  useEffect(() => { setDirty(true); }, [fields, connectTableId, connectWorkflowId]);

  function exportCsv() {
    window.open(`${API_URL}/forms/${form.id}/submissions?format=csv&limit=500`, "_blank");
  }

  async function saveAll() {
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
      qc.invalidateQueries({ queryKey: ["tables"] });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally { setSaving(false); }
  }

  function updateField(i: number, patch: Partial<Field>) {
    const n = [...fields];
    n[i] = { ...n[i], ...patch };
    setFields(n);
  }

  function onFieldDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.key === active.id);
    const to = fields.findIndex((f) => f.key === over.id);
    if (from < 0 || to < 0) return;
    setFields(arrayMove(fields, from, to));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function createTableFromFields() {
    const name = newTableName.trim() || `${form.name} submissions`;
    setCreatingTable(true);
    try {
      const d = await api<{ table: { id: string } }>("/tables", {
        method: "POST",
        body: JSON.stringify({ name, schema: { fields: fields.filter((f) => f.type !== "button").map((f) => ({ key: f.key, type: f.type === "file" ? "text" : f.type, label: f.label })) } }),
      });
      if (d.table) {
        setConnectTableId(d.table.id);
        qc.invalidateQueries({ queryKey: ["tables"] });
      }
    } finally { setCreatingTable(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line bg-elevated px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10">
            <FileInput className="h-4 w-4 text-blue-500" />
          </span>
          <div>
            <span className="block text-sm font-semibold leading-tight">{form.name}</span>
            <span className="text-[10px] text-ink-muted">{fields.length} fields · {form.submission_count ?? 0} submissions</span>
          </div>
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-500">Form</span>
        </div>
        <div className="flex items-center gap-1.5">
          <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-teal/40 hover:text-teal">
            <ExternalLink className="h-3 w-3" /> Public page
          </a>
          <button
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-muted hover:text-ink"
            title="Copy public link"
            onClick={() => { navigator.clipboard.writeText(window.location.origin + publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button className="rounded-lg p-1.5 text-ink-muted transition hover:bg-muted hover:text-ink" onClick={onClose} aria-label="Close builder"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Form preview */}
        <div className="flex flex-1 items-start justify-center overflow-auto bg-gradient-to-b from-muted/30 to-transparent p-8">
          <div className="w-full max-w-lg animate-reveal-up rounded-2xl border border-line bg-elevated p-6 shadow-card">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-lg font-semibold">{form.name}</h2>
              <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[9px] font-semibold text-teal">LIVE PREVIEW</span>
            </div>
            <p className="mb-6 text-xs leading-relaxed text-ink-muted">
              {connectTableId
                ? <>Submissions save to <b className="text-teal">{connectedTable?.name ?? "the connected table"}</b>.</>
                : "Submissions are stored with this form."}
              {connectWorkflowId && <> A workflow runs on each submission.</>}
            </p>
            {fields.length === 0 && (
              <p className="mb-4 rounded-xl border border-dashed border-line p-6 text-center text-xs text-ink-muted">
                No fields yet — add your first field on the right.
              </p>
            )}
            {fields.map((f, i) => (
              <div key={f.key} className="mb-4 animate-reveal-up" style={{ animationDelay: `${i * 60}ms` }}>
                <label className="mb-1 block text-xs font-medium text-ink">
                  {f.label}{f.required !== false && <span className="text-danger"> *</span>}
                </label>
                {f.type === "textarea" ? (
                  <textarea className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm transition focus:border-teal" rows={3} placeholder={f.placeholder} readOnly />
                ) : f.type === "select" ? (
                  <div className="relative">
                    <select className="w-full appearance-none rounded-lg border border-line bg-bg px-3 py-2 text-sm" disabled>
                      <option>Choose…</option>
                      {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-ink-muted" />
                  </div>
                ) : f.type === "multiselect" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(f.options ?? []).length
                      ? (f.options ?? []).map((o) => <span key={o} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-muted transition hover:border-teal/40 hover:text-teal">{o}</span>)
                      : <span className="text-[11px] text-ink-muted">No options configured.</span>}
                  </div>
                ) : f.type === "file" ? (
                  <div className="rounded-xl border-2 border-dashed border-line bg-muted/20 px-3 py-4 text-center transition hover:border-teal/40">
                    <p className="text-[11px] font-medium text-ink-muted">Click or drop a file</p>
                    <p className="text-[9px] text-ink-muted">Max 5 MB · stored securely</p>
                  </div>
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
            <p className="mt-3 text-center text-[9px] text-ink-muted">Powered by FlowShip</p>
          </div>
        </div>

        {/* Setup side panel */}
        <div className="flex w-[352px] shrink-0 flex-col border-l border-line bg-elevated">
          <div className="flex-1 overflow-y-auto">
            {/* 1 · Fields */}
            <div className="border-b border-line p-4">
              <SectionHeader icon={FileInput} step={1} title="Fields" badge={String(fields.length)} color="bg-blue-500" />
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd}>
                <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                {fields.map((f, i) => (
                  <SortableFieldCard
                    key={f.key}
                    index={i}
                    field={f}
                    total={fields.length}
                    onLabel={(v) => updateField(i, { label: v })}
                    onType={(v) => updateField(i, { type: v })}
                    onPlaceholder={(v) => updateField(i, { placeholder: v || undefined })}
                    onOptions={(v) => updateField(i, { options: v })}
                    onRequired={(v) => updateField(i, { required: v })}
                    onVisibleWhen={(v) => updateField(i, { visibleWhen: v })}
                    onRemove={() => setFields(fields.filter((_, j) => j !== i))}
                    otherFields={fields.filter((_, j) => j !== i)}
                  />
                ))}
                  </div>
                </SortableContext>
              </DndContext>
              <button
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-2.5 py-2.5 text-[11px] font-medium text-ink-muted transition-all hover:border-teal hover:bg-teal/5 hover:text-teal"
                onClick={() => setFields([...fields, { key: `field_${Date.now()}`, type: "text", label: `Field ${fields.length + 1}`, required: true }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add field
              </button>
            </div>

            {/* 2 · Destinations (table + workflow) */}
            <div className="border-b border-line p-4">
              <SectionHeader icon={Table2} step={2} title="Destinations" color="bg-teal" />

              {/* Table */}
              <div className="rounded-xl border border-line bg-bg p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Table2 className="h-3.5 w-3.5 text-teal" />
                  <p className="text-[11px] font-semibold">Save to table</p>
                  {connectTableId && <span className="ml-auto rounded-full bg-teal/10 px-1.5 py-0.5 text-[9px] font-semibold text-teal">Connected</span>}
                </div>
                <select
                  className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs transition focus:border-teal focus:outline-none"
                  value={connectTableId}
                  onChange={(e) => setConnectTableId(e.target.value)}
                >
                  <option value="">No table (standalone form)</option>
                  {(tables.data?.tables ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.record_count ?? 0} records</option>
                  ))}
                </select>
                {connectTableId && connectedTable && (
                  <div className="mt-2 rounded-lg bg-teal/5 p-2">
                    <p className="mb-1 text-[10px] font-semibold text-teal">Data flow</p>
                    <div className="space-y-1">
                      {fields.slice(0, 4).map((f) => (
                        <div key={f.key} className="flex items-center gap-1.5 text-[10px]">
                          <span className="min-w-0 flex-1 truncate text-ink">{f.label || f.key}</span>
                          <span className="text-teal">→</span>
                          <code className="rounded bg-elevated px-1 text-[9px] text-teal">{f.key}</code>
                        </div>
                      ))}
                      {fields.length > 4 && <p className="text-[9px] text-ink-muted">+{fields.length - 4} more fields</p>}
                    </div>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-ink-muted">Every submission inserts a row keyed by field name.</p>
                  </div>
                )}
                {!connectTableId && (
                  <div className="mt-2">
                    {!newTableName && <input className="mb-1.5 w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-[11px]" placeholder="Table name" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} autoFocus={false} />}
                    <button
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal/40 px-2.5 py-1.5 text-[11px] font-medium text-teal transition hover:bg-teal/5 disabled:opacity-50"
                      disabled={creatingTable}
                      onClick={createTableFromFields}
                    >
                      {creatingTable ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Create “{newTableName || form.name}” from these fields
                    </button>
                  </div>
                )}
              </div>

              {/* Workflow */}
              <div className="mt-2.5 rounded-xl border border-line bg-bg p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Workflow className="h-3.5 w-3.5 text-violet-600" />
                  <p className="text-[11px] font-semibold">Trigger workflow</p>
                  {connectWorkflowId && <span className="ml-auto rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">Connected</span>}
                </div>
                <select
                  className="w-full rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs transition focus:border-violet-400 focus:outline-none"
                  value={connectWorkflowId}
                  onChange={(e) => setConnectWorkflowId(e.target.value)}
                >
                  <option value="">No workflow</option>
                  {(workflows.data?.automations ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.status === "on" ? " · live" : ""}</option>
                  ))}
                </select>
                {connectWorkflowId && (
                  <div className="mt-2 rounded-lg bg-violet-50 p-2 dark:bg-violet-950/30">
                    <p className="text-[10px] font-medium leading-relaxed text-violet-700 dark:text-violet-300">
                      ✓ Each submission runs this workflow with all field values as the trigger payload.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 3 · Submissions */}
            <div className="p-4">
              <SectionHeader icon={ExternalLink} step={3} title="Submissions" badge={String(form.submission_count ?? 0)} color="bg-amber-500" />
              <button
                className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2.5 text-xs transition hover:border-teal/40 hover:bg-muted/50"
                onClick={() => setShowSubs(!showSubs)}
              >
                <span className="font-medium">{showSubs ? "Hide" : "View"} submissions</span>
                <span className="flex items-center gap-2">
                  {showSubs && !!subs.data?.submissions?.length && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:border-teal hover:text-teal"
                      onClick={(e) => { e.stopPropagation(); exportCsv(); }}
                    >
                      Export CSV
                    </span>
                  )}
                  <ChevronDown className={cn("h-3.5 w-3.5 text-ink-muted transition-transform", showSubs && "rotate-180")} />
                </span>
              </button>
              {showSubs && (
                <div className="mt-2 space-y-1.5">
                  {subs.isLoading && (
                    <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-ink-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </div>
                  )}
                  {subs.data && (
                    <>
                      {subs.data.submissions.length === 0 && (
                        <p className="rounded-xl border border-dashed border-line py-4 text-center text-[11px] text-ink-muted">No submissions yet — share the public link.</p>
                      )}
                      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                        {subs.data.submissions.map((sub, i) => (
                          <div key={sub.id} className="rounded-lg border border-line p-2 text-[11px] transition hover:border-teal/30" style={{ animation: `reveal-up 0.3s ease both ${i * 40}ms` }}>
                            <div className="text-[9px] text-ink-muted">{new Date(sub.created_at).toLocaleString()}</div>
                            <div className="mt-1 space-y-0.5">
                              {Object.entries(sub.data ?? {}).slice(0, 6).map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                  <span className="shrink-0 font-medium text-ink">{k}:</span>
                                  <span className="truncate text-ink-muted">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      {(subs.data.hasMore || subsBefore) && (
                        <div className="flex items-center justify-between pt-1">
                          <button
                            className="rounded-lg border border-line px-2 py-1 text-[10px] text-ink-muted transition hover:border-teal hover:text-teal disabled:opacity-50"
                            disabled={!subsBefore}
                            onClick={() => setSubsBefore(null)}
                          >
                            Newest
                          </button>
                          <button
                            className="rounded-lg border border-line px-2 py-1 text-[10px] text-ink-muted transition hover:border-teal hover:text-teal disabled:opacity-50"
                            disabled={!subs.data.hasMore}
                            onClick={() => setSubsBefore(subs.data!.nextBefore)}
                          >
                            Older →
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {subs.isError && (
                    <p className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-[11px] text-danger">
                      Failed to load submissions. Please retry.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sticky save */}
          <div className="sticky bottom-0 border-t border-line bg-elevated p-4">
            <Button className="w-full" onClick={saveAll} disabled={saving || !dirty}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : savedFlash ? <Check className="mr-1 h-3 w-3" /> : <Save className="mr-1 h-3 w-3" />}
              {saving ? "Saving…" : savedFlash ? "Saved" : dirty ? "Save changes" : "All changes saved"}
            </Button>
            {dirty && !saving && <p className="mt-1.5 text-center text-[10px] text-amber-600">Unsaved changes</p>}
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
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: TableLite[] }>("/tables") });
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
        <Card className="mb-4 animate-reveal-up">
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
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 transition group-hover:scale-105">
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
                  className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted transition hover:bg-muted"
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

/* ── Draggable field card (dnd-kit) ───────────────────────────────────── */

function SortableFieldCard({
  index,
  field,
  total,
  onLabel,
  onType,
  onPlaceholder,
  onOptions,
  onRequired,
  onVisibleWhen,
  onRemove,
  otherFields,
}: {
  index: number;
  field: Field;
  total: number;
  onLabel: (v: string) => void;
  onType: (v: string) => void;
  onPlaceholder: (v: string) => void;
  onOptions: (v: string[]) => void;
  onRequired: (v: boolean) => void;
  onVisibleWhen: (v: Field["visibleWhen"]) => void;
  onRemove: () => void;
  otherFields: Field[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-xl border border-line bg-bg px-3 py-2.5 transition-all duration-200 hover:border-teal/30 hover:shadow-sm",
        isDragging && "opacity-80 shadow-card ring-1 ring-teal/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none rounded p-0.5 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-ink active:cursor-grabbing"
          aria-label={`Reorder ${field.label || "field"}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-ink-muted">{index + 1}</span>
        <input
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium transition hover:border-line focus:border-teal focus:outline-none"
          value={field.label}
          placeholder="Field label"
          onChange={(e) => onLabel(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-ink-muted transition hover:bg-danger/10 hover:text-danger"
          onClick={onRemove}
          aria-label="Remove field"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <select
          className="rounded-lg border border-line bg-elevated px-1.5 py-1.5 text-[11px] transition focus:border-teal focus:outline-none"
          value={field.type}
          onChange={(e) => onType(e.target.value)}
        >
          {FIELD_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input
          className="rounded-lg border border-line bg-elevated px-1.5 py-1.5 text-[11px] transition focus:border-teal focus:outline-none"
          placeholder="Placeholder"
          value={field.placeholder ?? ""}
          onChange={(e) => onPlaceholder(e.target.value)}
        />
      </div>
      {(field.type === "select" || field.type === "multiselect") && (
        <input
          className="mt-1.5 w-full rounded-lg border border-line bg-elevated px-1.5 py-1.5 text-[11px] transition focus:border-teal focus:outline-none"
          placeholder="Options, comma-separated"
          value={(field.options ?? []).join(", ")}
          onChange={(e) => onOptions(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      )}
      <div className="mt-2 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-muted">
          <input
            type="checkbox"
            className="h-3 w-3 accent-teal"
            checked={field.required !== false}
            onChange={(e) => onRequired(e.target.checked)}
          />
          Required
        </label>
        {index > 0 && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-ink-muted transition hover:text-teal">Condition…</summary>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              <select
                className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                value={field.visibleWhen?.field ?? ""}
                onChange={(e) => onVisibleWhen(e.target.value ? { field: e.target.value, op: field.visibleWhen?.op ?? "eq", value: field.visibleWhen?.value ?? "" } : undefined)}
              >
                <option value="">Always show</option>
                {otherFields.filter((other) => !/^(file|button|ai|formula|linked)$/.test(other.type)).map((other) => (
                  <option key={other.key} value={other.key}>{other.label || other.key}</option>
                ))}
              </select>
              {field.visibleWhen && (
                <>
                  <select
                    className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                    value={field.visibleWhen.op}
                    onChange={(e) => onVisibleWhen({ ...field.visibleWhen!, op: e.target.value })}
                  >
                    <option value="eq">equals</option>
                    <option value="neq">not equals</option>
                    <option value="contains">contains</option>
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                    <option value="empty">is empty</option>
                    <option value="not_empty">is not empty</option>
                  </select>
                  {!/^(empty|not_empty)$/.test(field.visibleWhen.op) && (
                    <input
                      className="rounded border border-line bg-elevated px-1 py-1 text-[10px]"
                      placeholder="Value"
                      value={String(field.visibleWhen.value ?? "")}
                      onChange={(e) => onVisibleWhen({ ...field.visibleWhen!, value: e.target.value })}
                    />
                  )}
                </>
              )}
            </div>
          </details>
        )}
      </div>
      {total > 1 && <span className="sr-only">Drag the handle to reorder this field.</span>}
    </div>
  );
}

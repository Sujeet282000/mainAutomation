"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Bot, Calculator, Database, Eye, Filter, Grid3X3, Link2, MoreHorizontal, Plus, Search, Settings2, Trash2, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { TableCellRenderer, FieldTypeBadge, type TableField, type TableRecord } from "@/features/tables/table-runtime";

const FIELD_TYPES: Array<{ key: string; label: string; icon: typeof Bot }> = [
  { key: "text", label: "Text", icon: null as any },
  { key: "email", label: "Email", icon: null as any },
  { key: "number", label: "Number", icon: null as any },
  { key: "select", label: "Select", icon: null as any },
  { key: "checkbox", label: "Checkbox", icon: null as any },
  { key: "date", label: "Date", icon: null as any },
  { key: "url", label: "URL", icon: null as any },
  { key: "phone", label: "Phone", icon: null as any },
  { key: "ai", label: "AI", icon: Bot },
  { key: "formula", label: "Formula", icon: Calculator },
  { key: "button", label: "Button", icon: Zap },
  { key: "linked", label: "Linked Record", icon: Link2 },
];

type Table = { id: string; name: string; schema_json?: { fields?: TableField[] }; created_at?: string; record_count?: number };
type RecordRow = TableRecord;

function TableCard({ table, onOpen, onDelete }: { table: Table; onOpen: () => void; onDelete: () => void }) {
  const fields = table.schema_json?.fields ?? [];
  return (
    <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-teal/40" onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10">
            <Database className="h-5 w-5 text-teal" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{table.name}</h3>
            <p className="text-[11px] text-ink-muted">
              {fields.length} fields · {table.record_count ?? 0} records
            </p>
          </div>
        </div>
        <button
          className="rounded-lg p-1.5 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete table"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {fields.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fields.slice(0, 5).map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted">
              {f.label ?? f.key}
              <FieldTypeBadge type={f.type} />
            </span>
          ))}
          {fields.length > 5 && <span className="text-[10px] text-ink-muted">+{fields.length - 5} more</span>}
        </div>
      )}
    </Card>
  );
}

function TableEditor({ table, onClose }: { table: Table; onClose: () => void }) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<TableField[]>(table.schema_json?.fields?.length ? table.schema_json.fields : []);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"grid" | "form">("grid");
  const [aiGenerating, setAiGenerating] = useState<Record<string, boolean>>({});
  const [buttonRunning, setButtonRunning] = useState<Record<string, boolean>>({});
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editFieldConfig, setEditFieldConfig] = useState<Partial<TableField>>({});
  const [allTables, setAllTables] = useState<Array<{ id: string; name: string }>>([]);

  async function loadRecords() {
    setLoading(true);
    try {
      const d = await api<{ records: RecordRow[] }>(`/tables/${table.id}/records`);
      setRecords(d.records ?? []);
    } finally { setLoading(false); }
  }

  async function load() {
    const t = await api<{ table: Table }>(`/tables/${table.id}`);
    setFields(t.table?.schema_json?.fields ?? fields);
    const tbls = await api<{ tables: Array<{ id: string; name: string }> }>(`/tables`);
    setAllTables(tbls.tables ?? []);
    await loadRecords();
  }

  useEffect(() => { load(); }, []);

  // AI field generation
  async function handleAiGenerate(fieldKey: string, prompt: string, rowData: Record<string, unknown>) {
    setAiGenerating((p) => ({ ...p, [fieldKey]: true }));
    try {
      const resolved = prompt.replace(/\{(\w+)\}/g, (_, k) => String(rowData[k] ?? ""));
      const result = await api<{ text: string }>("/ai/generate", { method: "POST", body: JSON.stringify({ prompt: resolved }) }).catch(() => null);
      const text = result?.text ?? `Generated content for ${fieldKey}`;
      setRecords((prev) => prev.map((r) => ({ ...r, data: { ...r.data, [fieldKey]: text } })));
    } finally {
      setAiGenerating((p) => ({ ...p, [fieldKey]: false }));
    }
  }

  // Button workflow trigger
  async function handleButtonRun(workflowId: string, recordId: string) {
    const key = `${workflowId}-${recordId}`;
    setButtonRunning((p) => ({ ...p, [key]: true }));
    try {
      await api(`/automations/${workflowId}/run`, { method: "POST", body: JSON.stringify({ recordId }) }).catch(() => {});
    } finally {
      setButtonRunning((p) => ({ ...p, [key]: false }));
    }
  }

  // Linked record selection
  function handleLinkedSelect(fieldKey: string, recordId: string) {
    setRecords((prev) => prev.map((r) => ({ ...r, data: { ...r.data, [fieldKey]: recordId } })));
  }

  // Field editor
  function openFieldEditor(index: number) {
    setEditingField(index);
    setEditFieldConfig({ ...fields[index] });
  }

  function saveFieldConfig() {
    if (editingField === null) return;
    const n = [...fields];
    n[editingField] = { ...n[editingField], ...editFieldConfig } as TableField;
    setFields(n);
    setEditingField(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-bg">
      {/* Sidebar */}
      <div className="flex w-72 flex-col border-r border-line bg-elevated">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-teal" />
            <span className="text-sm font-semibold">{table.name}</span>
          </div>
          <button className="rounded-lg p-1 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase text-ink-muted">Fields ({fields.length})</p>
          {fields.map((f, i) => (
            <div
              key={f.key}
              className={cn("mb-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition", editingField === i ? "border-teal bg-teal/5" : "border-line hover:border-teal/40")}
              onClick={() => openFieldEditor(i)}
            >
              <span className="flex-1 truncate">{f.label ?? f.key}</span>
              <FieldTypeBadge type={f.type} />
              <button
                className="text-ink-muted hover:text-danger"
                onClick={(e) => { e.stopPropagation(); const n = [...fields]; n.splice(i, 1); setFields(n); setEditingField(null); }}
              >×</button>
            </div>
          ))}

          {/* Field editor panel */}
          {editingField !== null && editFieldConfig && (
            <div className="mb-3 rounded-xl border border-teal bg-teal/5 p-3">
              <p className="mb-2 text-[10px] font-semibold text-teal">Edit field</p>
              <div className="space-y-2">
                <Input
                  placeholder="Field label"
                  value={editFieldConfig.label ?? ""}
                  onChange={(e) => setEditFieldConfig((p) => ({ ...p, label: e.target.value }))}
                  className="h-8 text-xs"
                />
                <select
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs"
                  value={editFieldConfig.type ?? "text"}
                  onChange={(e) => setEditFieldConfig((p) => ({ ...p, type: e.target.value }))}
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft.key} value={ft.key}>{ft.label}</option>
                  ))}
                </select>
                {editFieldConfig.type === "formula" && (
                  <Input
                    placeholder="Formula (e.g. price * quantity)"
                    value={editFieldConfig.formula ?? ""}
                    onChange={(e) => setEditFieldConfig((p) => ({ ...p, formula: e.target.value }))}
                    className="h-8 text-xs font-mono"
                  />
                )}
                {editFieldConfig.type === "ai" && (
                  <Input
                    placeholder="AI prompt (use {column} for refs)"
                    value={editFieldConfig.aiPrompt ?? ""}
                    onChange={(e) => setEditFieldConfig((p) => ({ ...p, aiPrompt: e.target.value }))}
                    className="h-8 text-xs"
                  />
                )}
                {editFieldConfig.type === "button" && (
                  <>
                    <Input
                      placeholder="Button label"
                      value={editFieldConfig.buttonLabel ?? ""}
                      onChange={(e) => setEditFieldConfig((p) => ({ ...p, buttonLabel: e.target.value }))}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Workflow ID"
                      value={editFieldConfig.workflowId ?? ""}
                      onChange={(e) => setEditFieldConfig((p) => ({ ...p, workflowId: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </>
                )}
                {editFieldConfig.type === "linked" && (
                  <>
                    <select
                      className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs"
                      value={editFieldConfig.linkedTableId ?? ""}
                      onChange={(e) => setEditFieldConfig((p) => ({ ...p, linkedTableId: e.target.value }))}
                    >
                      <option value="">Select table…</option>
                      {allTables.filter((t) => t.id !== table.id).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <Input
                      placeholder="Display field"
                      value={editFieldConfig.linkedField ?? ""}
                      onChange={(e) => setEditFieldConfig((p) => ({ ...p, linkedField: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </>
                )}
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={saveFieldConfig} className="h-7 text-[11px]">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} className="h-7 text-[11px]">Cancel</Button>
                </div>
              </div>
            </div>
          )}

          {/* Add field dropdown */}
          <AddFieldButton onAdd={(type) => {
            const newField: TableField = { key: `field_${Date.now()}`, type, label: FIELD_TYPES.find((ft) => ft.key === type)?.label ?? type };
            setFields([...fields, newField]);
          }} />
        </div>
        <div className="border-t border-line p-3">
          <Button className="w-full" size="sm" onClick={async () => {
            await api(`/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ schema: { fields } }) });
            qc.invalidateQueries({ queryKey: ["tables"] });
          }}>Save fields</Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <div className="flex rounded-lg border border-line bg-muted/30 p-0.5">
            <button className={cn("rounded-md px-2.5 py-1 text-xs font-medium", view === "grid" ? "bg-elevated text-ink shadow-sm" : "text-ink-muted")} onClick={() => setView("grid")}><Grid3X3 className="mr-1 inline h-3 w-3" />Grid</button>
            <button className={cn("rounded-md px-2.5 py-1 text-xs font-medium", view === "form" ? "bg-elevated text-ink shadow-sm" : "text-ink-muted")} onClick={() => setView("form")}><Eye className="mr-1 inline h-3 w-3" />Form</button>
          </div>
          <div className="flex-1" />
          <span className="text-xs text-ink-muted">{records.length} records</span>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {view === "grid" ? (
            <div className="overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-muted/50">
                    <th className="px-3 py-2 font-medium text-ink-muted">#</th>
                    {fields.map((f) => (
                      <th key={f.key} className="px-3 py-2 font-medium text-ink-muted">
                        <span className="flex items-center gap-1">
                          {f.label ?? f.key}
                          <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                          <FieldTypeBadge type={f.type} />
                        </span>
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.id} className="border-b border-line/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
                      {fields.map((f) => (
                        <td key={f.key} className="px-3 py-2">
                          <TableCellRenderer
                            field={f}
                            value={r.data?.[f.key]}
                            record={r.data}
                            recordId={r.id}
                            fields={fields}
                            allTables={allTables}
                            aiGenerating={aiGenerating[f.key]}
                            buttonRunning={buttonRunning[`${f.workflowId}-${r.id}`]}
                            onAiGenerate={handleAiGenerate}
                            onButtonRun={handleButtonRun}
                            onLinkedSelect={handleLinkedSelect}
                          />
                        </td>
                      ))}
                      <td>
                        <button className="text-ink-muted hover:text-danger" onClick={async () => {
                          await api(`/tables/${table.id}/records/${r.id}`, { method: "DELETE" });
                          loadRecords();
                        }}><Trash2 className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">No records yet. Add your first row below.</p>}
            </div>
          ) : (
            <Card className="space-y-3">
              <p className="text-xs font-semibold text-ink-muted">Add record</p>
              {fields.filter((f) => f.type !== "formula" && f.type !== "button").map((f) => (
                <div key={f.key}>
                  <label className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    {f.label ?? f.key}
                    {f.required && <span className="text-danger">*</span>}
                    <FieldTypeBadge type={f.type} />
                  </label>
                  {f.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      checked={draft[f.key] === "true"}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked ? "true" : "" })}
                      className="h-4 w-4"
                    />
                  ) : f.type === "select" ? (
                    <select
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs"
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {(f.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <Input
                      type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "number" ? "number" : "text"}
                      placeholder={f.label ?? f.key}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <Button size="sm" onClick={async () => {
                // Merge formula/AI defaults
                const data = { ...draft };
                for (const f of fields) {
                  if (f.type === "formula" || f.type === "button" || f.type === "ai" || f.type === "linked") {
                    // These are computed — don't send user input
                    delete data[f.key];
                  }
                }
                await api(`/tables/${table.id}/records`, { method: "POST", body: JSON.stringify({ data }) });
                setDraft({});
                loadRecords();
              }}>Add record</Button>
            </Card>
          )}
        </div>

        {view === "grid" && (
          <div className="border-t border-line px-4 py-3">
            <div className="flex gap-2 items-end">
              {fields.filter((f) => f.type !== "formula" && f.type !== "button" && f.type !== "ai").map((f) => (
                <div key={f.key}>
                  <label className="mb-0.5 block text-[9px] text-ink-muted">{f.label ?? f.key}</label>
                  <Input
                    className="w-40"
                    placeholder={f.label ?? f.key}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                </div>
              ))}
              <Button size="sm" onClick={async () => {
                const data = { ...draft };
                for (const f of fields) {
                  if (f.type === "formula" || f.type === "button" || f.type === "ai" || f.type === "linked") delete data[f.key];
                }
                await api(`/tables/${table.id}/records`, { method: "POST", body: JSON.stringify({ data }) });
                setDraft({});
                loadRecords();
              }}><Plus className="mr-1 h-3 w-3" />Add row</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddFieldButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-2">
      <button
        className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-muted hover:border-teal hover:text-teal"
        onClick={() => setOpen(!open)}
      >
        <Plus className="h-3 w-3" /> Add field
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-line bg-elevated p-1.5 shadow-lg">
          {FIELD_TYPES.map((ft) => (
            <button
              key={ft.key}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-ink hover:bg-muted"
              onClick={() => { onAdd(ft.key); setOpen(false); }}
            >
              {ft.icon && <ft.icon className="h-3 w-3 text-ink-muted" />}
              {ft.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TablesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Table[] }>("/tables") });
  const [open, setOpen] = useState<Table | null>(null);
  const [createName, setCreateName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <PageHeader
        title="Tables"
        description="Spreadsheet-style workspace data. Connect to workflows, forms, and AI agents."
        actions={<div className="flex items-center gap-2"><PageInfo title="Tables" description="Tables store structured data like leads, customers, or orders. Each table has fields (columns) and records (rows)." tips={["Create fields first, then add records row by row.", "Use AI fields to auto-generate content from other columns.", "Formula fields compute values from other columns in real-time.", "Button fields trigger workflows when clicked.", "Linked records connect tables together — like a database relation.", "Connect a table to a Form to collect submissions automatically.", "Workflows can read from and write to tables."]} /><Button onClick={() => setShowCreate(true)}><Plus className="mr-1 h-3.5 w-3.5" />New table</Button></div>}
      />

      {showCreate && (
        <Card className="mb-4">
          <p className="mb-2 text-xs font-semibold text-ink-muted">Create a new table</p>
          <div className="flex gap-2">
            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Table name (e.g. Leads, Customers)" className="max-w-xs" autoFocus />
            <Button onClick={async () => {
              if (!createName.trim()) return;
              await api("/tables", { method: "POST", body: JSON.stringify({ name: createName, schema: { fields: [{ key: "name", type: "text", label: "Name" }] } }) });
              setCreateName("");
              setShowCreate(false);
              qc.invalidateQueries({ queryKey: ["tables"] });
            }}>Create</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {!list.isLoading && !list.data?.tables.length && (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="No tables yet"
          description="Create your first table to store structured data. Tables connect to workflows, forms, and AI agents."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.tables ?? []).map((t) => (
          <TableCard key={t.id} table={t} onOpen={() => setOpen(t)} onDelete={async () => {
            if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
              await api(`/tables/${t.id}`, { method: "DELETE" });
              qc.invalidateQueries({ queryKey: ["tables"] });
            }
          }} />
        ))}
      </div>

      {open && <TableEditor table={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

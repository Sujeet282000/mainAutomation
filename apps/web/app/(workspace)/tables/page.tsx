"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates, horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpDown, Bot, Calculator, Database, Download, Eye, Filter, Grid3X3, GripVertical, Link2, MoreHorizontal, Plus, Search, Settings2, Trash2, Upload, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, getToken, getWorkspaceId, API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCardGrid } from "@/components/ui/skeleton";
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
    <Card interactive className="group hover:border-teal/40" onClick={onOpen}>
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
          {fields.slice(0, 5).map((f, i) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted transition-transform duration-200 group-hover:scale-105" style={{ transitionDelay: `${i * 40}ms` }}>
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
  const [records, setRecords] = useState<RecordRow[]>([]);  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"grid" | "form">("grid");
  const [aiGenerating, setAiGenerating] = useState<Record<string, boolean>>({});
  const [buttonRunning, setButtonRunning] = useState<Record<string, boolean>>({});
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editFieldConfig, setEditFieldConfig] = useState<Partial<TableField>>({});
  const [allTables, setAllTables] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadRecords() {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await api<{ records: RecordRow[] }>(`/tables/${table.id}/records`);
      setRecords(d.records ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load records");
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

  // AI field generation (P0 fix: never invent fallback content — surface the error)
  async function handleAiGenerate(fieldKey: string, prompt: string, rowData: Record<string, unknown>) {
    setAiGenerating((p) => ({ ...p, [fieldKey]: true }));
    try {
      const resolved = prompt.replace(/\{(\w+)\}/g, (_, k) => String(rowData[k] ?? ""));
      const result = await api<{ text: string }>("/ai/generate", { method: "POST", body: JSON.stringify({ prompt: resolved }) });
      if (!result?.text) throw new Error("The AI service returned no content for this field.");
      setRecords((prev) => prev.map((r) => ({ ...r, data: { ...r.data, [fieldKey]: result.text } })));
    } catch (err) {
      toast.error(`AI generation failed for ${fieldKey}`, {
        description: err instanceof Error ? err.message : "Try again or fill the field manually.",
      });
    } finally {
      setAiGenerating((p) => ({ ...p, [fieldKey]: false }));
    }
  }

  // Button workflow trigger (P0 fix: surface failures instead of swallowing them)
  async function handleButtonRun(workflowId: string, recordId: string) {
    const key = `${workflowId}-${recordId}`;
    setButtonRunning((p) => ({ ...p, [key]: true }));
    try {
      await api(`/automations/${workflowId}/run`, { method: "POST", body: JSON.stringify({ recordId }) });
      toast.success("Workflow triggered");
    } catch (err) {
      toast.error("Workflow trigger failed", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setButtonRunning((p) => ({ ...p, [key]: false }));
    }
  }

  // CSV export (P4 #29): download the table as a file.
  async function exportCsv() {
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      const workspaceId = getWorkspaceId();
      if (token) headers.authorization = `Bearer ${token}`;
      if (workspaceId) headers["x-workspace-id"] = workspaceId;
      const res = await fetch(`${API_URL}/tables/${table.id}/export.csv`, { headers });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table.name.replace(/[^\w\-. ]/g, "") || "table"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  // CSV import (P4 #29): upload a CSV file with a header row.
  async function importCsv(file: File) {
    try {
      const csv = await file.text();
      const d = await api<{ imported: number }>(`/tables/${table.id}/import`, { method: "POST", body: JSON.stringify({ csv }) });
      toast.success(`Imported ${d.imported} records`);
      loadRecords();
    } catch (err) {
      toast.error("Import failed", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  // Bulk delete (P4 #29)
  async function bulkDelete() {
    try {
      const ids = [...selectedIds];
      const d = await api<{ deleted: number }>(`/tables/${table.id}/records/bulk-delete`, { method: "POST", body: JSON.stringify({ ids }) });
      toast.success(`Deleted ${d.deleted} records`);
      setSelectedIds(new Set());
      loadRecords();
    } catch (err) {
      toast.error("Bulk delete failed", { description: err instanceof Error ? err.message : "Unknown error" });
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

  // Field drag-and-drop (persisted via Save fields)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onFieldDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.key === active.id);
    const to = fields.findIndex((f) => f.key === over.id);
    if (from < 0 || to < 0) return;
    setFields(arrayMove(fields, from, to));
  }

  function saveFieldConfig() {
    if (editingField === null) return;
    const n = [...fields];
    n[editingField] = { ...n[editingField], ...editFieldConfig } as TableField;
    setFields(n);
    setEditingField(null);
  }

  // Record row drag-and-drop: persist manual order server-side.
  const rowDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onToggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(records.map((r) => r.id)) : new Set());
  }

  async function onRowDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = records.findIndex((r) => r.id === active.id);
    const to = records.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(records, from, to);
    setRecords(next);
    try {
      await api(`/tables/${table.id}/records/reorder`, { method: "POST", body: JSON.stringify({ ids: next.map((r) => r.id) }) });
    } catch (err) {
      toast.error("Couldn't save row order", { description: err instanceof Error ? err.message : "Unknown error" });
      loadRecords();
    }
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
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd}>
            <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
              {fields.map((f, i) => (
                <SortableFieldRow
                  key={f.key}
                  field={f}
                  index={i}
                  active={editingField === i}
                  onOpen={() => openFieldEditor(i)}
                  onRemove={() => { const n = [...fields]; n.splice(i, 1); setFields(n); setEditingField(null); }}
                />
              ))}
            </SortableContext>
          </DndContext>

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
                  className="w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs"
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
                      className="w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs"
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
            try {
              await api(`/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ schema: { fields } }) });
              qc.invalidateQueries({ queryKey: ["tables"] });
              toast.success("Fields saved");
            } catch (err) {
              toast.error("Failed to save fields", { description: err instanceof Error ? err.message : "Unknown error" });
            }
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
          <div className="relative mr-1">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-ink-muted" />
            <input
              className="h-7 w-44 rounded-lg border border-line bg-elevated pl-7 pr-2 text-xs outline-none focus:border-teal"
              placeholder="Search records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-ink-muted">{selectedIds.size} selected</span>
              <Button size="sm" variant="ghost" onClick={bulkDelete} className="h-7 text-[11px] text-danger"><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7 text-[11px]">Clear</Button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }}
          />
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()}><Upload className="mr-1 h-3 w-3" />Import</Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={exportCsv}><Download className="mr-1 h-3 w-3" />Export</Button>
          <span className="text-xs text-ink-muted">{records.length} records</span>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {view === "grid" ? (
            <div className="overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-muted/50">
                    <th className="px-3 py-2 font-medium text-ink-muted">
                      <input
                        type="checkbox"
                        checked={records.length > 0 && selectedIds.size === records.length}
                        onChange={(e) => onToggleAll(e.target.checked)}
                        className="h-3 w-3"
                      />
                    </th>
                    {fields.map((f) => (
                      <th
                        key={f.key}
                        className="group cursor-pointer select-none px-3 py-2 font-medium text-ink-muted hover:text-ink"
                        onClick={() => setSort((s) => (s?.key === f.key ? (s.dir === "asc" ? { key: f.key, dir: "desc" } : null) : { key: f.key, dir: "asc" }))}
                      >
                        <span className="flex items-center gap-1">
                          {f.label ?? f.key}
                          {sort?.key === f.key
                            ? <span className="text-teal">{sort.dir === "asc" ? "↑" : "↓"}</span>
                            : <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />}
                          <FieldTypeBadge type={f.type} />
                        </span>
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const q = search.trim().toLowerCase();
                    let viewRows = q
                      ? records.filter((r) => Object.values(r.data ?? {}).some((v) => typeof v === "string" && v.toLowerCase().includes(q)))
                      : records;
                    if (sort) {
                      const dir = sort.dir === "asc" ? 1 : -1;
                      viewRows = [...viewRows].sort((a, b) => {
                        const av = a.data?.[sort.key]; const bv = b.data?.[sort.key];
                        const an = Number(av); const bn = Number(bv);
                        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "" && av !== undefined && bv !== undefined) return (an - bn) * dir;
                        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
                      });
                    }
                    // Drag reorder only makes sense on the unsorted, unsearched view.
                    const canDrag = !sort && !q;
                    const body = viewRows.map((r) => (
                      <SortableRecordRow
                        key={r.id}
                        record={r}
                        fields={fields}
                        selected={selectedIds.has(r.id)}
                            onToggle={(checked) => {
                          const next = new Set(selectedIds);
                          if (checked) next.add(r.id); else next.delete(r.id);
                          setSelectedIds(next);
                        }}
                        onDelete={async () => {
                          try {
                            await api(`/tables/${table.id}/records/${r.id}`, { method: "DELETE" });
                            loadRecords();
                            toast.success("Record deleted");
                          } catch (err) {
                            toast.error("Failed to delete record", { description: err instanceof Error ? err.message : "Unknown error" });
                          }
                        }}
                        renderCell={(f) => (
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
                        )}
                      />
                    ));
                    return canDrag ? (
                      <DndContext sensors={rowDndSensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
                        <SortableContext items={viewRows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                          {body}
                        </SortableContext>
                      </DndContext>
                    ) : body;
                  })()}
                </tbody>
              </table>
              {records.length === 0 && !loadError && (
                <p className="p-6 text-center text-sm text-ink-muted">No records yet. Add your first row below.</p>
              )}
              {records.length > 0 && (() => {
                const q = search.trim().toLowerCase();
                return q && !records.some((r) => Object.values(r.data ?? {}).some((v) => typeof v === "string" && v.toLowerCase().includes(q))) ? (
                  <p className="p-6 text-center text-sm text-ink-muted">No records match “{search}”.</p>
                ) : null;
              })()}
              {loadError && (
                <div className="p-6 text-center">
                  <p className="text-sm text-danger">{loadError}</p>
                  <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={loadRecords}>Retry</Button>
                </div>
              )}
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
                      className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
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

        {view === "grid" && fields.length > 0 && (
          <div className="border-t border-line bg-elevated px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Quick add row</p>
            <div className="flex flex-wrap gap-2 items-end">
              {fields.filter((f) => f.type !== "formula" && f.type !== "button" && f.type !== "ai").map((f) => (
                <div key={f.key}>
                  <label className="mb-0.5 block text-[9px] font-medium text-ink-muted">{f.label ?? f.key}</label>
                  {f.type === "select" ? (
                    <select
                      className="h-9 w-40 rounded-lg border border-line bg-elevated px-2 text-xs transition focus:border-teal focus:outline-none"
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {(f.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : f.type === "checkbox" ? (
                    <label className="flex h-9 w-40 items-center gap-2 rounded-lg border border-line bg-elevated px-2 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        checked={draft[f.key] === "true"}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked ? "true" : "" })}
                        className="h-3.5 w-3.5 accent-teal"
                      />
                      {f.label ?? f.key}
                    </label>
                  ) : (
                    <Input
                      className="w-40"
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
                      placeholder={f.label ?? f.key}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <Button size="sm" onClick={async () => {
                const data = { ...draft };
                for (const f of fields) {
                  if (f.type === "formula" || f.type === "button" || f.type === "ai" || f.type === "linked") delete data[f.key];
                }
                try {
                  await api(`/tables/${table.id}/records`, { method: "POST", body: JSON.stringify({ data }) });
                  setDraft({});
                  loadRecords();
                  toast.success("Record added");
                } catch (err) {
                  toast.error("Failed to add record", { description: err instanceof Error ? err.message : "Unknown error" });
                }
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
              try {
                await api("/tables", { method: "POST", body: JSON.stringify({ name: createName, schema: { fields: [{ key: "name", type: "text", label: "Name" }] } }) });
                setCreateName("");
                setShowCreate(false);
                qc.invalidateQueries({ queryKey: ["tables"] });
                toast.success("Table created", { description: `${createName} is ready` });
              } catch (err) {
                toast.error("Failed to create table", { description: err instanceof Error ? err.message : "Unknown error" });
              }
            }}>Create</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {list.isLoading && <SkeletonCardGrid count={6} />}
      {!list.isLoading && !list.data?.tables.length && (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="No tables yet"
          description="Create your first table to store structured data. Tables connect to workflows, forms, and AI agents."
        />
      )}

      <div className="ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.tables ?? []).map((t) => (
          <TableCard key={t.id} table={t} onOpen={() => setOpen(t)} onDelete={async () => {
            if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
              try {
                await api(`/tables/${t.id}`, { method: "DELETE" });
                qc.invalidateQueries({ queryKey: ["tables"] });
                toast.success("Table deleted");
              } catch (err) {
                toast.error("Failed to delete table", { description: err instanceof Error ? err.message : "Unknown error" });
              }
            }
          }} />
        ))}
      </div>

      {open && <TableEditor table={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ── Draggable field row (dnd-kit) ────────────────────────────────────── */

function SortableFieldRow({
  field,
  index,
  active,
  onOpen,
  onRemove,
}: {
  field: TableField;
  index: number;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 30 : undefined }}
      className={cn(
        "mb-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition",
        active ? "border-teal bg-teal/5" : "border-line hover:border-teal/40",
        isDragging && "opacity-80 shadow-card ring-1 ring-teal/40",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-ink-muted opacity-0 transition group-hover:opacity-100 hover:text-ink"
        aria-label={`Reorder ${field.label ?? field.key}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button type="button" className="flex flex-1 items-center gap-2 truncate text-left" onClick={onOpen}>
        <span className="flex-1 truncate">{field.label ?? field.key}</span>
        <FieldTypeBadge type={field.type} />
      </button>
      <button type="button" className="text-ink-muted hover:text-danger" onClick={onRemove} aria-label="Remove field">×</button>
      <span className="sr-only">Field {index + 1}</span>
    </div>
  );
}

/* ── Draggable record row (dnd-kit) ───────────────────────────────────── */

function SortableRecordRow({
  record,
  fields,
  selected,
  onToggle,
  onDelete,
  renderCell,
}: {
  record: RecordRow;
  fields: TableField[];
  selected: boolean;
  onToggle: (checked: boolean) => void;
  onDelete: () => void;
  renderCell: (f: TableField) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: record.id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 30 : undefined }}
      className={cn("border-b border-line/50 hover:bg-muted/30", isDragging && "bg-elevated shadow-card ring-1 ring-teal/40")}
    >
      <td className="px-3 py-2 text-ink-muted">
        <span className="mr-1 inline-flex align-middle">
          <button
            type="button"
            className="cursor-grab touch-none text-ink-muted hover:text-ink active:cursor-grabbing"
            aria-label="Reorder record"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        </span>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3 w-3 align-middle"
        />
      </td>
      {fields.map((f) => (
        <td key={f.key} className="px-3 py-2">{renderCell(f)}</td>
      ))}
      <td>
        <button type="button" className="text-ink-muted hover:text-danger" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

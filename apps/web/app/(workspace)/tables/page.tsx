"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type Field = { key: string; type: string; label?: string };
type TableRow = { id: string; name: string; schema_json?: { fields?: Field[] } };
type RecordRow = { id: string; data: Record<string, unknown> };

export default function TablesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: TableRow[] }>("/tables") });
  const [name, setName] = useState("Leads");
  const [open, setOpen] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [fields, setFields] = useState<Field[]>([{ key: "email", type: "text", label: "Email" }]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function openTable(t: TableRow) {
    setOpen(t.id);
    setFields(t.schema_json?.fields?.length ? t.schema_json.fields : [{ key: "email", type: "text", label: "Email" }]);
    const d = await api<{ records: RecordRow[] }>(`/tables/${t.id}/records`);
    setRecords(d.records ?? []);
  }

  return (
    <div>
      <PageHeader
        title="Tables"
        description="Spreadsheet-style workspace data. Writes can trigger workflows. Table usage is not billed as a task."
        actions={
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api("/tables", {
                method: "POST",
                body: JSON.stringify({ name, schema: { fields } })
              });
              qc.invalidateQueries({ queryKey: ["tables"] });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit">Create table</Button>
          </form>
        }
      />
      {!list.isLoading && !list.data?.tables.length && (
        <EmptyState icon={<Table2 className="h-10 w-10" />} title="No tables" description="Create a table, define fields, then map it in a workflow or form." />
      )}
      <div className="grid gap-3">
        {(list.data?.tables ?? []).map((t) => (
          <Card key={t.id}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{t.name}</h3>
              <Button variant="secondary" onClick={() => openTable(t)}>
                Open
              </Button>
            </div>
            {open === t.id && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-ink-muted">Fields (saved on the table schema)</p>
                <div className="flex flex-wrap gap-2">
                  {fields.map((f, i) => (
                    <Input
                      key={i}
                      className="w-36"
                      value={f.key}
                      onChange={(e) => {
                        const next = [...fields];
                        next[i] = { ...f, key: e.target.value, label: e.target.value };
                        setFields(next);
                      }}
                    />
                  ))}
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, type: "text" }])}
                  >
                    Add field
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      await api(`/tables/${t.id}`, { method: "PATCH", body: JSON.stringify({ schema: { fields } }) });
                      list.refetch();
                    }}
                  >
                    Save schema
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-ink-muted">
                        {fields.map((f) => (
                          <th key={f.key} className="py-2 pr-3">
                            {f.label ?? f.key}
                          </th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id} className="border-b border-line/60">
                          {fields.map((f) => (
                            <td key={f.key} className="py-2 pr-3">
                              {String(r.data?.[f.key] ?? "")}
                            </td>
                          ))}
                          <td>
                            <button
                              className="text-xs text-danger"
                              onClick={async () => {
                                await api(`/tables/${t.id}/records/${r.id}`, { method: "DELETE" });
                                openTable(t);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await api(`/tables/${t.id}/records`, { method: "POST", body: JSON.stringify({ data: draft }) });
                    setDraft({});
                    openTable(t);
                  }}
                >
                  {fields.map((f) => (
                    <Input
                      key={f.key}
                      className="w-40"
                      placeholder={f.label ?? f.key}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                  ))}
                  <Button type="submit">Add row</Button>
                </form>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

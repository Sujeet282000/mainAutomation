"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

export default function TablesPage() {
  const [tables, setTables] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState("Leads");
  const [open, setOpen] = useState<string | null>(null);
  const [records, setRecords] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [json, setJson] = useState('{"email":"ada@example.com"}');

  async function load() {
    const d = await api("/tables");
    setTables(d.tables ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Tables</h1>
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/tables", { method: "POST", body: JSON.stringify({ name }) });
          await load();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Create table</Button>
      </form>
      <div className="grid gap-3">
        {tables.map((t) => (
          <Card key={t.id}>
            <h3>{t.name}</h3>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                setOpen(t.id);
                const d = await api(`/tables/${t.id}/records`);
                setRecords(d.records ?? []);
              }}
            >
              Open records
            </Button>
            {open === t.id && (
              <div className="mt-3">
                <form
                  className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await api(`/tables/${t.id}/records`, { method: "POST", body: JSON.stringify({ data: JSON.parse(json) }) });
                    const d = await api(`/tables/${t.id}/records`);
                    setRecords(d.records ?? []);
                  }}
                >
                  <Input value={json} onChange={(e) => setJson(e.target.value)} />
                  <Button type="submit">Add row</Button>
                </form>
                <ul className="mt-2 text-sm text-muted">
                  {records.map((r) => (
                    <li key={r.id}>{JSON.stringify(r.data)}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

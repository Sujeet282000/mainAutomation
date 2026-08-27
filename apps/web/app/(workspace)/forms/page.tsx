"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileInput } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type Field = { key: string; type: string; label: string };
type FormRow = {
  id: string;
  name: string;
  slug: string;
  fields: Field[];
  automation_id?: string | null;
  table_id?: string | null;
};

export default function FormsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const list = useQuery({ queryKey: ["forms"], queryFn: () => api<{ forms: FormRow[] }>("/forms") });
  const tables = useQuery({ queryKey: ["tables"], queryFn: () => api<{ tables: Array<{ id: string; name: string }> }>("/tables") });
  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations")
  });
  const [name, setName] = useState("Lead form");
  const [fields, setFields] = useState<Field[]>([
    { key: "email", type: "email", label: "Email" },
    { key: "name", type: "text", label: "Name" }
  ]);
  const [tableId, setTableId] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [subs, setSubs] = useState<Array<{ id: string; data: unknown; created_at: string }>>([]);

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Hosted forms that write to Tables and start workflows. Form usage is not billed as a task."
      />
      <Card className="mb-4 space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Form name" />
        {fields.map((f, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={f.label}
              placeholder="Label"
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, "_") || f.key };
                setFields(next);
              }}
            />
            <select
              className="rounded-lg border border-line bg-elevated px-2 text-sm"
              value={f.type}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, type: e.target.value };
                setFields(next);
              }}
            >
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="number">Number</option>
              <option value="select">Dropdown</option>
            </select>
          </div>
        ))}
        <Button variant="secondary" type="button" onClick={() => setFields([...fields, { key: `q${fields.length}`, type: "text", label: "Question" }])}>
          Add field
        </Button>
        <select className="w-full rounded-lg border border-line bg-elevated p-2 text-sm" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">Write into table (optional)</option>
          {(tables.data?.tables ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="w-full rounded-lg border border-line bg-elevated p-2 text-sm" value={automationId} onChange={(e) => setAutomationId(e.target.value)}>
          <option value="">Start workflow (optional)</option>
          {(autos.data?.automations ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          onClick={async () => {
            await api("/forms", {
              method: "POST",
              body: JSON.stringify({
                name,
                slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
                fields,
                tableId: tableId || undefined,
                automationId: automationId || undefined
              })
            });
            qc.invalidateQueries({ queryKey: ["forms"] });
          }}
        >
          Create form
        </Button>
      </Card>
      {!list.isLoading && !list.data?.forms.length && (
        <EmptyState icon={<FileInput className="h-10 w-10" />} title="No forms" description="Create a form, share the public /f link, and optionally write rows into a table." />
      )}
      <div className="grid gap-3">
        {(list.data?.forms ?? []).map((f) => (
          <Card key={f.id}>
            <h3 className="font-semibold">{f.name}</h3>
            <p className="text-sm text-ink-muted">Public /f/{ws}/{f.slug}</p>
            <a className="text-sm text-teal" href={`/f/${ws}/${f.slug}`}>
              Open public page
            </a>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                setOpen(f.id);
                const d = await api<{ submissions: Array<{ id: string; data: unknown; created_at: string }> }>(
                  `/forms/${f.id}/submissions`
                );
                setSubs(d.submissions ?? []);
              }}
            >
              Submissions
            </Button>
            {open === f.id && (
              <ul className="mt-2 text-sm text-ink-muted">
                {subs.length === 0 && <li>No submissions yet.</li>}
                {subs.map((s) => (
                  <li key={s.id}>
                    {JSON.stringify(s.data)} · {new Date(s.created_at).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

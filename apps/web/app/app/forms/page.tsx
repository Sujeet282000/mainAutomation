"use client";
import { useEffect, useState } from "react";
import { api, API_URL, getWorkspaceId } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

export default function FormsPage() {
  const [forms, setForms] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [name, setName] = useState("Lead form");
  const [open, setOpen] = useState<string | null>(null);
  const [subs, setSubs] = useState<Array<{ id: string; data: unknown; created_at: string }>>([]);
  const ws = getWorkspaceId();
  async function load() {
    const d = await api("/forms");
    setForms(d.forms ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Forms</h1>
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/forms", {
            method: "POST",
            body: JSON.stringify({
              name,
              slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
              fields: [{ key: "email", type: "email" }]
            })
          });
          await load();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Create form</Button>
      </form>
      <div className="grid gap-3">
        {forms.map((f) => (
          <Card key={f.id}>
            <h3>{f.name}</h3>
            <div className="text-sm text-muted">Public page /f/{ws}/{f.slug}</div>
            <div className="text-sm text-muted">POST {API_URL}/public/forms/{ws}/{f.slug}</div>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                setOpen(f.id);
                const d = await api(`/forms/${f.id}/submissions`);
                setSubs(d.submissions ?? []);
              }}
            >
              Submissions
            </Button>
            {open === f.id && (
              <ul className="mt-2 text-sm text-muted">
                {subs.map((s) => (
                  <li key={s.id}>
                    {JSON.stringify(s.data)} · {new Date(s.created_at).toLocaleString()}
                  </li>
                ))}
                {subs.length === 0 && <li>No submissions</li>}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Card } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { CheckCircle, Loader2 } from "lucide-react";

type Block = {
  type: string;
  text?: string;
  tableId?: string | null;
  formId?: string | null;
  automationId?: string | null;
  buttonLabel?: string;
  formName?: string;
  fields?: Field[];
};
type Record_ = { id: string; data: Record<string, unknown>; created_at: string };
type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string; options?: string[] };

export default function PublicInterfacePage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const base = `${API_URL}/public/interfaces/${params.workspaceId}/${params.slug}`;
  const [page, setPage] = useState<{ name: string; pages: Block[] } | null>(null);
  const [err, setErr] = useState("");
  const [records, setRecords] = useState<Record<string, Record_[]>>({});
  const [forms, setForms] = useState<Record<string, { fields: Field[] }>>({});
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [formState, setFormState] = useState<Record<string, "idle" | "sending" | "done" | "error">>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [buttonState, setButtonState] = useState<Record<string, "idle" | "sending" | "done" | "error">>({});

  useEffect(() => {
    fetch(`${base}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "not found");
        setPage(d.interface);
        const blocks: Block[] = Array.isArray(d.interface.pages) ? d.interface.pages : [];
        for (const b of blocks) {
          if (b.type === "table" && b.tableId) {
            fetch(`${base}/tables/${b.tableId}/records`)
              .then(async (r2) => {
                const d2 = await r2.json();
                if (r2.ok) setRecords((p) => ({ ...p, [b.tableId!]: d2.records ?? [] }));
              })
              .catch(() => undefined);
          }
          if (b.type === "form" && b.formId) {
            // Field definitions arrive hydrated in the interface response.
          }
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [base, params.workspaceId]);

  async function submitForm(blockKey: string, formId: string) {
    setFormState((p) => ({ ...p, [blockKey]: "sending" }));
    setFormErrors((p) => ({ ...p, [blockKey]: "" }));
    try {
      const r = await fetch(`${base}/forms/${formId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values[blockKey] ?? {}),
      });
      const d = await r.json().catch(() => ({} as any));
      if (r.status === 422 && d.fields) {
        setFormErrors((p) => ({ ...p, [blockKey]: Object.values(d.fields as Record<string, string>).join(". ") }));
        setFormState((p) => ({ ...p, [blockKey]: "error" }));
        return;
      }
      if (!r.ok) throw new Error(d.error ?? "Submit failed");
      setFormState((p) => ({ ...p, [blockKey]: "done" }));
    } catch (e) {
      setFormErrors((p) => ({ ...p, [blockKey]: e instanceof Error ? e.message : "Submit failed" }));
      setFormState((p) => ({ ...p, [blockKey]: "error" }));
    }
  }

  async function runButton(blockKey: string, automationId: string) {
    setButtonState((p) => ({ ...p, [blockKey]: "sending" }));
    try {
      const r = await fetch(`${base}/buttons/${automationId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as any));
        throw new Error(d.error ?? "Run failed");
      }
      setButtonState((p) => ({ ...p, [blockKey]: "done" }));
    } catch {
      setButtonState((p) => ({ ...p, [blockKey]: "error" }));
    }
  }

  if (err) return (
    <main className="mx-auto mt-16 max-w-lg p-4">
      <Card className="p-6 text-center text-sm text-danger">{err}</Card>
    </main>
  );
  if (!page) return (
    <main className="mx-auto mt-16 max-w-lg p-4 text-sm text-ink-muted">
      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
    </main>
  );

  const blocks = Array.isArray(page.pages) ? page.pages : [];

  return (
    <main className="mx-auto mt-10 max-w-2xl p-4">
      <Card className="space-y-5 p-6">
        {blocks.map((b, i) => {
          const key = `${b.type}-${i}`;
          if (b.type === "heading") return <h1 key={key} className="text-2xl font-semibold">{b.text}</h1>;
          if (b.type === "text") return <p key={key} className="text-sm text-ink">{b.text}</p>;
          if (b.type === "table" && b.tableId) {
            const rows = records[b.tableId] ?? [];
            const cols = rows.length && rows[0].data ? Object.keys(rows[0].data).slice(0, 5) : [];
            return (
              <div key={key} className="overflow-x-auto rounded-lg border border-line">
                {rows.length === 0 ? (
                  <p className="p-4 text-center text-xs text-ink-muted">No records yet.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-muted/40">
                        {cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b border-line last:border-0">
                          {cols.map((c) => (
                            <td key={c} className="max-w-40 truncate px-3 py-2">
                              {typeof r.data?.[c] === "object" ? JSON.stringify(r.data[c]) : String(r.data?.[c] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }
          if (b.type === "form" && b.formId) {
            const st = formState[key] ?? "idle";
            const fields = Array.isArray(b.fields) ? b.fields : [];
            return (
              <div key={key} className="rounded-lg border border-line p-4">
                {st === "done" ? (
                  <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle className="h-4 w-4" /> Submitted — thank you!</p>
                ) : (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => { e.preventDefault(); void submitForm(key, b.formId!); }}
                  >
                    <p className="text-xs font-medium text-ink-muted">{b.formName ?? "Embedded form"}</p>
                    {fields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-1 block text-[11px] font-medium text-ink">
                          {f.label}{f.required !== false && <span className="ml-0.5 text-danger">*</span>}
                        </label>
                        {f.type === "select" ? (
                          <select
                            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                            required={f.required !== false}
                            value={String((values[key] as Record<string, unknown> | undefined)?.[f.key] ?? "")}
                            onChange={(e) => setValues((p) => ({ ...p, [key]: { ...(p[key] ?? {}), [f.key]: e.target.value } }))}
                          >
                            <option value="">Choose…</option>
                            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : f.type === "textarea" ? (
                          <textarea
                            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                            rows={3}
                            required={f.required !== false}
                            placeholder={f.placeholder ?? ""}
                            value={String((values[key] as Record<string, unknown> | undefined)?.[f.key] ?? "")}
                            onChange={(e) => setValues((p) => ({ ...p, [key]: { ...(p[key] ?? {}), [f.key]: e.target.value } }))}
                          />
                        ) : (
                          <Input
                            type={f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                            placeholder={f.placeholder ?? f.label}
                            required={f.required !== false}
                            value={String((values[key] as Record<string, unknown> | undefined)?.[f.key] ?? "")}
                            onChange={(e) => setValues((p) => ({ ...p, [key]: { ...(p[key] ?? {}), [f.key]: e.target.value } }))}
                          />
                        )}
                      </div>
                    ))}
                    {fields.length === 0 && <p className="text-[11px] text-ink-muted">This form has no fields configured.</p>}
                    {formErrors[key] && <p className="text-[11px] text-danger">{formErrors[key]}</p>}
                    <Button type="submit" size="sm" disabled={st === "sending"}>
                      {st === "sending" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Submit
                    </Button>
                  </form>
                )}
              </div>
            );
          }
          if (b.type === "button" && b.automationId) {
            const st = buttonState[key] ?? "idle";
            return (
              <div key={key} className="flex items-center gap-3">
                <Button
                  size="sm"
                  disabled={st === "sending"}
                  onClick={() => void runButton(key, b.automationId!)}
                >
                  {st === "sending" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  {b.buttonLabel ?? "Run workflow"}
                </Button>
                {st === "done" && <span className="text-xs text-ok">✓ Triggered</span>}
                {st === "error" && <span className="text-xs text-danger">Failed — try again</span>}
              </div>
            );
          }
          return null;
        })}
        {blocks.length === 0 && <p className="text-sm text-ink-muted">This interface has no content yet.</p>}
      </Card>
    </main>
  );
}

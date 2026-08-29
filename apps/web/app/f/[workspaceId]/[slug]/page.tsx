"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { CheckCircle, FileInput, Loader2 } from "lucide-react";

type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string };

export default function PublicFormPage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [form, setForm] = useState<{ name: string; fields: Field[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/public/forms/${params.workspaceId}/${params.slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "not found");
        setForm(d.form);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [params.workspaceId, params.slug]);

  if (err) return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="max-w-md w-full text-center">
        <p className="text-sm text-danger">{err}</p>
        <p className="mt-2 text-xs text-ink-muted">This form may not exist or is no longer active.</p>
      </Card>
    </main>
  );

  if (!form) return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading form…
      </div>
    </main>
  );

  if (done) return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="max-w-md w-full text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/10">
          <CheckCircle className="h-7 w-7 text-teal" />
        </div>
        <h2 className="text-lg font-semibold">Thank you!</h2>
        <p className="mt-2 text-sm text-ink-muted">Your response has been recorded.</p>
        <Button className="mt-4" variant="ghost" onClick={() => { setDone(false); setValues({}); }}>Submit another</Button>
      </Card>
    </main>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr("");
    try {
      const r = await fetch(`${API_URL}/public/forms/${params.workspaceId}/${params.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Submit failed");
      }
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed");
    } finally { setSubmitting(false); }
  }

  const fields = Array.isArray(form.fields) ? form.fields : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="max-w-md w-full">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10">
            <FileInput className="h-5 w-5 text-teal" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{form.name}</h1>
            <p className="text-xs text-ink-muted">Fields marked with * are required</p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-sm font-medium text-ink">
                {f.label}
                {f.required !== false && <span className="ml-0.5 text-danger">*</span>}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-teal"
                  rows={3}
                  placeholder={f.placeholder ?? `Enter ${f.label.toLowerCase()}...`}
                  required={f.required !== false}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              ) : f.type === "select" ? (
                <select
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-teal"
                  required={f.required !== false}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  <option value="">Choose...</option>
                </select>
              ) : f.type === "checkbox" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={values[f.key] === "true"}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.checked ? "true" : "" })}
                  />
                  <span className="text-sm">{f.label}</span>
                </div>
              ) : (
                <Input
                  type={f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  placeholder={f.placeholder ?? `Enter ${f.label.toLowerCase()}...`}
                  required={f.required !== false}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}

          {err && <p className="text-xs text-danger">{err}</p>}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </form>

        <p className="mt-4 text-center text-[10px] text-ink-muted">Powered by Freebuff</p>
      </Card>
    </main>
  );
}

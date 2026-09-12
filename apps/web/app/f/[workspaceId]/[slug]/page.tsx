"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { CheckCircle, FileInput, Loader2 } from "lucide-react";

type Field = { key: string; type: string; label: string; required?: boolean; placeholder?: string; options?: string[]; visibleWhen?: { field: string; op: string; value?: string | number } };

function isFieldVisible(field: Field, data: Record<string, unknown>): boolean {
  const cond = field.visibleWhen;
  if (!cond || !cond.field) return true;
  const actual = data[cond.field];
  switch (cond.op) {
    case "eq": return String(actual ?? "") === String(cond.value ?? "");
    case "neq": return String(actual ?? "") !== String(cond.value ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(cond.value ?? "").toLowerCase());
    case "gt": return Number(actual) > Number(cond.value);
    case "lt": return Number(actual) < Number(cond.value);
    case "empty": return actual === undefined || actual === null || actual === "";
    case "not_empty": return !(actual === undefined || actual === null || actual === "");
    default: return true;
  }
}
type FieldValue = string | number | boolean | string[] | { name: string; type: string; size: number; dataUrl: unknown } | null;

export default function PublicFormPage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [form, setForm] = useState<{ name: string; fields: Field[] } | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
        <p className="mt-2 text-sm text-ink-muted">{successMessage ?? "Your response has been recorded."}</p>
        <Button className="mt-4" variant="ghost" onClick={() => { setDone(false); setValues({}); }}>Submit another</Button>
      </Card>
    </main>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr("");
    setFieldErrors({});
    try {
      const r = await fetch(`${API_URL}/public/forms/${params.workspaceId}/${params.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const d = await r.json().catch(() => ({} as any));
      if (r.status === 429) {
        setErr(`Too many submissions. Please try again in ${d.retryAfterSec ?? 60}s.`);
        return;
      }
      if (r.status === 422 && d.fields) {
        setFieldErrors(d.fields as Record<string, string>);
        setErr("Please fix the highlighted fields.");
        return;
      }
      if (!r.ok) throw new Error(d.error ?? "Submit failed");
      if (d.redirectUrl) { window.location.href = String(d.redirectUrl); return; }
      setSuccessMessage(typeof d.successMessage === "string" && d.successMessage ? d.successMessage : null);
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
          {fields.filter((f) => isFieldVisible(f, values as Record<string, unknown>)).map((f) => (
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
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              ) : f.type === "select" ? (
                <select
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-teal"
                  required={f.required !== false}
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  <option value="">Choose...</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === "multiselect" ? (
                <div className="flex flex-wrap gap-1.5">
                  {(f.options ?? []).map((o) => {
                    const current = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
                    const on = current.includes(o);
                    return (
                      <button
                        type="button"
                        key={o}
                        className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-teal bg-teal/10 text-teal" : "border-line text-ink-muted hover:border-teal"}`}
                        onClick={() => setValues({ ...values, [f.key]: on ? current.filter((v) => v !== o) : [...current, o] })}
                      >
                        {o}
                      </button>
                    );
                  })}
                  {(f.options ?? []).length === 0 && <p className="text-xs text-ink-muted">No options configured.</p>}
                </div>
              ) : f.type === "file" ? (
                <div>
                  <input
                    type="file"
                    className="w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-teal/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-teal"
                    required={f.required !== false}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) { setFieldErrors((p) => ({ ...p, [f.key]: "File exceeds the 5 MB limit" })); return; }
                      const reader = new FileReader();
                      reader.onload = () => setValues({ ...values, [f.key]: { name: file.name, type: file.type, size: file.size, dataUrl: reader.result } });
                      reader.readAsDataURL(file);
                    }}
                  />
                  {typeof values[f.key] === "object" && values[f.key] !== null && (values[f.key] as { name?: string }).name && (
                    <p className="mt-1 text-[11px] text-ok">✓ {(values[f.key] as { name: string }).name}</p>
                  )}
                </div>
              ) : f.type === "checkbox" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={values[f.key] === true}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                  />
                  <span className="text-sm">{f.label}</span>
                </div>
              ) : f.type === "hidden" ? (
                <input type="hidden" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <Input
                  type={f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  placeholder={f.placeholder ?? `Enter ${f.label.toLowerCase()}...`}
                  required={f.required !== false}
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
              {fieldErrors[f.key] && <p className="mt-1 text-[11px] text-danger">{fieldErrors[f.key]}</p>}
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

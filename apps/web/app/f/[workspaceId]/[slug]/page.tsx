"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";

export default function PublicFormPage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [form, setForm] = useState<{ name: string; fields: Array<{ key: string; type?: string }> } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/forms/${params.workspaceId}/${params.slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "not found");
        setForm(d.form);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [params.workspaceId, params.slug]);

  if (err) return <main className="mx-auto mt-16 max-w-md p-4"><p className="text-red-400">{err}</p></main>;
  if (!form) return <main className="mx-auto mt-16 max-w-md p-4 text-muted">Loading…</main>;
  if (done) return <main className="mx-auto mt-16 max-w-md p-4"><Card>Submitted. Thank you.</Card></main>;

  return (
    <main className="mx-auto mt-16 max-w-md p-4">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">{form.name}</h1>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch(`${API_URL}/public/forms/${params.workspaceId}/${params.slug}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(values)
            });
            if (!r.ok) {
              setErr("Submit failed");
              return;
            }
            setDone(true);
          }}
        >
          {(Array.isArray(form.fields) ? form.fields : []).map((f) => (
            <Input
              key={f.key}
              placeholder={(f as { label?: string }).label ?? f.key}
              type={f.type === "email" ? "email" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          ))}
          <Button type="submit">Submit</Button>
        </form>
      </Card>
    </main>
  );
}

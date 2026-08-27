"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<{
    execution?: { status: string; error?: { message?: string } };
    steps?: Array<{ id: string; name: string; status: string; duration_ms?: number; error?: { message?: string } }>;
    logs?: Array<{ id: string; message: string; created_at: string }>;
  }>({});
  const [msg, setMsg] = useState("");

  async function load() {
    setData(await api(`/executions/${params.id}`));
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, [params.id]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Run</h1>
      <p className="mb-3 text-sm text-muted">{data.execution?.status}</p>
      {data.execution?.error?.message && <p className="mb-3 text-sm text-red-400">{data.execution.error.message}</p>}
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}
      <Button
        onClick={async () => {
          await api(`/executions/${params.id}/retry`, { method: "POST" });
          setMsg("Retry queued");
        }}
      >
        Retry run
      </Button>
      <div className="mt-4 grid gap-3">
        {(data.steps ?? []).map((s) => (
          <Card key={s.id}>
            <h3>{s.name}</h3>
            <div className="text-sm text-muted">
              {s.status} {s.duration_ms ? `· ${s.duration_ms}ms` : ""}
            </div>
            {s.error?.message && <p className="text-sm text-red-400">{s.error.message}</p>}
          </Card>
        ))}
      </div>
      <div className="mt-4 text-sm text-muted">
        {(data.logs ?? []).map((l) => (
          <div key={l.id}>
            {l.message} · {new Date(l.created_at).toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  );
}

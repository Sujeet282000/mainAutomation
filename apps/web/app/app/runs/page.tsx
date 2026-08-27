"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { Card } from "../../../components/ui/card";

export default function RunsPage() {
  const [items, setItems] = useState<Array<{ id: string; status: string; automation_name: string; created_at: string }>>([]);
  useEffect(() => {
    api("/executions")
      .then((d) => setItems(d.executions ?? []))
      .catch(() => undefined);
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Runs</h1>
      <div className="mt-4 grid gap-3">
        {items.map((r) => (
          <Link key={r.id} href={`/app/runs/${r.id}`}>
            <Card>
              <h3>{r.automation_name}</h3>
              <div className="text-sm text-muted">
                {r.status} · {new Date(r.created_at).toLocaleString()}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

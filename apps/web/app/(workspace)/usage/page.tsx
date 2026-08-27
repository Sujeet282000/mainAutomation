"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function UsagePage() {
  const q = useQuery({
    queryKey: ["usage"],
    queryFn: () => api<{ usage: Array<{ metric: string; quantity: string }> }>("/usage")
  });

  return (
    <div>
      <PageHeader title="Usage" description="Metered tasks and automations for the current period." />
      <div className="grid gap-3 sm:grid-cols-3">
        {(q.data?.usage ?? []).map((u) => (
          <Card key={u.metric}>
            <div className="text-2xl font-semibold">{u.quantity}</div>
            <div className="text-sm text-ink-muted">{u.metric}</div>
          </Card>
        ))}
        {!q.data?.usage?.length && <p className="text-sm text-ink-muted">No usage recorded today.</p>}
      </div>
    </div>
  );
}

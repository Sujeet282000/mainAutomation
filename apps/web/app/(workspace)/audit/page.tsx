"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function AuditPage() {
  const q = useQuery({
    queryKey: ["audit"],
    queryFn: () =>
      api<{ logs: Array<{ id: string; action: string; target_type?: string; created_at: string }> }>("/audit")
  });

  return (
    <div>
      <PageHeader title="Audit log" description="Security-relevant actions in this workspace." />
      <div className="grid gap-2">
        {(q.data?.logs ?? []).map((l) => (
          <Card key={l.id} className="py-3">
            <div className="font-medium">{l.action}</div>
            <div className="text-xs text-ink-muted">
              {l.target_type} Â· {new Date(l.created_at).toLocaleString()}
            </div>
          </Card>
        ))}
        {!q.data?.logs?.length && <p className="text-sm text-ink-muted">No audit events yet.</p>}
      </div>
    </div>
  );
}

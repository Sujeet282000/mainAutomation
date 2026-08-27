"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";

export default function NotificationsPage() {
  const runs = useQuery({
    queryKey: ["executions"],
    queryFn: () => api<{ executions: Array<{ id: string; status: string; automation_name?: string; created_at: string }> }>("/executions")
  });
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<{ approvals: Array<{ id: string; created_at: string }> }>("/approvals")
  });
  const failed = (runs.data?.executions ?? []).filter((e) => e.status === "failed" || e.status === "error");

  return (
    <div>
      <PageHeader title="Notifications" description="Failed runs and pending approvals that need attention." />
      <h2 className="mb-2 text-sm font-semibold">Pending approvals</h2>
      {(approvals.data?.approvals ?? []).map((a) => (
        <Card key={a.id} className="mb-2 py-3">
          Approval waiting Â· {new Date(a.created_at).toLocaleString()}
          <Link href="/approvals" className="ml-2 text-sm text-teal">
            Review
          </Link>
        </Card>
      ))}
      <h2 className="mb-2 mt-6 text-sm font-semibold">Failed runs</h2>
      {failed.map((r) => (
        <Link key={r.id} href={`/activity/${r.id}`}>
          <Card className="mb-2 flex items-center justify-between py-3">
            <span>{r.automation_name}</span>
            <StatusBadge status={r.status} />
          </Card>
        </Link>
      ))}
      {!failed.length && !approvals.data?.approvals?.length && <p className="text-sm text-ink-muted">You are all caught up.</p>}
    </div>
  );
}

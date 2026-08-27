"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";

export default function AutomationOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["automation", id],
    queryFn: () => api<{ automation: { id: string; name: string; status: string; webhook_public_id?: string } }>(`/automations/${id}`)
  });
  const a = q.data?.automation;

  return (
    <div>
      <PageHeader
        title={a?.name ?? "Automation"}
        description="Overview and publish status. Open the flow builder to edit trigger, actions, and paths."
        actions={
          <Button onClick={() => router.push(`/automations/${id}/editor`)}>Open editor</Button>
        }
      />
      {q.isError && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      <Card className="flex items-center justify-between">
        <div>
          <StatusBadge status={a?.status === "on" ? "on" : "draft"} />
          {a?.webhook_public_id && (
            <p className="mt-2 break-all text-xs text-ink-muted">Webhook public id {a.webhook_public_id}</p>
          )}
        </div>
        <Link href={`/activity?automation=${id}`} className="text-sm text-teal">
          View runs
        </Link>
      </Card>
    </div>
  );
}

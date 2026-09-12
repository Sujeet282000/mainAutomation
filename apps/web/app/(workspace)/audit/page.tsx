"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api, getToken, getWorkspaceId, API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function AuditPage() {
  const q = useQuery({
    queryKey: ["audit"],
    queryFn: () =>
      api<{ logs: Array<{ id: string; action: string; target_type?: string; created_at: string }> }>("/audit")
  });

  // SIEM-ready export (P6 #68): owner/admin only, enforced by the API.
  async function exportAudit(format: "json" | "csv") {
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      const workspaceId = getWorkspaceId();
      if (token) headers.authorization = `Bearer ${token}`;
      if (workspaceId) headers["x-workspace-id"] = workspaceId;
      const res = await fetch(`${API_URL}/audit/export?format=${format}&limit=10000`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return (
    <div>
      <PageHeader title="Audit log" description="Security-relevant actions in this workspace." />
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => exportAudit("csv")} className="h-7 text-[11px]">
          <Download className="mr-1 h-3 w-3" />Export CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportAudit("json")} className="h-7 text-[11px]">
          <Download className="mr-1 h-3 w-3" />Export JSON
        </Button>
      </div>
      <div className="grid gap-2">
        {(q.data?.logs ?? []).map((l) => (
          <Card key={l.id} className="py-3">
            <div className="font-medium">{l.action}</div>
            <div className="text-xs text-ink-muted">
              {l.target_type} · {new Date(l.created_at).toLocaleString()}
            </div>
          </Card>
        ))}
        {!q.data?.logs?.length && <p className="text-sm text-ink-muted">No audit events yet.</p>}
      </div>
    </div>
  );
}

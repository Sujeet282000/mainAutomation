"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";

export default function ApprovalsPage() {
  const [items, setItems] = useState<Array<{ id: string; payload: { message?: string }; created_at: string }>>([]);
  async function load() {
    const d = await api("/approvals");
    setItems(d.approvals ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="mb-4 text-sm text-muted">Human-in-the-loop steps pause a run until you decide.</p>
      <div className="grid gap-3">
        {items.map((a) => (
          <Card key={a.id}>
            <h3>{a.payload?.message ?? "Approval"}</h3>
            <div className="mb-3 text-sm text-muted">{new Date(a.created_at).toLocaleString()}</div>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  await api(`/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approved" }) });
                  await load();
                }}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "rejected" }) });
                  await load();
                }}
              >
                Reject
              </Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">No pending approvals.</p>}
      </div>
    </div>
  );
}

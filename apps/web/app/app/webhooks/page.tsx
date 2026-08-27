"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Card } from "../../../components/ui/card";

export default function WebhooksPage() {
  const [events, setEvents] = useState<Array<{ id: string; public_id: string; processing_status: string; received_at: string }>>([]);
  useEffect(() => {
    api("/webhook-events")
      .then((d) => setEvents(d.events ?? []))
      .catch(() => undefined);
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Webhook events</h1>
      <p className="mb-4 text-sm text-muted">Inbound catch-hooks for this workspace. Publish an automation to get its public URL.</p>
      <div className="grid gap-3">
        {events.map((e) => (
          <Card key={e.id}>
            <h3>{e.public_id}</h3>
            <div className="text-sm text-muted">
              {e.processing_status} · {new Date(e.received_at).toLocaleString()}
            </div>
          </Card>
        ))}
        {events.length === 0 && <p className="text-sm text-muted">No events yet.</p>}
      </div>
    </div>
  );
}

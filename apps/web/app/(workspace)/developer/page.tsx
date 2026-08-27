"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function DeveloperPage() {
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<{ keys: Array<{ id: string; name: string; key_prefix: string; revoked_at?: string }> }>("/api-keys")
  });
  const mcp = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => api<{ tokens: Array<{ id: string; name: string; token_prefix: string; revoked_at?: string }> }>("/mcp/tokens")
  });
  const hooks = useQuery({
    queryKey: ["webhook-events"],
    queryFn: () =>
      api<{ events: Array<{ id: string; public_id: string; processing_status: string; received_at: string }> }>("/webhook-events")
  });
  const [secret, setSecret] = useState("");

  return (
    <div className="max-w-3xl">
      <PageHeader title="Developer" description="API keys, MCP tokens, and inbound webhook events. Secrets are shown once." />
      {secret && (
        <Card className="mb-4 border-ok/40">
          <p className="text-sm font-medium">Copy now â€” this value is not stored in plaintext.</p>
          <code className="mt-1 block break-all text-xs">{secret}</code>
        </Card>
      )}
      <Card className="mb-4">
        <h3 className="mb-2 font-semibold">API keys</h3>
        <Button
          onClick={async () => {
            const d = await api<{ secret: string }>("/api-keys", { method: "POST", body: JSON.stringify({ name: "CLI" }) });
            setSecret(d.secret);
            keys.refetch();
          }}
        >
          Create API key
        </Button>
        <ul className="mt-3 space-y-2 text-sm">
          {(keys.data?.keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between">
              <span>
                {k.name} Â· {k.key_prefix}â€¦ {k.revoked_at ? "(revoked)" : ""}
              </span>
              {!k.revoked_at && (
                <Button variant="secondary" size="sm" onClick={async () => { await api(`/api-keys/${k.id}`, { method: "DELETE" }); keys.refetch(); }}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mb-4">
        <h3 className="mb-2 font-semibold">MCP tokens</h3>
        <Button
          onClick={async () => {
            const d = await api<{ secret: string; endpoint?: string }>("/mcp/tokens", { method: "POST", body: JSON.stringify({ name: "Cursor" }) });
            setSecret(`${d.secret}${d.endpoint ? ` @ ${d.endpoint}` : ""}`);
            mcp.refetch();
          }}
        >
          Create MCP token
        </Button>
        <ul className="mt-3 space-y-2 text-sm">
          {(mcp.data?.tokens ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between">
              <span>
                {t.name} Â· {t.token_prefix}â€¦ {t.revoked_at ? "(revoked)" : ""}
              </span>
              {!t.revoked_at && (
                <Button variant="secondary" size="sm" onClick={async () => { await api(`/mcp/tokens/${t.id}`, { method: "DELETE" }); mcp.refetch(); }}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mb-4">
        <h3 className="mb-2 font-semibold">SDK</h3>
        <p className="mb-2 text-sm text-ink-muted">
          Authenticated code access to the same catalog: GET /sdk/apps and POST /sdk/run. Successful actions draw from the shared task pool.
        </p>
        <Button
          variant="secondary"
          onClick={async () => {
            const d = await api<{ apps: unknown[] }>("/sdk/apps");
            setSecret(`Catalog apps: ${d.apps.length}. POST /sdk/run with appSlug, operation, connectionId, input.`);
          }}
        >
          Inspect catalog
        </Button>
      </Card>
      <Card className="mb-4">
        <h3 className="mb-2 font-semibold">Private integrations</h3>
        <Button
          onClick={async () => {
            const d = await api<{ clientSecret: string; app: { slug: string } }>("/developer-apps", {
              method: "POST",
              body: JSON.stringify({ name: "Internal app" })
            });
            setSecret(`client secret ${d.clientSecret} · slug ${d.app.slug}`);
          }}
        >
          Scaffold private app
        </Button>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Webhook events</h3>
        <ul className="space-y-2 text-sm text-ink-muted">
          {(hooks.data?.events ?? []).map((e) => (
            <li key={e.id}>
              {e.public_id} Â· {e.processing_status} Â· {new Date(e.received_at).toLocaleString()}
            </li>
          ))}
          {!hooks.data?.events.length && <li>No inbound events yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

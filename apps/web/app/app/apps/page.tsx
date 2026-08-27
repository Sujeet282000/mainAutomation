"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

type AppRow = { slug: string; name: string; description: string; category: string; authType?: string };
type Conn = { id: string; app_slug: string; name: string; status: string };

export default function AppsPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [connections, setConnections] = useState<Conn[]>([]);
  const [appSlug, setAppSlug] = useState("openai");
  const [name, setName] = useState("Production");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const [a, c] = await Promise.all([api("/apps"), api("/connections")]);
    setApps(a.apps ?? []);
    setConnections(c.connections ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">App directory</h1>
      <p className="mb-4 text-sm text-muted">Save encrypted API keys here. Google OAuth starts only after GOOGLE_CLIENT_ID is set.</p>
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}
      <Card className="mb-6 max-w-xl">
        <h3 className="mb-3 font-medium">New connection</h3>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/connections", {
              method: "POST",
              body: JSON.stringify({ appSlug, name, authType: "api_key", credentials: { api_key: apiKey } })
            });
            setApiKey("");
            setMsg("Connection saved (credentials encrypted at rest)");
            await load();
          }}
        >
          <select
            className="rounded-lg border border-line bg-[#0e1428] px-2 py-2 text-sm"
            value={appSlug}
            onChange={(e) => setAppSlug(e.target.value)}
          >
            {apps.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name} ({a.authType ?? "none"})
              </option>
            ))}
          </select>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Connection name" />
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key / token" type="password" />
          <Button type="submit">Save connection</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const d = await api(`/oauth/google/start?appSlug=${encodeURIComponent(appSlug)}`);
              window.location.href = d.url;
            }}
          >
            Connect Google OAuth
          </Button>
        </form>
      </Card>
      <h2 className="mb-2 text-lg">Connections</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-2">
        {connections.map((c) => (
          <Card key={c.id}>
            <h3>{c.name}</h3>
            <div className="text-sm text-muted">
              {c.app_slug} · {c.status}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/connections/${c.id}/test`, { method: "POST" });
                  setMsg("Connection test ok");
                  await load();
                }}
              >
                Test
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await api(`/connections/${c.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <h2 className="mb-2 text-lg">Catalog</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {apps.map((a) => (
          <Card key={a.slug}>
            <h3>{a.name}</h3>
            <div className="text-sm text-muted">{a.category}</div>
            <p className="text-sm">{a.description}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

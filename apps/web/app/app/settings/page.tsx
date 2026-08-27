"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

export default function SettingsPage() {
  const [org, setOrg] = useState<{ name?: string; plan_slug?: string } | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; email: string; role: string }>>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [keys, setKeys] = useState<Array<{ id: string; name: string; key_prefix: string; revoked_at?: string }>>([]);
  const [mcp, setMcp] = useState<Array<{ id: string; name: string; token_prefix: string; revoked_at?: string }>>([]);
  const [orgName, setOrgName] = useState("");
  const [wsName, setWsName] = useState("Staging");
  const [invite, setInvite] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const [o, w, k, t] = await Promise.all([api("/organization"), api("/workspaces"), api("/api-keys"), api("/mcp/tokens")]);
    setOrg(o.organization);
    setOrgName(o.organization?.name ?? "");
    setMembers(o.members ?? []);
    setWorkspaces(w.workspaces ?? []);
    setKeys(k.keys ?? []);
    setMcp(t.tokens ?? []);
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mb-4 text-sm text-muted">Organization, workspaces, API keys, MCP tokens.</p>
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}
      {secret && (
        <Card className="mb-4 border-emerald-700">
          <p className="text-sm">Copy now — plaintext is not stored:</p>
          <code className="break-all text-xs">{secret}</code>
        </Card>
      )}
      <Card className="mb-4">
        <h3>Organization</h3>
        <p className="mb-2 text-sm text-muted">Plan: {org?.plan_slug}</p>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/organization", { method: "PATCH", body: JSON.stringify({ name: orgName }) });
            setMsg("Organization updated");
            await load();
          }}
        >
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <Button type="submit">Save name</Button>
        </form>
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/organization/members", { method: "POST", body: JSON.stringify({ email: invite, role: "member" }) });
            setInvite("");
            setMsg("Member added (they must already have an account)");
            await load();
          }}
        >
          <Input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Invite email" />
          <Button type="submit">Add org member</Button>
        </form>
        <ul className="mt-2 text-sm text-muted">
          {members.map((m) => (
            <li key={m.id}>
              {m.email} · {m.role}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mb-4">
        <h3>Workspaces</h3>
        <form
          className="mb-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/workspaces", { method: "POST", body: JSON.stringify({ name: wsName }) });
            await load();
          }}
        >
          <Input value={wsName} onChange={(e) => setWsName(e.target.value)} />
          <Button type="submit">Create workspace</Button>
        </form>
        {workspaces.map((w) => (
          <button
            key={w.id}
            className="mb-1 block text-left text-sm text-muted hover:text-white"
            onClick={() => {
              localStorage.setItem("workspaceId", w.id);
              window.location.reload();
            }}
          >
            Switch to {w.name} ({w.slug})
          </button>
        ))}
      </Card>
      <Card className="mb-4">
        <h3>API keys</h3>
        <Button
          className="mt-2"
          onClick={async () => {
            const d = await api("/api-keys", { method: "POST", body: JSON.stringify({ name: "CLI" }) });
            setSecret(d.secret);
            await load();
          }}
        >
          Create API key
        </Button>
        <ul className="mt-2 text-sm text-muted">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2">
              <span>
                {k.name} · {k.key_prefix}… {k.revoked_at ? "(revoked)" : ""}
              </span>
              {!k.revoked_at && (
                <Button variant="secondary" onClick={async () => { await api(`/api-keys/${k.id}`, { method: "DELETE" }); await load(); }}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3>MCP tokens</h3>
        <p className="mb-2 text-sm text-muted">Bearer tokens for Cursor/Claude against http://localhost:4000/mcp</p>
        <Button
          onClick={async () => {
            const d = await api("/mcp/tokens", { method: "POST", body: JSON.stringify({ name: "Cursor" }) });
            setSecret(d.secret);
            setMsg(`MCP endpoint ${d.endpoint}`);
            await load();
          }}
        >
          Create MCP token
        </Button>
        <ul className="mt-2 text-sm text-muted">
          {mcp.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span>
                {t.name} · {t.token_prefix}… {t.revoked_at ? "(revoked)" : ""}
              </span>
              {!t.revoked_at && (
                <Button variant="secondary" onClick={async () => { await api(`/mcp/tokens/${t.id}`, { method: "DELETE" }); await load(); }}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCardGrid } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import Link from "next/link";

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["organization"],
    queryFn: () =>
      api<{
        organization: { name: string; plan_slug?: string };
        members: Array<{ id: string; email: string; role: string }>;
      }>("/organization"),
  });
  const ws = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Array<{ id: string; name: string; slug: string }> }>("/workspaces"),
  });
  const [orgName, setOrgName] = useState("");
  const [invite, setInvite] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Organization, members, and workspace switcher." />
      <div className="mb-4 flex gap-3 text-sm">
        <Link className="text-teal font-medium" href="/settings">General</Link>
        <Link className="text-ink-muted" href="/developer">Developer</Link>
        <Link className="text-ink-muted" href="/billing">Billing</Link>
        <Link className="text-ink-muted" href="/audit">Audit</Link>
      </div>

      {q.isLoading ? (
        <SkeletonCardGrid count={3} />
      ) : (
        <>
          <Card className="mb-4">
            <h3 className="mb-2 font-semibold">Organization</h3>
            <p className="mb-2 text-sm text-ink-muted">Plan: {q.data?.organization.plan_slug ?? "—"}</p>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  await api("/organization", { method: "PATCH", body: JSON.stringify({ name: orgName || q.data?.organization.name }) });
                  toast.success("Organization updated");
                  q.refetch();
                } catch (err) {
                  toast.error("Failed to update", { description: err instanceof Error ? err.message : "Unknown error" });
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Input value={orgName || q.data?.organization.name || ""} onChange={(e) => setOrgName(e.target.value)} />
              <Button type="submit" disabled={saving}>
                {saving ? <><Spinner size={14} className="mr-1" /> Saving…</> : "Save"}
              </Button>
            </form>
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!invite.trim()) return;
                setSaving(true);
                try {
                  await api("/organization/members", { method: "POST", body: JSON.stringify({ email: invite, role: "member" }) });
                  toast.success("Member added", { description: "They must already have an account." });
                  setInvite("");
                  q.refetch();
                } catch (err) {
                  toast.error("Failed to add member", { description: err instanceof Error ? err.message : "Unknown error" });
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Invite email" />
              <Button type="submit" disabled={saving}>Add member</Button>
            </form>
            <ul className="mt-3 text-sm text-ink-muted">
              {(q.data?.members ?? []).map((m) => (
                <li key={m.id}>{m.email} · {m.role}</li>
              ))}
            </ul>
          </Card>

          <Card className="mb-4">
            <h3 className="mb-2 font-semibold">Global variables</h3>
            <p className="mb-2 text-sm text-ink-muted">Named values reusable across automations in this workspace.</p>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const d = await api<{ variables: Array<{ id: string; key: string; value: string }> }>("/variables");
                  const asObj = Object.fromEntries((d.variables ?? []).map((v) => [v.key, v.value]));
                  const next = window.prompt("JSON object of variables", JSON.stringify(asObj, null, 2));
                  if (!next) return;
                  const parsed = JSON.parse(next) as Record<string, string>;
                  for (const [key, value] of Object.entries(parsed)) {
                    await api("/variables", { method: "PUT", body: JSON.stringify({ key, value: String(value) }) });
                  }
                  toast.success("Variables saved");
                } catch (err) {
                  toast.error("Failed to save variables", { description: err instanceof Error ? err.message : "Unknown error" });
                }
              }}
            >
              Edit variables
            </Button>
          </Card>

          <Card>
            <h3 className="mb-2 font-semibold">Workspaces</h3>
            {(ws.data?.workspaces ?? []).map((w) => (
              <button
                key={w.id}
                className="mb-1 block text-left text-sm text-ink-muted hover:text-ink"
                onClick={() => {
                  localStorage.setItem("workspaceId", w.id);
                  toast.success(`Switched to ${w.name}`);
                  window.location.reload();
                }}
              >
                Switch to {w.name} ({w.slug})
              </button>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

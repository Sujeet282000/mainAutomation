"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL, getToken, getWorkspaceId } from "@/lib/api";
import { isGoogleApp } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AuthField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
  helpUrlLabel?: string;
  options?: { label: string; value: string }[];
};
type AuthSchema = {
  authType: string;
  fields: AuthField[];
  oauthProvider?: string;
  note?: string;
  confirmTitle?: string;
  confirmBody?: string;
};
type Conn = { id: string; name: string; status: string; appSlug?: string; app_slug?: string; zap_count?: string };

export function ConnectAccountModal({
  appSlug,
  appName,
  returnTo,
  replaceConnectionId,
  onClose,
  onConnected
}: {
  appSlug: string;
  appName?: string;
  returnTo?: string;
  replaceConnectionId?: string | null;
  onClose: () => void;
  onConnected: (connectionId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("Personal");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const setupQ = useQuery({
    queryKey: ["connection-setup", appSlug],
    queryFn: () => api<{ authSchema: AuthSchema }>(`/connections/setup/${encodeURIComponent(appSlug)}`)
  });
  const listQ = useQuery({
    queryKey: ["connections"],
    queryFn: () => api<{ connections: Conn[] }>("/connections")
  });
  const schema = setupQ.data?.authSchema;
  const google = schema?.oauthProvider === "google" || isGoogleApp(appSlug);
  const visibleFields = useMemo(
    () => schema?.fields ?? [{ key: "api_key", label: "API key", type: "password", required: true }],
    [schema]
  );
  const existing = (listQ.data?.connections ?? []).filter((c) => {
    const connectionApp = c.appSlug ?? c.app_slug ?? "";
    return connectionApp === appSlug || (isGoogleApp(connectionApp) && isGoogleApp(appSlug));
  });
  const filtered = existing.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "oauth-complete" || !event.data.connectionId) return;
      qc.invalidateQueries({ queryKey: ["connections"] });
      onConnected(String(event.data.connectionId));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onConnected, qc]);

  const create = useMutation({
    mutationFn: async () => {
      const credentials: Record<string, string> = {};
      for (const f of visibleFields) credentials[f.key] = fields[f.key] ?? (f.type === "select" ? String(f.options?.[0]?.value ?? "") : "");
      const saved = replaceConnectionId
        ? await api<{ connection: { id: string } }>(`/connections/${replaceConnectionId}`, {
            method: "PATCH",
            body: JSON.stringify({ credentials })
          })
        : await api<{ connection: { id: string } }>("/connections", {
            method: "POST",
            body: JSON.stringify({ appSlug, name, authType: schema?.authType, credentials })
          });
      const id = saved.connection?.id ?? replaceConnectionId;
      if (!id) throw new Error("Connection was not saved.");
      try {
        await api(`/connections/${id}/test`, { method: "POST" });
      } catch (err) {
        throw new Error(
          `${err instanceof Error ? err.message : "Connection test failed"}. The account was saved — paste a valid key and reconnect, then test the step.`
        );
      }
      return { connection: { id } };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      if (data.connection?.id) onConnected(data.connection.id);
    },
    onError: (err: Error) => setError(err.message)
  });

  async function startGoogle() {
    const token = getToken();
    const ws = getWorkspaceId();
    const returnQuery = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
    const res = await fetch(`${API_URL}/oauth/google/start?appSlug=${encodeURIComponent(appSlug)}${returnQuery}`, {
      headers: { authorization: `Bearer ${token}`, "x-workspace-id": ws ?? "" }
    });
    const d = await res.json();
    if (!d.url) {
      setError(d.error ?? "Google OAuth is not configured.");
      return;
    }
    window.location.assign(d.url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-elevated shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5">
          <div>
            <p className="text-xs text-ink-muted">Connect to Orchestra</p>
            <h2 className="mt-1 text-lg font-semibold">{appName ?? appSlug}</h2>
          </div>
          <button type="button" className="text-ink-muted" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-5 pb-5 pt-3">
          {existing.length > 0 && (
            <div className="mb-4">
              <input
                className="mb-2 h-9 w-full rounded-lg border border-line px-3 text-sm"
                placeholder="Search accounts"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="max-h-40 space-y-1 overflow-auto">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => onConnected(c.id)}
                    disabled={c.status !== "connected"}
                  >
                    <span>
                      <span className="block">{c.name}</span>
                      <span className="text-[11px] text-ink-muted">
                        Used in {c.zap_count ?? "0"} workflows · {c.status.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span className="h-3.5 w-3.5 rounded-full border border-violet-600" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {google ? (
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-sm font-medium">{schema?.confirmTitle ?? `Are you sure you want to connect your ${appName ?? appSlug} account?`}</p>
              <p className="mt-2 text-xs text-ink-muted">{schema?.confirmBody ?? "Credentials are encrypted. Copilot can reuse this account later but cannot create it."}</p>
            </div>
          ) : (
            <>
              {schema?.note && <p className="mb-3 text-xs text-ink-muted">{schema.note}</p>}
              <label className="text-[13px] text-ink-muted">
                Connection name
                <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal" />
              </label>
              {visibleFields.map((f) => (
                <label key={f.key} className="mt-3 block text-[13px] text-ink">
                  {f.label}
                  {f.required !== false && <span className="text-danger"> *</span>}
                  {f.type === "select" ? (
                    <select
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-elevated px-2 text-sm"
                      value={fields[f.key] ?? f.options?.[0]?.value ?? ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="mt-1"
                      type={f.type === "password" ? "password" : "text"}
                      value={fields[f.key] ?? ""}
                      placeholder={f.placeholder ?? ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                  {(f.helpUrl || f.help) && (
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {f.helpUrl && (
                        <a className="text-violet-700" href={f.helpUrl} target="_blank" rel="noreferrer">
                          {f.helpUrlLabel ?? "Open docs"}
                        </a>
                      )}{" "}
                      {f.help}
                    </p>
                  )}
                </label>
              ))}
            </>
          )}
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-muted/40 px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (google ? void startGoogle() : create.mutate())} disabled={create.isPending}>
            {google ? "Connect" : create.isPending ? "Saving…" : replaceConnectionId ? "Save and test key" : existing.length ? "+ Connect a new account" : "Connect"}
          </Button>
        </div>
      </div>
    </div>
  );
}

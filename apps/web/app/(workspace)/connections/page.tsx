"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, List, MoreVertical, Plug, Search } from "lucide-react";
import { mergeCatalog, type CatalogApp } from "@/lib/catalog";
import { api } from "@/lib/api";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectAccountModal } from "@/features/connections/connect-account-modal";
import { cn } from "@/lib/utils";

type AppRow = { slug: string; name: string; authType?: string };
type Conn = {
  id: string;
  name: string;
  status: string;
  appSlug?: string;
  app_slug?: string;
  appName?: string;
  appVersion?: string;
  zapCount?: number;
};

function slugOf(c: Conn) {
  return c.appSlug ?? c.app_slug ?? "";
}

function ConnectionsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => api<{ apps: CatalogApp[] }>("/apps") });
  const list = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: Conn[] }>("/connections") });
  const [q, setQ] = useState("");
  const [appSearch, setAppSearch] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const returnTo = params.get("returnTo");
  const [createOpen, setCreateOpen] = useState(Boolean(params.get("app")) && !params.get("connected"));
  const [createApp, setCreateApp] = useState(params.get("connected") ? "" : (params.get("app") ?? ""));
  const [flash, setFlash] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [pendingDelete, setPendingDelete] = useState<Conn | null>(null);
  const catalogApps = mergeCatalog(appsQ.data?.apps);

  function finishConnection(connectionId: string) {
    if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return;
    const url = new URL(returnTo, window.location.origin);
    url.searchParams.set("connectionId", connectionId);
    router.push(`${url.pathname}${url.search}`);
  }

  async function deleteConnection(connection: Conn) {
    try {
      await api(`/connections/${connection.id}`, { method: "DELETE" });
      setFlash("Connection deleted.");
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Could not delete connection.");
    }
  }

  useEffect(() => {
    const connected = params.get("connected");
    const connectionId = params.get("connectionId");
    if (connected) {
      setFlash(`${connected} connected. Secrets will not be shown again.`);
      setCreateOpen(false);
      setCreateApp("");
      if (connectionId) finishConnection(connectionId);
    }
  }, [params, returnTo]);

  const rows = useMemo(() => {
    const all = list.data?.connections ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((c) => `${c.name} ${slugOf(c)} ${c.appName ?? ""}`.toLowerCase().includes(term));
  }, [list.data, q]);

  const rename = useMutation({
    mutationFn: () => api(`/connections/${renameId}`, { method: "PATCH", body: JSON.stringify({ name: renameValue }) }),
    onSuccess: () => {
      setRenameId(null);
      qc.invalidateQueries({ queryKey: ["connections"] });
    }
  });

  return (
    <div>
      <PageHeader
        title="Connections"
        description="One app can have many accounts. Workflows store a connection id, never the secret."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            + Create connection
          </Button>
        }
      />
      {flash && <p className="mb-4 text-sm text-ok">{flash}</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">Connected accounts</p><p className="mt-1 text-2xl font-semibold">{rows.length}</p></div>
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">Ready to use</p><p className="mt-1 text-2xl font-semibold text-ok">{rows.filter((c) => c.status === "connected").length}</p></div>
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">Need attention</p><p className="mt-1 text-2xl font-semibold text-danger">{rows.filter((c) => c.status !== "connected").length}</p></div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search connection or app name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-lg border border-line p-1">
          <button type="button" aria-label="Card view" className={cn("rounded-md p-1.5", view === "cards" && "bg-muted")} onClick={() => setView("cards")}><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" aria-label="Table view" className={cn("rounded-md p-1.5", view === "table" && "bg-muted")} onClick={() => setView("table")}><List className="h-4 w-4" /></button>
        </div>
      </div>
      {!list.isLoading && !rows.length && (
        <EmptyState icon={<Plug className="h-10 w-10" />} title="No connections" description="Add an account to use apps in the builder. You can connect the same app more than once." />
      )}
      {rows.length > 0 && view === "cards" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <div key={c.id} className="rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card">
              <div className="flex items-start gap-3">
                <AppIcon slug={slugOf(c)} />
                <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{c.name}</h3><p className="mt-1 truncate text-xs text-ink-muted">{c.appName ?? slugOf(c)} · {c.id.slice(0, 8)}</p></div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-muted"><span>Used in {c.zapCount ?? 0} workflows</span><span>{c.appVersion ?? "1.0.0"}</span></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {returnTo && <Button size="sm" onClick={() => finishConnection(c.id)}>Use in workflow</Button>}
                <Button variant="secondary" size="sm" onClick={async () => { try { await api(`/connections/${c.id}/test`, { method: "POST" }); setFlash("Connection test succeeded."); list.refetch(); } catch (err) { setFlash(err instanceof Error ? err.message : "Test failed"); } }}>Test connection</Button>
                <Button variant="secondary" size="sm" onClick={() => { setRenameId(c.id); setRenameValue(c.name); }}>Rename</Button>
                <Button variant="secondary" size="sm" className="text-danger" onClick={() => setPendingDelete(c)}>Delete</Button>
              </div>
              {renameId === c.id && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}><Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8" /><Button size="sm" type="submit">Save</Button></form>}
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && view === "table" && (
        <div className="overflow-x-auto rounded-xl border border-line bg-elevated">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="border-b border-line bg-muted/50 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">App</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Zap workflows</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <AppIcon slug={slugOf(c)} />
                      <div>
                        {renameId === c.id ? (
                          <form
                            className="flex gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              rename.mutate();
                            }}
                          >
                            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8" />
                            <Button size="sm" type="submit">
                              Save
                            </Button>
                          </form>
                        ) : (
                          <>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-ink-muted">{c.id.slice(0, 8)}</div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.appName ?? slugOf(c)}</div>
                    <div className="text-xs text-ink-muted">{c.appVersion ?? "1.0.0"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={c.status} />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            await api(`/connections/${c.id}/test`, { method: "POST" });
                            setFlash("Connection test succeeded.");
                            list.refetch();
                          } catch (err) {
                            setFlash(err instanceof Error ? err.message : "Test failed");
                          }
                        }}
                      >
                        Test connection
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{c.zapCount ?? 0}</td>
                  <td className="relative px-4 py-3 text-right">
                    <button type="button" className="rounded-md p-1 hover:bg-muted" onClick={() => setMenuId(menuId === c.id ? null : c.id)}>
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {menuId === c.id && (
                      <div className="absolute right-4 z-10 mt-1 w-44 rounded-lg border border-line bg-elevated py-1 text-left shadow-card">
                        {returnTo && (
                          <button type="button" className="block w-full px-3 py-1.5 text-sm hover:bg-muted" onClick={() => finishConnection(c.id)}>
                            Use in Zap
                          </button>
                        )}
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-sm hover:bg-muted"
                          onClick={() => {
                            setRenameId(c.id);
                            setRenameValue(c.name);
                            setMenuId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-sm hover:bg-muted"
                          onClick={() => void navigator.clipboard.writeText(c.id)}
                        >
                          Copy ID
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-sm text-danger hover:bg-muted"
                          onClick={() => {
                            setMenuId(null);
                            setPendingDelete(c);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {createOpen && !createApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Add new connection</h2>
            <p className="mt-1 text-sm text-ink-muted">Pick the app, then enter credentials. Secrets are never shown again.</p>
            <Input className="mt-3" placeholder="Search apps" value={appSearch} onChange={(e) => setAppSearch(e.target.value)} />
            <div className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
              {catalogApps
                .filter((a) => (a.authType ?? "none") !== "none")
                .filter((a) => `${a.name} ${a.slug}`.toLowerCase().includes(appSearch.toLowerCase()))
                .map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent px-2 py-2 text-left hover:border-violet-200 hover:bg-muted"
                    onClick={() => setCreateApp(a.slug)}
                  >
                    <AppIcon slug={a.slug} size="sm" />
                    <span>
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="block text-xs text-ink-muted">{a.authType}</span>
                    </span>
                  </button>
                ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      {createOpen && createApp && (
        <ConnectAccountModal
          appSlug={createApp}
          appName={(appsQ.data?.apps ?? []).find((a) => a.slug === createApp)?.name}
          returnTo={returnTo ?? undefined}
          onClose={() => {
            setCreateOpen(false);
            setCreateApp("");
          }}
          onConnected={(id) => {
            setCreateOpen(false);
            setCreateApp("");
            qc.invalidateQueries({ queryKey: ["connections"] });
            setFlash("Connection saved.");
            finishConnection(id);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete connection?"
        body={
          pendingDelete
            ? `Remove ${pendingDelete.name}? Steps using this account will need a new connection. Secrets are not shown again.`
            : ""
        }
        confirmLabel="Delete connection"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const c = pendingDelete;
          setPendingDelete(null);
          if (c) void deleteConnection(c);
        }}
      />
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading connections…</p>}>
      <ConnectionsInner />
    </Suspense>
  );
}

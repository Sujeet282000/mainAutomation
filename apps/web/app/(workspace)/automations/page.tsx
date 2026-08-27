"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, List, MoreHorizontal, Plus, Search, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { summarizeGraph, type GraphPayload } from "@/lib/graph";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type Auto = {
  id: string;
  name: string;
  status: string;
  updated_at?: string;
  graph?: GraphPayload;
};
type WorkflowAction = { id: string; type: "duplicate" | "status" | "delete"; status?: string };
type WorkflowMutation = { isPending: boolean; mutate: (variables: WorkflowAction) => void };

const TABS = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "draft", label: "Drafts" },
  { id: "off", label: "Off" }
];

export default function AutomationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [menu, setMenu] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Auto | null>(null);
  const list = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Auto[] }>("/automations") });

  const action = useMutation({
    mutationFn: async ({ id, type, status }: WorkflowAction) => {
      if (type === "duplicate") {
        return api<{ automation: { id: string } }>(`/automations/${id}/duplicate`, { method: "POST" });
      }
      return api(`/automations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(type === "delete" ? { deleted: true } : { status })
      });
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      setMenu(null);
      if (variables.type === "duplicate" && "automation" in data) router.push(`/automations/${data.automation.id}/editor`);
    }
  });

  const create = useMutation({
    mutationFn: () => api<{ automation: { id: string } }>("/automations", { method: "POST", body: JSON.stringify({ name: "Untitled automation" }) }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      router.push(`/automations/${d.automation.id}/editor`);
    }
  });

  const items = useMemo(() => {
    return (list.data?.automations ?? []).filter((a) => {
      if (tab !== "all" && a.status !== tab) return false;
      return a.name.toLowerCase().includes(q.toLowerCase());
    });
  }, [list.data, q, tab]);

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Build workflows that connect apps. Each workflow is one trigger plus one or more actions."
        actions={
          <div className="flex gap-2">
            <Link href="/templates">
              <Button variant="secondary">Explore templates</Button>
            </Link>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              <Plus className="h-4 w-4" />
              {create.isPending ? "Creating…" : "Create workflow"}
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">All workflows</p><p className="mt-1 text-2xl font-semibold">{list.data?.automations.length ?? 0}</p></div>
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">Live</p><p className="mt-1 text-2xl font-semibold text-ok">{(list.data?.automations ?? []).filter((a) => a.status === "on").length}</p></div>
        <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm"><p className="text-xs text-ink-muted">Drafts to finish</p><p className="mt-1 text-2xl font-semibold text-violet-700">{(list.data?.automations ?? []).filter((a) => a.status === "draft").length}</p></div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search automations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium", tab === t.id ? "bg-muted text-ink" : "text-ink-muted")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border border-line p-1">
          <button type="button" aria-label="Card view" className={cn("rounded-md p-1.5", view === "cards" && "bg-muted")} onClick={() => setView("cards")}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Table view" className={cn("rounded-md p-1.5", view === "table" && "bg-muted")} onClick={() => setView("table")}>
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {list.isError && <p className="mb-4 text-sm text-danger">{(list.error as Error).message}</p>}
      {action.isError && <p className="mb-4 text-sm text-danger">{(action.error as Error).message}</p>}
      {list.isLoading && (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        </div>
      )}
      {!list.isLoading && !items.length && (
        <EmptyState
          icon={<Workflow className="h-10 w-10" />}
          title="No workflows yet"
        description="Connect a trigger to an action. Open the flow builder or start from a template."
          actionLabel="Create workflow"
          onAction={() => create.mutate()}
        />
      )}

      {view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => {
            const sum = summarizeGraph(a.graph);
            return (
              <div key={a.id} className="rounded-2xl border border-line bg-elevated p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-card">
                <div className="flex items-start gap-3">
                  <Link href={`/automations/${a.id}/editor`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><h3 className="truncate font-semibold">{a.name}</h3><StatusBadge status={a.status === "on" ? "on" : a.status === "off" ? "off" : "draft"} /></div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted"><span className="flex -space-x-1">{sum.apps.slice(0, 4).map((slug) => <AppIcon key={slug} slug={slug} size="sm" className="ring-2 ring-elevated" />)}</span><span className="truncate">{sum.path || "Open editor"}</span></div>
                  </Link>
                  <WorkflowActions automation={a} menu={menu} setMenu={setMenu} action={action} onDelete={() => setPendingDelete(a)} />
                </div>
                <div className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">Updated {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : "recently"}</div>
              </div>
            );
          })}
        </div>
      ) : <div className="divide-y divide-line rounded-xl border border-line bg-elevated">
        {items.map((a) => {
          const sum = summarizeGraph(a.graph);
          return (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/60">
              <Link href={`/automations/${a.id}/editor`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[15px] font-medium">{a.name}</h3>
                  <StatusBadge status={a.status === "on" ? "on" : a.status === "off" ? "off" : "draft"} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                  <span className="flex -space-x-1">
                    {sum.apps.slice(0, 4).map((slug) => (
                      <AppIcon key={slug} slug={slug} size="sm" className="ring-2 ring-elevated" />
                    ))}
                  </span>
                  <span className="truncate">{sum.path || "Open editor"}</span>
                </div>
              </Link>
              <WorkflowActions automation={a} menu={menu} setMenu={setMenu} action={action} onDelete={() => setPendingDelete(a)} />
            </div>
          );
        })}
      </div>}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete workflow?"
        body={pendingDelete ? `Delete ${pendingDelete.name}? This removes the draft from your workspace.` : ""}
        confirmLabel="Delete workflow"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) action.mutate({ id: pendingDelete.id, type: "delete" });
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function WorkflowActions({
  automation,
  menu,
  setMenu,
  action,
  onDelete
}: {
  automation: Auto;
  menu: string | null;
  setMenu: (id: string | null) => void;
  action: WorkflowMutation;
  onDelete: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Actions for ${automation.name}`}
        className="rounded-lg p-2 text-ink-muted hover:bg-muted"
        onClick={() => setMenu(menu === automation.id ? null : automation.id)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu === automation.id && (
        <div className="absolute right-0 z-20 w-44 rounded-xl border border-line bg-elevated p-1 shadow-card">
          <Link className="block rounded-lg px-3 py-2 text-sm hover:bg-muted" href={`/automations/${automation.id}/editor`}>
            Open editor
          </Link>
          <button
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            disabled={action.isPending}
            onClick={() => action.mutate({ id: automation.id, type: "duplicate" })}
          >
            Duplicate
          </button>
          <button
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            disabled={action.isPending}
            onClick={() => action.mutate({ id: automation.id, type: "status", status: automation.status === "on" ? "off" : "on" })}
          >
            {automation.status === "on" ? "Turn off" : "Turn on"}
          </button>
          <button
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-muted"
            disabled={action.isPending}
            onClick={() => {
              setMenu(null);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

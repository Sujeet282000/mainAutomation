"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCardGrid } from "@/components/ui/skeleton";
import { isGoogleApp } from "@/lib/catalog";
import { API_URL, getToken, getWorkspaceId } from "@/lib/api";

type Op = { key?: string; name: string; type: string; description?: string };
type App = { slug: string; name: string; description?: string; category?: string; authType?: string; operations: Op[]; rateLimit?: { maxPerMinute?: number } | null };
type Conn = { id: string; name: string; app_slug?: string; appSlug?: string; status?: string; last_tested_at?: string | null };

export default function AppDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: ["app", slug], queryFn: () => api<{ app: App }>(`/apps/${slug}`) });
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: Conn[] }>("/connections") });
  const a = q.data?.app;
  const appConns = (conns.data?.connections ?? []).filter((c) => (c.app_slug ?? c.appSlug) === slug);

  async function connect() {
    if (a && isGoogleApp(a.slug)) {
      const res = await fetch(`${API_URL}/oauth/google/start?appSlug=${encodeURIComponent(a.slug)}`, {
        headers: { authorization: `Bearer ${getToken()}`, "x-workspace-id": getWorkspaceId() ?? "" }
      });
      const d = await res.json();
      if (d.url) window.location.href = d.url;
      else router.push(`/connections?app=${slug}`);
      return;
    }
    router.push(`/connections?app=${slug}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={a?.name ?? "App"}
        description={a?.description}
        actions={
          <Button onClick={() => void connect()}>Connect</Button>
        }
      />
      {q.isLoading && <SkeletonCardGrid count={3} />}
      {q.isError && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {a && (
        <>
          <div className="mb-6 flex items-center gap-3">
            <AppIcon slug={a.slug} size="lg" />
            <div className="text-sm text-ink-muted">
              {a.category} · {a.authType === "none" ? "No account required" : a.authType}
            </div>
          </div>

          {/* Capability summary + connection state — reflects backend truth only */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-elevated p-3">
              <p className="text-[10px] uppercase text-ink-muted">Triggers</p>
              <p className="text-lg font-semibold">{a.operations.filter((o) => o.type === "trigger").length}</p>
            </div>
            <div className="rounded-xl border border-line bg-elevated p-3">
              <p className="text-[10px] uppercase text-ink-muted">Actions</p>
              <p className="text-lg font-semibold">{a.operations.filter((o) => o.type === "action").length}</p>
            </div>
            <div className="rounded-xl border border-line bg-elevated p-3">
              <p className="text-[10px] uppercase text-ink-muted">Searches</p>
              <p className="text-lg font-semibold">{a.operations.filter((o) => o.type === "search").length}</p>
            </div>
            <div className="rounded-xl border border-line bg-elevated p-3">
              <p className="text-[10px] uppercase text-ink-muted">Connections</p>
              <p className="text-lg font-semibold">{appConns.length}</p>
            </div>
          </div>
          {a.rateLimit?.maxPerMinute ? (
            <p className="mb-4 text-xs text-ink-muted">Upstream rate limit: {a.rateLimit.maxPerMinute} requests/min (shared across the workspace)</p>
          ) : null}
          {appConns.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Your connections</h2>
              <ul className="divide-y divide-line rounded-xl border border-line bg-elevated">
                {appConns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-ink-muted">
                      {c.last_tested_at ? `Tested ${new Date(c.last_tested_at).toLocaleDateString()}` : "Not tested yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(["trigger", "action", "search"] as const).map((type) => {
            const ops = a.operations.filter((o) => o.type === type);
            if (!ops.length) return null;
            return (
              <section key={type} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">{type}s</h2>
                <ul className="divide-y divide-line rounded-xl border border-line bg-elevated">
                  {ops.map((o) => (
                    <li key={o.key ?? o.name} className="px-4 py-3">
                      <div className="text-[15px] font-medium">{o.name}</div>
                      {o.description && <p className="text-sm text-ink-muted">{o.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <Link href="/connections" className="text-sm text-teal">
            Manage connections
          </Link>
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { isGoogleApp } from "@/lib/catalog";
import { API_URL, getToken, getWorkspaceId } from "@/lib/api";

type Op = { key?: string; name: string; type: string; description?: string };
type App = { slug: string; name: string; description?: string; category?: string; authType?: string; operations: Op[] };

export default function AppDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: ["app", slug], queryFn: () => api<{ app: App }>(`/apps/${slug}`) });
  const a = q.data?.app;

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
      {q.isError && <p className="text-sm text-danger">{(q.error as Error).message}</p>}
      {a && (
        <>
          <div className="mb-6 flex items-center gap-3">
            <AppIcon slug={a.slug} size="lg" />
            <div className="text-sm text-ink-muted">
              {a.category} · {a.authType === "none" ? "No account required" : a.authType}
            </div>
          </div>
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

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, Plug } from "lucide-react";
import { api } from "@/lib/api";
import { mergeCatalog } from "@/lib/catalog";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

type AppRow = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  authType?: string;
  operations?: Array<{ type: string }>;
};
type Conn = { id: string; name: string; status: string; appSlug?: string; app_slug?: string };

export default function AppsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const list = useQuery({ queryKey: ["apps"], queryFn: () => api<{ apps: AppRow[] }>("/apps") });
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: Conn[] }>("/connections") });
  const apps = mergeCatalog(list.data?.apps);
  const cats = ["all", ...Array.from(new Set(apps.map((a) => a.category).filter(Boolean)))] as string[];
  const filtered = useMemo(
    () => apps.filter((a) => {
      if (cat !== "all" && a.category !== cat) return false;
      return `${a.name} ${a.description} ${a.slug}`.toLowerCase().includes(q.toLowerCase());
    }),
    [apps, cat, q]
  );

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const connection of connections.data?.connections ?? []) {
      const slug = connection.appSlug ?? connection.app_slug ?? "";
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }, [connections.data]);

  return (
    <div>
      <PageHeader
        title="Apps"
        description="Browse real catalog apps, inspect their capabilities, and connect reusable accounts. Credentials are encrypted and never shown again."
        actions={<Link href="/connections"><Button variant="secondary">Manage connections</Button></Link>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-xs font-medium ${cat === c ? "bg-muted text-ink" : "text-ink-muted hover:bg-muted"}`}>{c}</button>)}
        </div>
      </div>
      {list.isError && <p className="mb-3 text-sm text-danger">{(list.error as Error).message}</p>}
      {!list.isLoading && !filtered.length && <EmptyState icon={<Plug className="h-10 w-10" />} title="No apps match" description="Try another search, or open Connections to add an account." />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => {
          const ops = a.operations ?? [];
          const connected = connectionCounts.get(a.slug) ?? 0;
          return (
            <Card key={a.slug} className="flex flex-col">
              <div className="flex items-start gap-3">
                <AppIcon slug={a.slug} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-medium">{a.name}</h3>
                  <p className="text-xs uppercase text-ink-muted">{a.category}</p>
                </div>
                <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-muted">{a.authType ?? "none"}</span>
              </div>
              <p className="mt-3 flex-1 text-sm text-ink-muted">{a.description}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
                <span>{ops.filter((o) => o.type === "trigger").length} triggers · {ops.filter((o) => o.type === "action").length} actions</span>
                <span>{connected} {connected === 1 ? "account" : "accounts"}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Link href={`/apps/${a.slug}`} className="flex-1 text-sm text-teal">View app</Link>
                {a.authType !== "none" && <Link href={`/connections?app=${encodeURIComponent(a.slug)}`} className="text-sm text-teal">Connect</Link>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

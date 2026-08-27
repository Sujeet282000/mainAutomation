"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { mergeCatalog } from "@/lib/catalog";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Plug } from "lucide-react";

type AppRow = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  authType?: string;
  operations?: Array<{ type: string }>;
};

export default function AppsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const list = useQuery({ queryKey: ["apps"], queryFn: () => api<{ apps: AppRow[] }>("/apps") });
  const apps = mergeCatalog(list.data?.apps);
  const cats = ["all", ...Array.from(new Set(apps.map((a) => a.category).filter(Boolean)))] as string[];
  const filtered = useMemo(
    () =>
      apps.filter((a) => {
        if (cat !== "all" && a.category !== cat) return false;
        return `${a.name} ${a.description} ${a.slug}`.toLowerCase().includes(q.toLowerCase());
      }),
    [apps, cat, q]
  );

  return (
    <div>
      <PageHeader
        title="Apps"
        description="Connect the tools you already use. Credentials are encrypted and never shown again."
        actions={
          <Link href="/connections">
            <Button variant="secondary">Manage connections</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${cat === c ? "bg-muted text-ink" : "text-ink-muted hover:bg-muted"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {list.isError && <p className="mb-3 text-sm text-danger">{(list.error as Error).message}</p>}
      {!list.isLoading && !filtered.length && (
        <EmptyState icon={<Plug className="h-10 w-10" />} title="No apps match" description="Try another search, or open Connections to add an account." />
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => {
          const ops = a.operations ?? [];
          return (
            <Card key={a.slug} className="flex flex-col">
              <div className="flex items-start gap-3">
                <AppIcon slug={a.slug} size="lg" />
                <div>
                  <h3 className="text-[15px] font-medium">{a.name}</h3>
                  <p className="text-xs uppercase text-ink-muted">{a.category}</p>
                </div>
              </div>
              <p className="mt-3 flex-1 text-sm text-ink-muted">{a.description}</p>
              <p className="mt-2 text-xs text-ink-muted">
                {ops.filter((o) => o.type === "trigger").length} triggers · {ops.filter((o) => o.type === "action").length} actions
              </p>
              <Link href={`/apps/${a.slug}`} className="mt-3 text-sm text-teal">
                View app
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

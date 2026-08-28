"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { mergeCatalog, type CatalogApp } from "@/lib/catalog";
import { AppIcon } from "@/components/app-icon";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Search, Shield, Zap } from "lucide-react";

type Connection = { id: string; name: string; status: string; appSlug?: string; app_slug?: string };

type ReadinessCheck = {
  slug: string;
  hasManifest: boolean;
  hasAuth: boolean;
  hasOperations: boolean;
  hasTriggers: boolean;
  hasActions: boolean;
  connectedCount: number;
  readinessScore: number;
};

function getReadiness(app: CatalogApp, connectionCount: number): ReadinessCheck {
  const ops = app.operations ?? [];
  const triggers = ops.filter((o) => o.type === "trigger");
  const actions = ops.filter((o) => o.type === "action" || o.type === "search");
  const score = [
    Boolean(app.slug),
    Boolean(app.name),
    (app.authType ?? "none") !== "none",
    ops.length > 0,
    triggers.length > 0,
    actions.length > 0,
    connectionCount > 0,
  ].filter(Boolean).length;

  return {
    slug: app.slug,
    hasManifest: Boolean(app.slug && app.name),
    hasAuth: (app.authType ?? "none") !== "none",
    hasOperations: ops.length > 0,
    hasTriggers: triggers.length > 0,
    hasActions: actions.length > 0,
    connectedCount: connectionCount,
    readinessScore: Math.round((score / 7) * 100),
  };
}

function ReadinessBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", score >= 80 ? "bg-ok" : score >= 50 ? "bg-warn" : "bg-danger")}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-ink-muted">{score}%</span>
    </div>
  );
}

function ReadinessChecklist({ check }: { check: ReadinessCheck }) {
  const [expanded, setExpanded] = useState(false);
  const items = [
    { label: "Manifest", ok: check.hasManifest },
    { label: "Auth configured", ok: check.hasAuth },
    { label: "Has operations", ok: check.hasOperations },
    { label: "Has triggers", ok: check.hasTriggers },
    { label: "Has actions", ok: check.hasActions },
    { label: "Connected accounts", ok: check.connectedCount > 0, detail: `${check.connectedCount} connected` },
  ];

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between text-[11px]"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-ink-muted">Readiness checklist</span>
        {expanded ? <ChevronUp className="h-3 w-3 text-ink-muted" /> : <ChevronDown className="h-3 w-3 text-ink-muted" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              {item.ok ? (
                <CheckCircle2 className="h-3 w-3 text-ok" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-ink-muted" />
              )}
              <span className={cn("text-[11px]", item.ok ? "text-ink" : "text-ink-muted")}>{item.label}</span>
              {item.detail && <span className="text-[10px] text-ink-muted">({item.detail})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IntegrationHealthPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "readiness" | "connections">("readiness");

  const listQ = useQuery({ queryKey: ["apps"], queryFn: () => api<{ apps: CatalogApp[] }>("/apps") });
  const connectionsQ = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: Connection[] }>("/connections") });

  const apps = mergeCatalog(listQ.data?.apps ?? []);
  const connections = connectionsQ.data?.connections ?? [];

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of connections) {
      const slug = c.appSlug ?? c.app_slug ?? "";
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }, [connections]);

  const readinessData = useMemo(() => {
    return apps.map((app) => ({
      app,
      readiness: getReadiness(app, connectionCounts.get(app.slug) ?? 0),
    }));
  }, [apps, connectionCounts]);

  const cats = useMemo(() => {
    return ["all", ...Array.from(new Set(apps.map((a) => a.category).filter(Boolean)))] as string[];
  }, [apps]);

  const filtered = useMemo(() => {
    let data = readinessData;
    if (cat !== "all") data = data.filter((d) => d.app.category === cat);
    if (q) {
      const lower = q.toLowerCase();
      data = data.filter((d) => `${d.app.name} ${d.app.slug} ${d.app.description}`.toLowerCase().includes(lower));
    }
    if (sortBy === "readiness") data.sort((a, b) => b.readiness.readinessScore - a.readiness.readinessScore);
    else if (sortBy === "connections") data.sort((a, b) => b.readiness.connectedCount - a.readiness.connectedCount);
    else data.sort((a, b) => a.app.name.localeCompare(b.app.name));
    return data;
  }, [readinessData, cat, q, sortBy]);

  const stats = useMemo(() => {
    const total = readinessData.length;
    const productionReady = readinessData.filter((d) => d.readiness.readinessScore >= 80).length;
    const partial = readinessData.filter((d) => d.readiness.readinessScore >= 40 && d.readiness.readinessScore < 80).length;
    const manifestOnly = readinessData.filter((d) => d.readiness.readinessScore < 40).length;
    const withConnections = readinessData.filter((d) => d.readiness.connectedCount > 0).length;
    return { total, productionReady, partial, manifestOnly, withConnections };
  }, [readinessData]);

  return (
    <div>
      <PageHeader
        title="Integration Health"
        description={`Monitor readiness across ${stats.total} catalog apps. Production-ready: ${stats.productionReady}, Partial: ${stats.partial}, Manifest only: ${stats.manifestOnly}.`}
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-ok" />
            <span className="text-[11px] text-ink-muted">Production Ready</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-ok">{stats.productionReady}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-warn" />
            <span className="text-[11px] text-ink-muted">Partial</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-warn">{stats.partial}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-ink-muted" />
            <span className="text-[11px] text-ink-muted">Manifest Only</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-ink-muted">{stats.manifestOnly}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-blue-600" />
            <span className="text-[11px] text-ink-muted">Connected</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-600">{stats.withConnections}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input className="pl-9" placeholder="Search integrations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="readiness">Sort by readiness</option>
            <option value="connections">Sort by connections</option>
            <option value="name">Sort by name</option>
          </select>
          <div className="flex flex-wrap gap-1">
            {cats.slice(0, 8).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn("rounded-full px-2.5 py-1 text-[10px] font-medium", cat === c ? "bg-muted text-ink" : "text-ink-muted hover:bg-muted")}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* App Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map(({ app, readiness }) => (
          <Card key={app.slug} className="flex flex-col p-3">
            <div className="flex items-start gap-3">
              <AppIcon slug={app.slug} size="md" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{app.name}</h3>
                <p className="text-[10px] text-ink-muted">{app.category}</p>
              </div>
              <ReadinessBar score={readiness.readinessScore} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px]">
              {(app.authType ?? "none") !== "none" ? (
                <span className="rounded-full bg-ok/10 px-1.5 py-0.5 text-ok font-medium">Auth</span>
              ) : (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-ink-muted">No auth</span>
              )}
              {app.operations.length > 0 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700 font-medium">
                  {app.operations.length} ops
                </span>
              )}
              {readiness.connectedCount > 0 && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-700 font-medium">
                  {readiness.connectedCount} conn
                </span>
              )}
            </div>
            <div className="mt-3">
              <ReadinessChecklist check={readiness} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { Input } from "@/components/ui/input";
import { libraryGroup, opKey, type CatalogApp, type CatalogOp } from "@/lib/catalog";

const GROUPS = ["Triggers", "Apps", "Flow", "AI", "Developer"] as const;

export type PaletteItem = { app: CatalogApp; op: CatalogOp };

export function NodePalette({
  apps,
  onPick
}: {
  apps: CatalogApp[];
  onPick: (app: CatalogApp, op: CatalogOp) => void;
}) {
  const [q, setQ] = useState("");
  const grouped = useMemo(() => {
    const visible = apps
      .map((a) => ({
        ...a,
        operations: a.operations.filter((op) => `${op.type} ${a.name} ${op.name}`.toLowerCase().includes(q.toLowerCase()))
      }))
      .filter((a) => a.operations.length);
    return GROUPS.map((group) => ({
      group,
      items: visible.flatMap((app) =>
        app.operations
          .filter((op) => (group === "Triggers" ? op.type === "trigger" : op.type !== "trigger" && libraryGroup(app.slug) === group))
          .map((op) => ({ app, op }))
      )
    })).filter((g) => g.items.length);
  }, [apps, q]);

  return (
    <aside className="flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-line bg-elevated">
      <div className="border-b border-line p-2">
        <Input placeholder="Search triggers & actions" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {grouped.map((g) => (
          <section key={g.group} className="mb-3">
            <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{g.group}</h3>
            {g.items.map(({ app, op }) => (
              <button
                key={`${app.slug}-${opKey(op)}`}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/atuomate-op",
                    JSON.stringify({ slug: app.slug, operation: opKey(op), opType: op.type, name: op.name })
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPick(app, op)}
                className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs hover:bg-muted"
                title={`${app.name} · ${op.name}`}
              >
                <AppIcon slug={app.slug} size="sm" />
                <span className="min-w-0 truncate">
                  <span className="block truncate font-medium">{op.name}</span>
                  <span className="block truncate text-[10px] capitalize text-ink-muted">
                    {op.type} · {app.name}
                  </span>
                </span>
              </button>
            ))}
          </section>
        ))}
        {!grouped.length && <p className="px-1 text-xs text-ink-muted">No matching triggers or actions.</p>}
      </div>
    </aside>
  );
}

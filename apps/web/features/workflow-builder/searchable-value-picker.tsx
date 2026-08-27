"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchOption = { label: string; value: string; hint?: string };

export function SearchableValuePicker({
  title,
  options,
  value,
  loading,
  onSearch,
  onSelect,
  onRefresh,
  onClear,
  onClose,
  staticMode = true
}: {
  title: string;
  options: SearchOption[];
  value?: string;
  loading?: boolean;
  onSearch?: (q: string) => void;
  onSelect: (value: string) => void;
  onRefresh?: () => void;
  onClear?: () => void;
  onClose: () => void;
  staticMode?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => `${o.label} ${o.value} ${o.hint ?? ""}`.toLowerCase().includes(needle));
  }, [options, q]);

  return (
    <div className="absolute z-30 mt-1 w-[min(100%,360px)] overflow-hidden rounded-xl border border-line bg-elevated shadow-card">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="text-sm font-medium">{title}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-ink-muted">{staticMode ? "Static" : "Dynamic"}</span>
      </div>
      <div className="relative border-b border-line p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <input
          autoFocus
          className="h-9 w-full rounded-lg border border-line bg-elevated pl-8 pr-2 text-sm outline-none focus:border-violet-400"
          placeholder="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onSearch?.(e.target.value);
          }}
        />
      </div>
      <div className="max-h-64 overflow-auto">
        {loading && (
          <p className="flex items-center gap-2 px-3 py-4 text-xs text-ink-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading values…
          </p>
        )}
        {!loading &&
          filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className={cn("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted", value === o.value && "bg-muted")}
              onClick={() => {
                onSelect(o.value);
                onClose();
              }}
            >
              <span className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", value === o.value ? "border-violet-600 bg-violet-600" : "border-line")} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{o.label}</span>
                {o.hint && <span className="block truncate text-[11px] text-ink-muted">{o.hint}</span>}
              </span>
            </button>
          ))}
        {!loading && !filtered.length && <p className="px-3 py-6 text-center text-xs text-ink-muted">No matching values</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-muted/40 px-2 py-2 text-[11px]">
        <span className="text-ink-muted">Loaded {filtered.length} results.</span>
        <button type="button" className="ml-auto text-violet-700" onClick={() => onRefresh?.()}>
          <RefreshCw className="mr-1 inline h-3 w-3" /> Refresh
        </button>
        <button type="button" className="inline-flex items-center text-ink-muted" onClick={() => onClear?.()}>
          <X className="mr-1 h-3 w-3" /> Clear selection
        </button>
      </div>
    </div>
  );
}

export function SearchableEventList({
  events,
  value,
  onPick
}: {
  events: Array<{ key: string; name: string; description?: string; group?: string }>;
  value?: string;
  onPick: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = events.filter((e) => `${e.name} ${e.description ?? ""} ${e.key}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map((e) => e.group ?? "ACTIONS"))];

  return (
    <div className="absolute z-30 mt-1 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-elevated shadow-card">
      <div className="flex gap-3 border-b border-line px-3 pt-2 text-sm">
        <span className="border-b-2 border-violet-600 pb-2 font-medium">Standard actions</span>
        <span className="pb-2 text-ink-muted">Custom actions</span>
      </div>
      <div className="relative p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <input
          autoFocus
          className="h-9 w-full rounded-lg border border-line pl-8 pr-2 text-sm outline-none focus:border-violet-400"
          placeholder="Search events"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="max-h-72 overflow-auto pb-2">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{g}</p>
            {filtered
              .filter((e) => (e.group ?? "ACTIONS") === g)
              .map((e) => (
                <button
                  key={e.key}
                  type="button"
                  className={cn("block w-full px-3 py-2 text-left hover:bg-muted", value === e.key && "bg-muted")}
                  onClick={() => onPick(e.key)}
                >
                  <span className="block text-sm font-medium">{e.name}</span>
                  {e.description && <span className="block text-[11px] text-ink-muted">{e.description}</span>}
                </button>
              ))}
          </div>
        ))}
        {!filtered.length && <p className="px-3 py-6 text-center text-xs text-ink-muted">No matching events</p>}
      </div>
    </div>
  );
}

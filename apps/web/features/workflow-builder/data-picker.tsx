"use client";

import { useMemo, useState } from "react";
import { Braces, Calendar, Hash, List, Sparkles, ToggleLeft, Type } from "lucide-react";
import { Input } from "@/components/ui/input";

export type DataToken = {
  token: string;
  label: string;
  group: string;
  preview?: string;
  kind?: "string" | "number" | "boolean" | "object" | "array" | "date";
};

function TypeIcon({ kind }: { kind?: DataToken["kind"] }) {
  const cls = "h-3.5 w-3.5 text-ink-muted";
  if (kind === "number") return <Hash className={cls} />;
  if (kind === "boolean") return <ToggleLeft className={cls} />;
  if (kind === "object") return <Braces className={cls} />;
  if (kind === "array") return <List className={cls} />;
  if (kind === "date") return <Calendar className={cls} />;
  return <Type className={cls} />;
}

export function DataPicker({
  tokens,
  onPick
}: {
  tokens: DataToken[];
  onPick: (token: string) => void;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"data" | "dynamic" | "formulas">("data");
  const filtered = useMemo(
    () => tokens.filter((t) => `${t.group} ${t.label} ${t.token}`.toLowerCase().includes(q.toLowerCase())),
    [q, tokens]
  );
  const groups = [...new Set(filtered.map((t) => t.group))];

  return (
    <div className="absolute z-20 mt-1 w-[min(100%,420px)] overflow-hidden rounded-xl border border-line bg-elevated shadow-card">
      <div className="flex gap-3 border-b border-line px-3 pt-2 text-sm">
        {(["data", "dynamic", "formulas"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "border-b-2 border-violet-600 pb-2 font-medium capitalize" : "pb-2 capitalize text-ink-muted"}
            onClick={() => setTab(t)}
          >
            {t === "data" ? "Data" : t === "dynamic" ? "Dynamic" : "Formulas"}
          </button>
        ))}
      </div>
      <div className="border-b border-line p-2">
        <Input autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        <div className="mt-2 flex gap-2 text-[11px]">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-violet-600">Previous steps</span>
          <span className="rounded-full px-2 py-0.5 text-ink-muted">In-use data</span>
        </div>
        <button type="button" className="mt-2 flex w-full items-center justify-between rounded-lg bg-muted px-2 py-1.5 text-left text-[11px] text-ink">
          <span className="inline-flex items-center gap-1 font-medium">
            <Sparkles className="h-3 w-3" /> Copilot suggestions
          </span>
          <span className="rounded-full bg-elevated px-1.5 text-[10px]">AI</span>
        </button>
      </div>
      <div className="max-h-56 overflow-auto p-1">
        {tab !== "data" && <p className="px-3 py-6 text-center text-xs text-ink-muted">Use previous-step data, or type a custom value.</p>}
        {tab === "data" &&
          groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{g}</div>
              {filtered
                .filter((t) => t.group === g)
                .map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => onPick(t.token)}
                  >
                    <TypeIcon kind={t.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{t.label}</span>
                      {t.preview && <span className="block truncate text-[11px] text-ink-muted">{t.preview}</span>}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        {tab === "data" && !filtered.length && <p className="px-3 py-6 text-center text-xs text-ink-muted">No matching fields</p>}
      </div>
    </div>
  );
}

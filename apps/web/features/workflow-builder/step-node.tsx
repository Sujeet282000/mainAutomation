"use client";

import { AlertTriangle, Check, Loader2, MoreVertical, Plus, X } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { AppIcon } from "@/components/app-icon";
import { cn } from "@/lib/utils";
import type { StepData } from "./store";

export type RunState = "idle" | "queued" | "running" | "waiting" | "ok" | "fail";

/* ── Status icon — filled circle style ──────────────────────────────────── */

function StatusIcon({ run, empty }: { run: RunState; empty: boolean }) {
  /* Running — violet spinner with filled background */
  if (run === "running") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-white shadow-sm">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  /* Queued — muted dot */
  if (run === "queued") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
      </span>
    );
  }

  /* Waiting — amber spinner with filled background */
  if (run === "waiting") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  /* Success — green filled circle with white checkmark (matching image) */
  if (run === "ok") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }

  /* Fail — red filled circle with white X (matching image) */
  if (run === "fail") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-sm">
        <X className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }

  /* Empty step — amber warning */
  if (empty) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
      </span>
    );
  }

  /* Default idle — subtle dot */
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-ink-muted">
      •
    </span>
  );
}

/* ── Step Node Card ─────────────────────────────────────────────────────── */

export function StepNode({
  data,
  selected
}: NodeProps<StepData & {
  index?: number;
  empty?: boolean;
  runState?: RunState;
  pathLabel?: string;
  needsAccount?: boolean;
  terminal?: boolean;
  onMenu?: (anchor: HTMLElement) => void;
  onAddAccount?: () => void;
  onAddStep?: () => void;
}>) {
  const empty = data.empty || !data.operation;
  const run = data.runState ?? "idle";
  const isPath = data.appSlug === "paths";
  const handles = isPath
    ? ((data.config.paths as Array<{ id: string; label?: string }> | undefined) ?? [
        { id: "path-a", label: "Path A" },
        { id: "path-b", label: "Path B" }
      ])
    : null;
  const appName = data.appSlug ? data.appSlug.replace(/-/g, " ") : empty ? "Choose app" : "Step";

  /* Determine border class based on state */
  const borderClass = (() => {
    if (run === "running") return "border-2 border-violet-400 dark:border-violet-500";
    if (run === "ok") return "border-2 border-emerald-400 dark:border-emerald-500";
    if (run === "fail") return "border-2 border-red-400 dark:border-red-500";
    if (run === "waiting") return "border-2 border-amber-400 dark:border-amber-500";
    if (selected) return "border border-violet-400 dark:border-violet-500";
    if (empty) return "border border-dashed border-line";
    return "border border-line";
  })();

  return (
    <div
      className={cn(
        "relative w-[320px] rounded-xl px-4 py-4 transition-colors duration-200 bg-elevated",
        /* ── Border states ── */
        borderClass,
        /* ── Running pulse ── */
        run === "running" && "av-node-run"
      )}
    >
      {/* Top handle */}
      {data.kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Top}
          className={cn(
            "!h-3 !w-3 !border-2 !border-white dark:!border-slate-900",
            run === "ok" && "!bg-emerald-400",
            run === "fail" && "!bg-red-400",
            run === "running" && "!bg-violet-400",
            run === "waiting" && "!bg-amber-400",
            run !== "ok" && run !== "fail" && run !== "running" && run !== "waiting" && "!bg-slate-400 dark:!bg-slate-500"
          )}
        />
      )}

      {/* Path label */}
      {data.pathLabel && (
        <div className="-mt-1 mb-1.5 flex items-center justify-center gap-1">
          <span className="h-px flex-1 bg-violet-300/50 dark:bg-violet-600/30" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">
            {data.pathLabel}
          </span>
          <span className="h-px flex-1 bg-violet-300/50 dark:bg-violet-600/30" />
        </div>
      )}

      {/* Header row: icon + badge + menu */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <StatusIcon run={run} empty={empty} />
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize",
            run === "ok" && "text-emerald-600 dark:text-emerald-400",
            run === "fail" && "text-red-600 dark:text-red-400",
            run === "running" && "text-violet-600 dark:text-violet-400",
            run === "waiting" && "text-amber-600 dark:text-amber-400",
            run === "queued" && "text-ink-muted",
            run === "idle" && "text-ink"
          )}
        >
          {!empty && <AppIcon slug={data.appSlug} size="sm" />}
          <span className="truncate">{empty ? (data.kind === "trigger" ? "Trigger" : "Action") : appName}</span>
        </span>
        <button
          type="button"
          className="ml-auto rounded-lg p-1.5 text-ink-muted hover:text-ink transition-colors"
          aria-label="Open step actions"
          onClick={(event) => {
            event.stopPropagation();
            data.onMenu?.(event.currentTarget);
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Step title */}
      <div className="min-w-0 pl-8.5">
        <div
          className={cn(
            "truncate text-[14px] font-semibold leading-snug",
            run === "ok" && "text-emerald-700 dark:text-emerald-300",
            run === "fail" && "text-red-700 dark:text-red-300",
            run === "running" && "text-violet-700 dark:text-violet-300",
            (run === "idle" || run === "queued" || run === "waiting") && "text-ink"
          )}
        >
          {empty
            ? data.kind === "trigger"
              ? `${data.index ?? 1}. Select the event that starts your Zap`
              : `${data.index ?? ""}. Select the event`
            : `${data.index ?? ""}. ${data.label}`}
        </div>
      </div>

      {/* Connect account prompt */}
      {data.needsAccount && (
        <button
          type="button"
          className="mt-3 flex w-full items-center gap-1.5 rounded-xl border border-dashed border-amber-400/60 bg-elevated px-3 py-2 text-left text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:border-amber-400 transition-colors"
          onClick={(event) => {
            event.stopPropagation();
            data.onAddAccount?.();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Connect account
        </button>
      )}

      {/* Terminal add button */}
      {data.terminal && (
        <button
          type="button"
          className="absolute -bottom-3.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated text-ink-muted hover:border-violet-500 hover:text-violet-600 transition-colors shadow-sm"
          aria-label="Add a step after this action"
          title="Add a step"
          onClick={(event) => {
            event.stopPropagation();
            data.onAddStep?.();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Source handles */}
      {handles ? (
        handles.map((h, i) => (
          <Handle
            key={h.id}
            id={h.id}
            type="source"
            position={Position.Bottom}
            style={{ left: `${((i + 0.5) / handles.length) * 100}%` }}
            className={cn(
              "!h-3 !w-3 !border-2 !border-white dark:!border-slate-900",
              run === "ok" ? "!bg-emerald-400" : "!bg-violet-500"
            )}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className={cn(
            "!h-3 !w-3 !border-2 !border-white dark:!border-slate-900",
            run === "ok" && "!bg-emerald-400",
            run === "fail" && "!bg-red-400",
            run !== "ok" && run !== "fail" && "!bg-violet-500"
          )}
        />
      )}
    </div>
  );
}

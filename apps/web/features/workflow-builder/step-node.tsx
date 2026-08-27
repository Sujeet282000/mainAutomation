"use client";

import { AlertTriangle, Check, Loader2, MoreVertical, Plus, X } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { AppIcon } from "@/components/app-icon";
import { cn } from "@/lib/utils";
import type { StepData } from "./store";

export type RunState = "idle" | "queued" | "running" | "waiting" | "ok" | "fail";

/* ── Status icon with ring animation ────────────────────────────────────── */

function StatusIcon({ run, empty }: { run: RunState; empty: boolean }) {
  /* Running — violet spinner with expanding ring */
  if (run === "running") {
    return (
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-violet-500/20 av-status-ring" />
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-500/30">
          <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      </span>
    );
  }

  /* Queued — muted dot */
  if (run === "queued") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
      </span>
    );
  }

  /* Waiting — amber pulse */
  if (run === "waiting") {
    return (
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping [animation-duration:2s]" />
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-lg shadow-amber-400/25">
          <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      </span>
    );
  }

  /* Success — green check with bounce-in */
  if (run === "ok") {
    return (
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-emerald-400/20 av-status-ring" />
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/40">
          <Check className="h-4 w-4 av-icon-pop" strokeWidth={3} />
        </span>
      </span>
    );
  }

  /* Fail — red cross with shake */
  if (run === "fail") {
    return (
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-red-400/20 av-status-ring" />
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-red-600 text-white shadow-lg shadow-red-500/40">
          <X className="h-4 w-4 av-icon-pop" strokeWidth={3} />
        </span>
      </span>
    );
  }

  /* Empty step — amber warning */
  if (empty) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md shadow-amber-400/20">
        <AlertTriangle className="h-3 w-3" />
      </span>
    );
  }

  /* Default idle — subtle dot */
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-line bg-elevated text-[10px] text-ink-muted">
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

  return (
    <div
      className={cn(
        "relative w-[320px] rounded-2xl border-2 px-4 py-4 shadow-sm transition-all duration-300 ease-out bg-white dark:bg-[rgb(15,22,36)]",
        /* ── Selected ── */
        selected && "border-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.18),0_4px_16px_rgba(139,92,246,0.08)] bg-violet-50/80 dark:bg-violet-950/40",
        /* ── Empty ── */
        !selected && empty && "border-dashed border-slate-300 dark:border-slate-600 bg-white/60 dark:bg-slate-900/40",
        /* ── Configured idle ── */
        !selected && !empty && "border-slate-200/80 dark:border-slate-700/80 hover:border-violet-300 hover:shadow-md dark:hover:border-violet-600",
        /* ── Queued ── */
        run === "queued" && "border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 av-node-queued",
        /* ── Running ── */
        run === "running" && "border-violet-400 dark:border-violet-500 bg-gradient-to-br from-violet-50/80 to-violet-100/60 dark:from-violet-950/30 dark:to-violet-900/20 av-node-run",
        /* ── Waiting ── */
        run === "waiting" && "border-amber-400 dark:border-amber-500 bg-gradient-to-br from-amber-50/80 to-amber-100/50 dark:from-amber-950/25 dark:to-amber-900/15 av-node-wait",
        /* ── Success ── */
        run === "ok" && "border-emerald-400 dark:border-emerald-500 bg-gradient-to-br from-emerald-50/90 to-emerald-100/60 dark:from-emerald-950/25 dark:to-emerald-900/15 shadow-[0_0_0_2px_rgba(16,185,129,0.2)] av-node-ok",
        /* ── Fail ── */
        run === "fail" && "border-red-400 dark:border-red-500 bg-gradient-to-br from-red-50/90 to-red-100/60 dark:from-red-950/25 dark:to-red-900/15 shadow-[0_0_0_2px_rgba(239,68,68,0.2)] av-node-fail"
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
            run === "ok" && "bg-emerald-100/80 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
            run === "fail" && "bg-red-100/80 dark:bg-red-900/30 text-red-700 dark:text-red-300",
            run === "running" && "bg-violet-100/80 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
            run === "waiting" && "bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
            run === "queued" && "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
            run === "idle" && "bg-muted text-ink"
          )}
        >
          {!empty && <AppIcon slug={data.appSlug} size="sm" />}
          <span className="truncate">{empty ? (data.kind === "trigger" ? "Trigger" : "Action") : appName}</span>
        </span>
        <button
          type="button"
          className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-muted hover:text-ink transition-colors"
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
            run === "ok" && "text-emerald-800 dark:text-emerald-200",
            run === "fail" && "text-red-800 dark:text-red-200",
            run === "running" && "text-violet-800 dark:text-violet-200",
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
          className="mt-3 flex w-full items-center gap-1.5 rounded-xl border-2 border-dashed border-amber-400/60 bg-amber-50/50 dark:bg-amber-900/15 px-3 py-2 text-left text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/25 transition-colors"
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
          className="absolute -bottom-3.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-line bg-elevated text-ink-muted shadow-sm hover:border-violet-500 hover:text-violet-600 hover:shadow-md transition-all"
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

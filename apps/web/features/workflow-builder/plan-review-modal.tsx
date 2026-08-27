"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plug,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CopilotPlanResult } from "@/lib/copilot";

type PlanStep = {
  label: string;
  type: "trigger" | "action" | "logic";
  app: string;
};

export function PlanReviewModal({
  open,
  plan,
  loading,
  error,
  onConfirm,
  onCancel,
  onEdit,
}: {
  open: boolean;
  plan: CopilotPlanResult | null;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (!open) return null;

  const steps: PlanStep[] = plan?.preview?.steps ?? [];
  const appsUsed = plan?.preview?.apps_used ?? [];
  const missingConns = plan?.preview?.missing_connections ?? [];
  const missingInfo = plan?.preview?.missing_information ?? [];
  const confidence = plan?.preview?.confidence ?? 0;
  const summary = plan?.preview?.summary ?? plan?.reply ?? "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4">
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-elevated shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold">Plan & Review</h2>
            <p className="text-xs text-ink-muted">
              Review what Copilot will build before confirming
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-muted hover:bg-muted"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Loading state */}
        {loading && !plan && (
          <div className="flex flex-col items-center gap-3 px-5 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            <p className="text-sm text-ink-muted">
              Copilot is understanding your request…
            </p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="px-5 py-6">
            <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-medium text-danger">
                  Could not generate plan
                </p>
                <p className="mt-1 text-xs text-ink-muted">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Plan content */}
        {plan && !loading && (
          <div className="px-5 py-4">
            {/* Summary */}
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
              <p className="text-sm font-medium text-violet-800">
                Here&apos;s what I understood
              </p>
              <p className="mt-2 text-sm text-ink leading-relaxed">{summary}</p>
            </div>

            {/* Confidence bar */}
            {confidence > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      confidence >= 0.8
                        ? "bg-ok"
                        : confidence >= 0.5
                          ? "bg-warn"
                          : "bg-danger"
                    )}
                    style={{ width: `${Math.round(confidence * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-ink-muted">
                  {Math.round(confidence * 100)}% confidence
                </span>
              </div>
            )}

            {/* Workflow steps preview */}
            {steps.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-sm font-medium text-ink"
                  onClick={() => setExpanded((v) => !v)}
                >
                  <span>Workflow steps ({steps.length})</span>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4 text-ink-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-muted" />
                  )}
                </button>
                {expanded && (
                  <div className="mt-2 space-y-1">
                    {steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                            step.type === "trigger"
                              ? "bg-violet-600"
                              : step.type === "logic"
                                ? "bg-amber-500"
                                : "bg-blue-600"
                          )}
                        >
                          {step.type === "trigger" ? (
                            <Zap className="h-3 w-3" />
                          ) : step.type === "logic" ? (
                            <Bot className="h-3 w-3" />
                          ) : (
                            i
                          )}
                        </span>
                        <span className="text-sm text-ink">{step.label}</span>
                        <span className="text-[10px] text-ink-muted">
                          ({step.app})
                        </span>
                        {i < steps.length - 1 && (
                          <ArrowRight className="ml-auto h-3 w-3 text-ink-muted" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Apps used */}
            {appsUsed.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-ink-muted">
                  Apps I&apos;ll use
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {appsUsed.map((app) => (
                    <span
                      key={app.slug}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-muted px-2.5 py-1 text-xs text-ink"
                    >
                      {app.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing connections */}
            {missingConns.length > 0 && (
              <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-xs font-medium text-warn">
                  <Plug className="mr-1 inline h-3 w-3" />
                  Needs your attention
                </p>
                <ul className="mt-2 space-y-1">
                  {missingConns.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-1.5 text-xs text-ink"
                    >
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Missing information */}
            {missingInfo.length > 0 && (
              <div className="mt-3 rounded-xl border border-line bg-muted/40 p-3">
                <p className="text-xs font-medium text-ink">
                  I still need from you
                </p>
                <ul className="mt-2 space-y-1">
                  {missingInfo.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-1.5 text-xs text-ink-muted"
                    >
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <p className="text-[10px] text-ink-muted">
            Copilot cannot sign in or publish
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit request
            </Button>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={loading || !plan}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              {loading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              Build workflow
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

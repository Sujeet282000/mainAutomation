"use client";

import { Bot, ChevronRight, Plug, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewStep = {
  label: string;
  type: "trigger" | "action" | "logic";
  app: string;
  connected?: boolean;
};

export type WorkflowPreviewData = {
  summary?: string;
  steps: PreviewStep[];
  missingConnections?: string[];
  missingInformation?: string[];
  confidence?: number;
};

function StepIcon({ type }: { type: string }) {
  if (type === "trigger")
    return <Zap className="h-3 w-3 text-violet-600" />;
  if (type === "logic")
    return <Bot className="h-3 w-3 text-amber-600" />;
  return <ChevronRight className="h-3 w-3 text-blue-600" />;
}

export function WorkflowPreview({
  preview,
  compact,
}: {
  preview: WorkflowPreviewData;
  compact?: boolean;
}) {
  if (!preview.steps.length) return null;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-violet-800">
        <Sparkles className="h-3 w-3" />
        {preview.summary ?? "Workflow plan"}
      </div>

      {/* Visual flow */}
      <div className={cn("mt-2 flex flex-col items-start gap-0", compact && "gap-0")}>
        {preview.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            {/* Connector line */}
            {i > 0 && (
              <div className="ml-2.5 flex h-3 w-px bg-violet-300" />
            )}
            {/* Step */}
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white/80 px-2 py-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full",
                  step.type === "trigger"
                    ? "bg-violet-100"
                    : step.type === "logic"
                      ? "bg-amber-100"
                      : "bg-blue-100"
                )}
              >
                <StepIcon type={step.type} />
              </span>
              <span className="text-[11px] font-medium text-ink">
                {step.label}
              </span>
              {step.connected === false && (
                <Plug className="h-2.5 w-2.5 text-warn" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Missing info */}
      {(preview.missingConnections?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {preview.missingConnections!.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10px] text-warn"
            >
              <Plug className="h-2.5 w-2.5" />
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Confidence */}
      {preview.confidence != null && preview.confidence > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                preview.confidence >= 0.8
                  ? "bg-ok"
                  : preview.confidence >= 0.5
                    ? "bg-warn"
                    : "bg-danger"
              )}
              style={{ width: `${Math.round(preview.confidence * 100)}%` }}
            />
          </div>
          <span className="text-[9px] text-ink-muted">
            {Math.round(preview.confidence * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

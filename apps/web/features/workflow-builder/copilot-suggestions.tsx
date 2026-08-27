"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopilotSuggestionsCard({
  open,
  stepLabel,
  youDoFirst,
  iCan,
  onCustomize
}: {
  open: boolean;
  stepLabel: string;
  youDoFirst: string[];
  iCan: string[];
  onCustomize: () => void;
}) {
  if (!open) return null;
  const human = youDoFirst.slice(0, 3);
  const copilot = iCan.slice(0, 3);
  return (
    <div className="mb-4 rounded-xl border border-line bg-muted/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" />
          Copilot suggestions
        </p>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-violet-600">AI</span>
      </div>
      {human.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-ink">
          {human.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-ink-muted">Nothing you must do first on {stepLabel}. I can map empty fields or add the next action if you ask.</p>
      )}
      {copilot.length ? (
        <p className="mt-2 text-[11px] text-ink-muted">I can: {copilot.join(" ")}</p>
      ) : null}
      <Button size="sm" variant="secondary" className="mt-2" type="button" onClick={onCustomize}>
        Customize generation
      </Button>
    </div>
  );
}

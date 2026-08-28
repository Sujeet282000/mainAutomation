"use client";

import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageInfo({ title, description, tips }: {
  title: string;
  description: string;
  tips?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-muted hover:text-teal"
        title={`About ${title}`}
        onClick={() => setOpen((v) => !v)}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-elevated shadow-card">
            <div className="flex items-start justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{title}</p>
              </div>
              <button className="rounded-lg p-1 text-ink-muted hover:bg-muted" onClick={() => setOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs leading-relaxed text-ink-muted">{description}</p>
              {tips && tips.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase text-ink-muted">Quick tips</p>
                  {tips.map((tip, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-ink-muted">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-teal" />
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

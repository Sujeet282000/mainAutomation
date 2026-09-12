import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Card — the shared surface for all workspace content.
 * `interactive` adds the hover-lift micro-interaction for clickable cards.
 */
export function Card({ className, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn("rounded-2xl border border-line bg-elevated p-5 shadow-card ws-card-in", interactive && "ws-lift cursor-pointer", className)} {...props} />;
}

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-elevated px-6 py-16 text-center", className)}>
      {icon && <div className="mb-4 text-teal">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

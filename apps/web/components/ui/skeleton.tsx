import { cn } from "@/lib/utils";

/** Pulse skeleton rectangle — drop-in replacement for loading content blocks */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} {...props} />;
}

/** Skeleton card that mimics a data card (icon + text + meta) */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-elevated p-4 shadow-sm", className)}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

/** Skeleton for a table row */
export function SkeletonTableRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 border-b border-line px-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4 flex-1", i === 0 && "w-1/3 flex-none")} />
      ))}
    </div>
  );
}

/** Skeleton for stat cards (number + label) */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-elevated p-4 shadow-sm", className)}>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="mt-2 h-8 w-1/3" />
    </div>
  );
}

/** Skeleton for a grid of stat cards */
export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStat key={i} />
      ))}
    </div>
  );
}

/** Skeleton for a list of cards */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

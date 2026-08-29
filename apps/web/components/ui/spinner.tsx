import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader2 className={cn("animate-spin text-violet-600", className)} style={{ width: size, height: size }} />;
}

/** Full-page loading overlay with spinner */
export function PageLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Spinner size={32} />
      <p className="mt-4 text-sm text-ink-muted">{message}</p>
    </div>
  );
}

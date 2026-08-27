import { cn } from "../../lib/utils";
import { AlertCircle, CheckCircle2, Clock, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";

const MAP: Record<
  string,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  on: { label: "On", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  off: { label: "Off", className: "text-ink-muted bg-muted", icon: MinusCircle },
  draft: { label: "Draft", className: "text-ink-muted bg-muted", icon: PauseCircle },
  published: { label: "Published", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  queued: { label: "Queued", className: "text-info bg-info/10", icon: Clock },
  running: { label: "Running", className: "text-teal bg-teal-soft", icon: Loader2 },
  waiting: { label: "Waiting", className: "text-warn bg-warn/10", icon: Clock },
  paused: { label: "Paused", className: "text-warn bg-warn/10", icon: PauseCircle },
  succeeded: { label: "Succeeded", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  success: { label: "Succeeded", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  failed: { label: "Failed", className: "text-danger bg-danger/10", icon: XCircle },
  error: { label: "Failed", className: "text-danger bg-danger/10", icon: XCircle },
  cancelled: { label: "Cancelled", className: "text-ink-muted bg-muted", icon: MinusCircle },
  timed_out: { label: "Timed out", className: "text-danger bg-danger/10", icon: AlertCircle },
  partially_succeeded: { label: "Partial", className: "text-warn bg-warn/10", icon: AlertCircle },
  connected: { label: "Connected", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  needs_reconnect: { label: "Reconnect", className: "text-warn bg-warn/10", icon: AlertCircle },
  pending: { label: "Pending", className: "text-warn bg-warn/10", icon: Clock },
  approved: { label: "Approved", className: "text-ok bg-ok/10", icon: CheckCircle2 },
  rejected: { label: "Rejected", className: "text-danger bg-danger/10", icon: XCircle }
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const key = (status ?? "draft").toLowerCase();
  const cfg = MAP[key] ?? { label: status ?? "Unknown", className: "text-ink-muted bg-muted", icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", cfg.className, className)}>
      <Icon className={cn("h-3.5 w-3.5", key === "running" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

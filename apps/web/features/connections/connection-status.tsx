"use client";

import { AlertTriangle, Check, Clock, Loader2, Plug, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ConnectionState = "connected" | "needs_attention" | "expired" | "not_configured";

type ConnectionInfo = {
  connectionId?: string | null;
  connectionName?: string;
  connectionStatus?: string;
  appSlug: string;
  appName: string;
  lastUsed?: string;
  expiresAt?: string;
  scopes?: string[];
};

const STATE_CONFIG: Record<ConnectionState, {
  icon: typeof Check;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
}> = {
  connected: {
    icon: Check,
    color: "text-ok",
    bgColor: "bg-ok/10",
    borderColor: "border-ok/30",
    label: "Connected",
    description: "Account is active and ready to use",
  },
  needs_attention: {
    icon: AlertTriangle,
    color: "text-warn",
    bgColor: "bg-warn/10",
    borderColor: "border-warn/30",
    label: "Needs attention",
    description: "Connection needs to be reauthorized or updated",
  },
  expired: {
    icon: Clock,
    color: "text-danger",
    bgColor: "bg-danger/10",
    borderColor: "border-danger/30",
    label: "Expired",
    description: "Credentials have expired and need renewal",
  },
  not_configured: {
    icon: Plug,
    color: "text-ink-muted",
    bgColor: "bg-muted/50",
    borderColor: "border-line",
    label: "Not connected",
    description: "No account connected yet",
  },
};

function getConnectionState(info: ConnectionInfo): ConnectionState {
  if (!info.connectionId) return "not_configured";
  const status = info.connectionStatus?.toLowerCase();
  if (status === "expired" || status === "token_expired") return "expired";
  if (status === "needs_reauth" || status === "invalid_grant" || status === "error") return "needs_attention";
  if (info.expiresAt) {
    const expiresAt = new Date(info.expiresAt);
    if (expiresAt < new Date()) return "expired";
    const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilExpiry < 24) return "needs_attention";
  }
  return "connected";
}

export function ConnectionStatus({
  connection,
  onConnect,
  onReconnect,
  onTest,
  compact = false,
}: {
  connection: ConnectionInfo;
  onConnect?: () => void;
  onReconnect?: () => void;
  onTest?: () => void;
  compact?: boolean;
}) {
  const state = getConnectionState(connection);
  const config = STATE_CONFIG[state];
  const Icon = config.icon;

  if (compact) {
    return (
      <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5", config.borderColor, config.bgColor)}>
        <Icon className={cn("h-2.5 w-2.5", config.color)} />
        <span className={cn("text-[10px] font-medium", config.color)}>
          {connection.connectionName ?? config.label}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border p-3", config.borderColor, config.bgColor)}>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", config.bgColor)}>
          <Icon className={cn("h-4 w-4", config.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-ink">{connection.connectionName ?? connection.appName}</p>
            <span className={cn("text-[10px] font-semibold", config.color)}>{config.label}</span>
          </div>
          <p className="text-[11px] text-ink-muted">{config.description}</p>
          {connection.lastUsed && (
            <p className="mt-0.5 text-[10px] text-ink-muted">
              Last used {new Date(connection.lastUsed).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {state === "connected" && onTest && (
            <Button size="sm" variant="ghost" onClick={onTest}>
              <Loader2 className="h-3 w-3" /> Test
            </Button>
          )}
          {(state === "needs_attention" || state === "expired") && onReconnect && (
            <Button size="sm" variant="secondary" onClick={onReconnect}>
              <RefreshCw className="h-3 w-3" /> Reconnect
            </Button>
          )}
          {state === "not_configured" && onConnect && (
            <Button size="sm" onClick={onConnect}>
              <Plug className="h-3 w-3" /> Connect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectionStatusGroup({
  connections,
  onConnect,
  onReconnect,
  onTest,
}: {
  connections: ConnectionInfo[];
  onConnect?: (appSlug: string) => void;
  onReconnect?: (connectionId: string) => void;
  onTest?: (connectionId: string) => void;
}) {
  const connected = connections.filter((c) => getConnectionState(c) === "connected");
  const needsAttention = connections.filter((c) => getConnectionState(c) === "needs_attention");
  const expired = connections.filter((c) => getConnectionState(c) === "expired");
  const notConfigured = connections.filter((c) => getConnectionState(c) === "not_configured");

  return (
    <div className="space-y-3">
      {needsAttention.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-warn">Needs attention</p>
          {needsAttention.map((c) => (
            <div key={c.appSlug} className="mb-2">
              <ConnectionStatus connection={c} onConnect={() => onConnect?.(c.appSlug)} onReconnect={() => c.connectionId && onReconnect?.(c.connectionId)} onTest={() => c.connectionId && onTest?.(c.connectionId)} />
            </div>
          ))}
        </div>
      )}
      {expired.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-danger">Expired</p>
          {expired.map((c) => (
            <div key={c.appSlug} className="mb-2">
              <ConnectionStatus connection={c} onConnect={() => onConnect?.(c.appSlug)} onReconnect={() => c.connectionId && onReconnect?.(c.connectionId)} />
            </div>
          ))}
        </div>
      )}
      {notConfigured.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Not connected</p>
          {notConfigured.map((c) => (
            <div key={c.appSlug} className="mb-2">
              <ConnectionStatus connection={c} onConnect={() => onConnect?.(c.appSlug)} />
            </div>
          ))}
        </div>
      )}
      {connected.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ok">Connected</p>
          {connected.map((c) => (
            <div key={c.appSlug} className="mb-2">
              <ConnectionStatus connection={c} onTest={() => c.connectionId && onTest?.(c.connectionId)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

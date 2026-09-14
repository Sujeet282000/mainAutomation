"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { api, streamGetSse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  step_id?: string;
  name?: string;
  app_slug?: string;
  operation?: string;
  status: string;
  duration_ms?: number;
  attempt?: number;
  started_at?: string;
  finished_at?: string;
  error?: { message?: string };
  output?: unknown;
  input?: unknown;
};

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value == null) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted transition hover:bg-muted hover:text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-ok" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-danger" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-violet-600" />;
  if (status === "waiting") return <Loader2 className="h-4 w-4 animate-pulse text-amber-500" />;
  return <Circle className="h-4 w-4 text-ink-muted" />;
}

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [liveStatus, setLiveStatus] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["execution", id],
    queryFn: () =>
      api<{
        execution: { status: string; error?: { message?: string }; created_at?: string; finished_at?: string; trigger_type?: string; automation_name?: string; automation_id?: string; trigger_payload?: unknown };
        steps?: Step[];
        logs?: Array<{ id: string; message: string; created_at: string }>;
      }>(`/executions/${id}`),
    // Live runs refresh on SSE step events (below); only active runs poll,
    // and only at a humane 5s backstop. Terminal runs never poll.
    refetchInterval: (query) => {
      const status = query.state.data?.execution?.status;
      return ["succeeded", "failed", "cancelled", "filtered"].includes(status ?? "")
        ? false
        : 5_000;
    },
  });

  // Live run stream (SSE): step_finished events overlay instant per-step
  // statuses and trigger a fetch so the timeline updates as the run executes.
  // streamGetSse sends the bearer header via fetch — EventSource cannot.
  const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "filtered"];
  const runActive = !TERMINAL_STATUSES.includes(q.data?.execution?.status ?? "");
  useEffect(() => {
    if (!runActive || !id) return;
    const controller = new AbortController();
    let cancelled = false;
    void streamGetSse(`/runs/${id}/stream`, (event, data) => {
      if (cancelled) return;
      if (event === "step_finished" && typeof data.stepId === "string") {
        setLiveStatus((prev) => ({ ...prev, [data.stepId as string]: String(data.status ?? "") }));
        queryClient.invalidateQueries({ queryKey: ["execution", id] });
      }
      if (event === "run_finished") {
        queryClient.invalidateQueries({ queryKey: ["execution", id] });
      }
    }, controller.signal).catch(() => {
      /* stream errors are non-fatal: the 5s poll backstop still refreshes */
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, runActive, queryClient]);

  const retry = useMutation({
    mutationFn: () => api<{ execution?: { id: string } }>(`/executions/${id}/retry`, { method: "POST" }),
    onSuccess: (d) => {
      if (d.execution?.id) router.push(`/activity/${d.execution.id}`);
      else q.refetch();
    }
  });
  const [replayError, setReplayError] = useState("");
  const replayFrom = useMutation({
    mutationFn: (fromStepId: string) =>
      api<{ execution: { id: string }; seededSteps: number }>(`/executions/${id}/replay-from`, {
        method: "POST",
        body: JSON.stringify({ fromStepId })
      }),
    onSuccess: (d) => {
      setReplayError("");
      if (d.execution?.id) router.push(`/activity/${d.execution.id}`);
      else q.refetch();
    },
    onError: (err) => setReplayError(err instanceof Error ? err.message : "Replay failed")
  });
  const [diagnosis, setDiagnosis] = useState<{
    cause: string;
    category: string;
    userFix: string;
    patchExplanation: string;
    confidence: number;
    safeToAutoApply: boolean;
  } | null>(null);
  const [diagError, setDiagError] = useState("");
  const diagnose = useMutation({
    mutationFn: () =>
      api<{ diagnosis: NonNullable<typeof diagnosis> }>("/ai/copilot/diagnose-run", {
        method: "POST",
        body: JSON.stringify({ runId: id })
      }),
    onSuccess: (d) => {
      setDiagError("");
      setDiagnosis(d.diagnosis);
    },
    onError: (err) => setDiagError(err instanceof Error ? err.message : "Diagnosis failed")
  });

  const ex = q.data?.execution;
  // SSE events override the fetched step status for instant updates
  const steps = (q.data?.steps ?? []).map((s) =>
    liveStatus[s.step_id ?? s.id] ? { ...s, status: liveStatus[s.step_id ?? s.id]! } : s,
  );
  const failedStepName = steps.find((s) => s.status === "failed")?.name ?? "";
  // Total wall-clock: sum of finished steps or run-level finished_at−created_at
  const runTotalMs =
    ex?.created_at && ex?.finished_at
      ? Math.max(0, new Date(ex.finished_at).getTime() - new Date(ex.created_at).getTime())
      : steps.reduce((acc, s) => acc + (s.duration_ms ?? 0), 0);
  const succeededCount = steps.filter((s) => s.status === "succeeded").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;

  return (
    <div>
      <PageHeader
        title={ex?.automation_name ?? "Run timeline"}
        description="Each box is one task: input, live API result, and errors. Retry starts a new run."
        actions={
          <div className="flex gap-2">
            {ex?.automation_id && (
              <Button variant="secondary" onClick={() => router.push(`/automations/${ex.automation_id}/editor`)}>
                Open workflow
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => diagnose.mutate()}
              disabled={diagnose.isPending}
              title="AI root-cause analysis of this failed run"
            >
              <Sparkles className="h-3.5 w-3.5" /> {diagnose.isPending ? "Diagnosing…" : "Explain this failure"}
            </Button>
            <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
              Replay run
            </Button>
          </div>
        }
      />
      {q.isError && <p className="mb-3 text-sm text-danger">{(q.error as Error).message}</p>}
      {replayError && <p className="mb-3 text-sm text-danger">{replayError}</p>}
      {diagError && <p className="mb-3 text-sm text-danger">{diagError}</p>}
      {diagnosis && (
        <div className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
            <Sparkles className="h-3 w-3" /> Ops Copilot — AI root cause
          </div>
          <p className="font-medium">{diagnosis.cause}</p>
          <p className="mt-1 text-violet-900">{diagnosis.userFix}</p>
          <p className="mt-2 text-xs text-violet-800">
            {diagnosis.patchExplanation} Confidence {Math.round(diagnosis.confidence * 100)}%. Auto-apply is{" "}
            {diagnosis.safeToAutoApply ? "allowed" : "blocked"} — you approve any draft patch.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">{diagnosis.category}</span>
            {failedStepName && (
              <span className="text-[11px] text-violet-700">Failed step: <b>{failedStepName}</b></span>
            )}
          </div>
        </div>
      )}
      {ex && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-elevated px-4 py-3">
          <StatusBadge status={ex.status} />
          <span className="text-sm text-ink-muted">{ex.trigger_type ?? "manual"} trigger</span>
          {ex.created_at && <span className="text-sm text-ink-muted">{new Date(ex.created_at).toLocaleString()}</span>}
          {runTotalMs > 0 && <span className="text-sm text-ink-muted">Total {runTotalMs > 1000 ? `${(runTotalMs / 1000).toFixed(1)}s` : `${runTotalMs}ms`}</span>}
          {steps.length > 0 && (
            <span className="text-sm text-ink-muted">
              {succeededCount}/{steps.length} steps succeeded{failedCount > 0 ? ` · ${failedCount} failed` : ""}
            </span>
          )}
          {ex.error?.message && <span className="text-sm text-danger">{ex.error.message}</span>}
        </div>
      )}
      {/* Trigger payload — the data that started this run. A note explains when
          it is empty (manual/test runs or triggers that fired with no body) so
          an empty section never looks like a bug. */}
      {ex && ex.trigger_payload != null && (
        <div className="mb-6 rounded-2xl border border-line bg-elevated p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Trigger payload</div>
          {Object.keys(ex.trigger_payload as Record<string, unknown>).length > 0 ? (
            <>
              <p className="mb-2 text-xs text-ink-muted">This is the data that started the run.</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                {JSON.stringify(ex.trigger_payload, null, 2)}
              </pre>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              No payload was recorded — this was a manual or test run, or the trigger fired with an empty body. If a webhook
              trigger should always send data, check that the source system includes a JSON body.
            </p>
          )}
        </div>
      )}
      <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-line">
        {steps.map((s, i) => (
          <article key={s.id} className="relative ml-10 rounded-2xl border border-line bg-elevated p-4 shadow-sm">
            <span className="absolute -left-10 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-elevated">
              <StepDot status={s.status} />
            </span>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Step {i + 1}</div>
                <h3 className="text-[15px] font-medium">{s.name ?? s.id}</h3>
                <p className="text-xs text-ink-muted">
                  {(() => {
                    const rawApp = s.app_slug ?? "";
                    const rawOp = s.operation ?? "";
                    const isInternal = !rawApp || ["piece_action", "piece_trigger", "builtin", "manual"].includes(rawApp);
                    const appName = isInternal ? "Built-in step" : rawApp.replace(/-/g, " ");
                    const opLabel = rawOp && !isInternal ? rawOp.replace(/[:_]/g, " ") : "";
                    return [appName, opLabel].filter(Boolean).join(" · ") || "built-in";
                  })()}
                  {s.duration_ms != null ? ` · ${s.duration_ms} ms` : ""}
                  {s.attempt != null && s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}
                </p>
                {s.started_at && (
                  <p className="text-[10px] text-ink-muted">
                    {new Date(s.started_at).toLocaleTimeString()}
                    {s.finished_at ? ` → ${new Date(s.finished_at).toLocaleTimeString()}` : ""}
                  </p>
                )}
              </div>
              <StatusBadge status={s.status} />
            </div>
            {s.error?.message && (
              <p className={cn("mt-2 rounded-lg bg-danger/10 px-2 py-1.5 text-sm text-danger")}>{s.error.message}</p>
            )}
            {/* Replay-from-step: re-run this step onward without repeating upstream side effects */}
            {s.step_id && s.status === "failed" && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-teal/30 bg-teal-soft/20 px-2.5 py-1 text-[11px] font-medium text-teal transition hover:bg-teal-soft/40 active:scale-95"
                disabled={replayFrom.isPending}
                onClick={() => replayFrom.mutate(s.step_id!)}
              >
                {replayFrom.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Replay from here
              </button>
            )}
            <JsonBlock label="Output (live API result)" value={s.output} />
            <JsonBlock label="Input (resolved fields)" value={s.input} />
          </article>
        ))}
      </div>
      <div className="mt-8 space-y-1 rounded-2xl border border-line bg-elevated p-4 text-xs text-ink-muted">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide">Logs</div>
        {(q.data?.logs ?? []).length === 0 && <p>No extra log lines for this run.</p>}
        {(q.data?.logs ?? []).map((l) => (
          <div key={l.id}>
            {new Date(l.created_at).toLocaleString()} · {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

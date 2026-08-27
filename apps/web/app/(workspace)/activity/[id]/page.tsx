"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Sparkles, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  name?: string;
  app_slug?: string;
  operation?: string;
  status: string;
  duration_ms?: number;
  error?: { message?: string };
  output?: unknown;
  input?: unknown;
};

function StepDot({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-ok" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-danger" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-violet-600" />;
  return <Circle className="h-4 w-4 text-ink-muted" />;
}

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["execution", id],
    queryFn: () =>
      api<{
        execution: { status: string; error?: { message?: string }; created_at?: string; trigger_type?: string };
        steps?: Step[];
        logs?: Array<{ id: string; message: string; created_at: string }>;
      }>(`/executions/${id}`),
    refetchInterval: 1500
  });
  const retry = useMutation({
    mutationFn: () => api<{ execution?: { id: string } }>(`/executions/${id}/retry`, { method: "POST" }),
    onSuccess: (d) => {
      if (d.execution?.id) router.push(`/activity/${d.execution.id}`);
      else q.refetch();
    }
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
  const steps = q.data?.steps ?? [];

  return (
    <div>
      <PageHeader
        title="Run timeline"
        description="Each box is one task: input, live API result, and errors. Retry starts a new run."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => diagnose.mutate()} disabled={diagnose.isPending}>
              <Sparkles className="h-3.5 w-3.5" /> {diagnose.isPending ? "Diagnosing…" : "Explain this failure"}
            </Button>
            <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
              Replay run
            </Button>
          </div>
        }
      />
      {q.isError && <p className="mb-3 text-sm text-danger">{(q.error as Error).message}</p>}
      {diagError && <p className="mb-3 text-sm text-danger">{diagError}</p>}
      {diagnosis && (
        <div className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">Ops Copilot</div>
          <p className="font-medium">{diagnosis.cause}</p>
          <p className="mt-1 text-violet-900">{diagnosis.userFix}</p>
          <p className="mt-2 text-xs text-violet-800">
            {diagnosis.patchExplanation} Confidence {Math.round(diagnosis.confidence * 100)}%. Auto-apply is{" "}
            {diagnosis.safeToAutoApply ? "allowed" : "blocked"} — you approve any draft patch.
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-violet-700">{diagnosis.category}</p>
        </div>
      )}
      {ex && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-elevated px-4 py-3">
          <StatusBadge status={ex.status} />
          <span className="text-sm text-ink-muted">{ex.trigger_type ?? "manual"} trigger</span>
          {ex.created_at && <span className="text-sm text-ink-muted">{new Date(ex.created_at).toLocaleString()}</span>}
          {ex.error?.message && <span className="text-sm text-danger">{ex.error.message}</span>}
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
                  {[s.app_slug, s.operation].filter(Boolean).join(" · ") || "built-in"}
                  {s.duration_ms != null ? ` · ${s.duration_ms} ms` : ""}
                </p>
              </div>
              <StatusBadge status={s.status} />
            </div>
            {s.error?.message && (
              <p className={cn("mt-2 rounded-lg bg-danger/10 px-2 py-1.5 text-sm text-danger")}>{s.error.message}</p>
            )}
            {s.output != null && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed">
                {JSON.stringify(s.output, null, 2)}
              </pre>
            )}
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

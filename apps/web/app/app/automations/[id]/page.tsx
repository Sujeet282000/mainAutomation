"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { generateCopilotDraft, persistCopilotSession } from "../../../../lib/copilot";
import { WorkflowBuilder } from "../../../../components/workflow-builder";

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const [auto, setAuto] = useState<{ name: string } | null>(null);
  const [graph, setGraph] = useState<{ nodes: unknown[]; edges: unknown[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [prompt, setPrompt] = useState("Catch a webhook and POST it to https://httpbin.org/post");
  const [versions, setVersions] = useState<Array<{ id: string; version_number: number; created_at: string }>>([]);

  useEffect(() => {
    Promise.all([api(`/automations/${params.id}`), api(`/automations/${params.id}/versions`)]).then(([d, v]) => {
      setAuto(d.automation);
      setGraph(d.version?.graph ?? { nodes: [], edges: [] });
      setVersions(v.versions ?? []);
    });
  }, [params.id]);

  if (!graph) return <p className="text-muted">Loading builder…</p>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{auto?.name ?? "Editor"}</h1>
      {msg && <p className="mb-3 text-sm text-emerald-400">{msg}</p>}
      {versions.length > 1 && (
        <p className="mb-3 text-xs text-muted">
          Versions: {versions.map((v) => `v${v.version_number}`).join(" · ")}
          <button
            className="ml-3 underline"
            type="button"
            onClick={async () => {
              const d = await api(`/automations/${params.id}/diff?from=${versions[1].id}&to=${versions[0].id}`);
              setMsg(`Diff v${d.from} → v${d.to} (graphs loaded)`);
            }}
          >
            Compare latest two
          </button>
        </p>
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const d = await generateCopilotDraft({ prompt, flowId: params.id, mode: "auto_build" });
            if (d.graph) {
              await api(`/automations/${params.id}`, { method: "PUT", body: JSON.stringify({ graph: d.graph }) });
              await persistCopilotSession(d.sessionId, params.id).catch(() => undefined);
              window.location.reload();
            }
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Copilot unavailable");
          }
        }}
      >
        <input
          className="w-full rounded-lg border border-line bg-[#0e1428] px-3 py-2 text-sm"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="rounded-lg bg-accent px-3 py-2 text-sm" type="submit">
          Copilot
        </button>
      </form>
      <WorkflowBuilder
        initial={graph}
        onSave={async (g) => {
          await api(`/automations/${params.id}`, { method: "PUT", body: JSON.stringify({ graph: g }) });
          setMsg("Draft saved");
        }}
        onPublish={async () => {
          const d = await api(`/automations/${params.id}/publish`, { method: "POST" });
          setMsg(`Published. Webhook ${d.webhookUrl}`);
        }}
        onRun={async () => {
          await api(`/automations/${params.id}/run`, { method: "POST", body: JSON.stringify({ payload: { ping: true } }) });
          setMsg("Run queued");
        }}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlowProvider,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node
} from "reactflow";
import "reactflow/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Book, Check, ChevronRight, Clock, Copy, Loader2, Maximize2, Minimize2, Redo2, Search, Sparkles, Undo2, Workflow, Wrench, X, Zap } from "lucide-react";
import { api, streamSse, streamGetSse } from "@/lib/api";
import {
  appAuth,
  fieldKey,
  flattenSample,
  graphNodeType,
  isGoogleApp,
  needsConnection,
  opFields,
  opKey,
  opSample,
  type CatalogApp,
  type CatalogOp
} from "@/lib/catalog";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DataPicker, type DataToken } from "./data-picker";
import { SearchableEventList, SearchableValuePicker } from "./searchable-value-picker";
import { type RunState } from "./step-node";
import { PlusEdge } from "./plus-edge";
import { layoutFlow } from "./layout-flow";
import { useBuilderStore, type StepData } from "./store";
import { normalizeGraph } from "@/lib/normalize-graph";
import { AppPickerModal, type PickerTab } from "./app-picker-modal";
import { canvasNodeTypes } from "./canvas-node-types";
import { CopilotPanel, CopilotReasoning } from "./copilot-panel";
import type { CopilotMode } from "./copilot-types";
import { ConnectAccountModal } from "@/features/connections/connect-account-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopilotSuggestionsCard } from "./copilot-suggestions";
import { appendMapping, configureComplete, setupComplete } from "./step-readiness";

const nodeTypes = canvasNodeTypes;
const edgeTypes = { plus: PlusEdge };

function FitViewOnResize() {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = document.querySelector(".av-editor-flow");
    if (!el) return;
    const run = () => {
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (r.width < 48 || r.height < 48) return;
      if ((el as HTMLElement & { __avFit?: string }).__avFit === key) return;
      (el as HTMLElement & { __avFit?: string }).__avFit = key;
      fitView({ padding: 0.18, duration: 0 });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);
  return null;
}

export type GraphPayload = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

function fromApi(graph: GraphPayload | undefined) {
  const normalized = normalizeGraph(graph);
  const nodes: Node<StepData>[] = normalized.nodes.map((n, i) => ({
    id: n.id || `n${i}`,
    type: "step",
    hidden: false,
    position: n.position,
    data: {
      label: n.label,
      kind: n.type === "trigger" || n.type === "logic" ? n.type : "action",
      appSlug: n.appSlug,
      operation: n.operation,
      config: n.config,
      connectionId: n.connectionId ?? null
    }
  }));
  const edges: Edge[] = normalized.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    type: "plus"
  }));
  return { nodes: layoutFlow(nodes, edges), edges };
}

export function toApi(nodes: Node<StepData>[], edges: Edge[]): GraphPayload {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      appSlug: n.data.appSlug,
      operation: n.data.operation,
      label: n.data.label,
      position: n.position,
      config: n.data.config,
      connectionId: n.data.connectionId ?? null
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null
    }))
  };
}

function publishErrors(nodes: Node<StepData>[], apps: CatalogApp[]) {
  const errors: string[] = [];
  if (!nodes.some((n) => n.data.kind === "trigger" && n.data.operation)) errors.push("Choose a trigger event.");
  if (!nodes.some((n) => n.data.kind !== "trigger" && n.data.operation)) errors.push("Choose at least one action.");
  for (const n of nodes) {
    if (!n.data.operation) continue;
    const app = apps.find((a) => a.slug === n.data.appSlug);
    const op = app?.operations.find((o) => opKey(o) === n.data.operation);
    if (!app || !op) {
      errors.push(`${n.data.label}: unknown app or operation.`);
      continue;
    }
    if (needsConnection(app) && !n.data.connectionId) errors.push(`${n.data.label}: connect an account.`);
    for (const f of opFields(op)) {
      const k = fieldKey(f);
      if (f.required && (n.data.config[k] === undefined || n.data.config[k] === "")) {
        errors.push(`${n.data.label}: ${f.label} is required.`);
      }
    }
  }
  return errors;
}

function Inner(props: { automationId: string; name: string; initialGraph: GraphPayload; webhookPublicId?: string; status?: string }) {
  const { automationId, name, initialGraph, webhookPublicId, status } = props;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const selectedId = useBuilderStore((s) => s.selectedId);
  const dirty = useBuilderStore((s) => s.dirty);
  const hydrate = useBuilderStore((s) => s.hydrate);
  const setSelected = useBuilderStore((s) => s.setSelected);
  const setGraph = useBuilderStore((s) => s.setGraph);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const removeNode = useBuilderStore((s) => s.removeNode);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const markSaved = useBuilderStore((s) => s.markSaved);

  const [msg, setMsg] = useState("");
  const [picker, setPicker] = useState<string | null>(null);
  const [title, setTitle] = useState(name);
  const [busy, setBusy] = useState<"test" | "publish" | "save" | "copilot" | "step" | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [serverPublishErrors, setServerPublishErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; body: unknown; ms?: number } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"setup" | "configure" | "test">("setup");
  const [eventOpen, setEventOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [copilotModal, setCopilotModal] = useState(false);
  const [msgModal, setMsgModal] = useState<{ title: string; body: string } | null>(null);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotBanner, setCopilotBanner] = useState(false);
  const [copilotMode, setCopilotMode] = useState<CopilotMode>("auto_build");
  const [showReasoning, setShowReasoning] = useState(true);
  const [copilotReasoning, setCopilotReasoning] = useState("");
  const [copilotStages, setCopilotStages] = useState<Array<{ label: string; detail?: string; state: "done" | "active" }>>([]);
  const [copilotTodos, setCopilotTodos] = useState<Array<{ kind: string; message: string }>>([]);
  const [pickerTab, setPickerTab] = useState<PickerTab>("home");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const copilotAbort = useRef(false);
  const copilotAbortCtl = useRef<AbortController | null>(null);
  const copilotCheckpoint = useRef<GraphPayload | null>(null);
  const testResultRef = useRef(testResult);
  testResultRef.current = testResult;
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const [appPicker, setAppPicker] = useState<{ kind: "trigger" | "action"; nodeId?: string; edgeId?: string } | null>(null);
  const [testedSteps, setTestedSteps] = useState<Record<string, boolean>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectReplaceId, setConnectReplaceId] = useState<string | null>(null);
  const [inspectorW, setInspectorW] = useState(420);
  const [inspectorModal, setInspectorModal] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [injectPrompt, setInjectPrompt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [flowOverviewOpen, setFlowOverviewOpen] = useState(false);
  const inspectorDrag = useRef<{ startX: number; startW: number } | null>(null);
  const inspectorWRef = useRef(inspectorW);
  inspectorWRef.current = inspectorW;

  useEffect(() => {
    setCopilotStages([]);
    setCopilotTodos([]);
    setCopilotReasoning("");
  }, [automationId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("orchestra-copilot-mode");
      if (saved === "ask_as_you_build" || saved === "auto_build") setCopilotMode(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("orchestra-inspector-width"));
      if (w >= 320 && w <= 720) setInspectorW(w);
      setInspectorModal(localStorage.getItem("orchestra-inspector-modal") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!inspectorDrag.current) return;
      const next = inspectorDrag.current.startW - (e.clientX - inspectorDrag.current.startX);
      setInspectorW(Math.min(720, Math.max(320, next)));
    }
    function up() {
      if (!inspectorDrag.current) return;
      inspectorDrag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("orchestra-inspector-width", String(inspectorWRef.current));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: CatalogApp[] }>("/apps"),
    staleTime: 60 * 60 * 1000
  });
  const connsQ = useQuery({
    queryKey: ["connections"],
    queryFn: () =>
      api<{ connections: Array<{ id: string; name: string; appSlug?: string; app_slug?: string; status: string; zapCount?: number; zap_count?: string }> }>("/connections"),
    staleTime: 30_000
  });
  const autosQ = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations"),
    staleTime: 20_000
  });

  const apps = appsQ.data?.apps ?? [];
  const connections = connsQ.data?.connections ?? [];
  const selected = nodes.find((n) => n.id === selectedId);
  const selectedApp = apps.find((a) => a.slug === selected?.data.appSlug);
  const selectedOp = selectedApp?.operations.find((o) => opKey(o) === selected?.data.operation);
  const errors = [...publishErrors(nodes, apps), ...serverPublishErrors];
  const published = status === "on";
  const setupDone = selected ? setupComplete(selected.data, selectedApp) : false;
  const configureDone = selected ? configureComplete(selected.data, selectedOp) : false;
  const appConnections = connections.filter((c) => {
    const connectionApp = c.appSlug ?? c.app_slug;
    return connectionApp === selected?.data.appSlug || (isGoogleApp(connectionApp ?? "") && isGoogleApp(selected?.data.appSlug ?? ""));
  });

  useEffect(() => {
    const connectionId = searchParams.get("connectionId");
    const nodeId = searchParams.get("nodeId");
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!connectionId || !nodeId || !node || node.data.connectionId === connectionId) return;
    updateNode(nodeId, { connectionId });
    setSelected(nodeId);
    setMsg("Connection selected for this step. Review fields, then test it.");
  }, [searchParams, nodes, updateNode, setSelected]);

  useEffect(() => {
    if (!selectedId) return;
    const node = nodes.find((n) => n.id === selectedId);
    if (!node) return;
    const app = apps.find((a) => a.slug === node.data.appSlug);
    const op = app?.operations.find((o) => opKey(o) === node.data.operation);
    if (!setupComplete(node.data, app)) setInspectorTab("setup");
    else if (!configureComplete(node.data, op)) setInspectorTab("configure");
    else setInspectorTab("test");
    // Only when the selected step changes — do not fight the user's tab clicks.
    // Only when the selected node changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    setSuggestionsOpen(false);
  }, [selectedId]);

  const dynQ = useQuery({
    queryKey: [
      "dynamic-fields",
      selected?.data.appSlug,
      selected?.data.operation,
      selected?.data.connectionId,
      selected?.data.config
    ],
    enabled: Boolean(selected?.data.appSlug && selected?.data.operation && inspectorTab === "configure"),
    queryFn: () =>
      api<{ fields: Array<{ key: string; label: string; type: string; options?: { label: string; value: string }[] }> }>(
        `/apps/${selected!.data.appSlug}/operations/${encodeURIComponent(selected!.data.operation)}/dynamic-fields`,
        {
          method: "POST",
          body: JSON.stringify({ connectionId: selected!.data.connectionId, input: selected!.data.config })
        }
      )
  });

  const commit = useCallback(
    (nextNodes: Node<StepData>[], nextEdges: Edge[], push = true) => {
      setGraph(layoutFlow(nextNodes, nextEdges), nextEdges, push);
    },
    [setGraph]
  );

  useEffect(() => {
    const g = fromApi(initialGraph);
    hydrate(g.nodes, g.edges);
    setTitle(name);
  }, [automationId, hydrate, initialGraph, name]);

  async function saveDraft() {
    await api(`/automations/${automationId}`, {
      method: "PUT",
      body: JSON.stringify({ name: title, graph: toApi(nodes, edges) })
    });
    markSaved();
    setMsg("Saved");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveDraft().catch((err) => setMsg(err instanceof Error ? err.message : "Save failed"));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!useBuilderStore.getState().dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      void saveDraft().catch((err) => setMsg(err instanceof Error ? err.message : "Save failed"));
    }, 900);
    return () => clearTimeout(t);
  }, [automationId, dirty, edges, nodes, title]);

  const onConnect = useCallback(
    (c: Connection) => commit(nodes, addEdge({ ...c, type: "plus" }, edges)),
    [commit, edges, nodes]
  );

  const tokens: DataToken[] = useMemo(() => {
    const out: DataToken[] = [];
    for (const n of nodes) {
      if (selected && n.id === selected.id) break;
      const app = apps.find((a) => a.slug === n.data.appSlug);
      const op = app?.operations.find((o) => opKey(o) === n.data.operation);
      const sample = op ? opSample(op) : {};
      const prefix = n.data.kind === "trigger" ? "trigger" : `steps.${n.id}`;
      const group = n.data.kind === "trigger" ? "Trigger" : n.data.label;
      const keys = flattenSample(sample);
      if (!keys.length) out.push({ token: `{{${prefix}}}`, label: prefix, group, preview: "Full output" });
      for (const k of keys) {
        const preview = k.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], sample);
        out.push({
          token: `{{${prefix}.${k}}}`,
          label: k,
          group,
          preview: preview === undefined ? undefined : typeof preview === "object" ? JSON.stringify(preview) : String(preview)
        });
      }
    }
    return out;
  }, [apps, nodes, selected]);

  function openPicker(kind: "trigger" | "action", nodeId?: string, edgeId?: string, tab: PickerTab = "home") {
    setPickerTab(tab);
    setAppPicker({ kind, nodeId, edgeId });
  }

  function insertOnEdge(edgeId: string, data: StepData) {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const id = `${data.appSlug || "step"}-${Date.now()}`;
    const node: Node<StepData> = { id, type: "step", position: { x: 0, y: 0 }, data };
    const nextNodes = [...nodes, node];
    const nextEdges = edges
      .filter((e) => e.id !== edgeId)
      .concat([
        { id: `e-${edge.source}-${id}`, source: edge.source, target: id, sourceHandle: edge.sourceHandle, type: "plus" },
        { id: `e-${id}-${edge.target}`, source: id, target: edge.target, type: "plus" }
      ]);
    commit(nextNodes, nextEdges);
    setSelected(id);
  }

  function expandPaths(afterId?: string) {
    const pid = `paths-${Date.now()}`;
    const a = `path-a-${Date.now()}`;
    const b = `path-b-${Date.now()}`;
    const pathData: StepData = {
      label: "Paths (router)",
      kind: "logic",
      appSlug: "paths",
      operation: "router",
      config: {
        paths: [
          { id: "path-a", label: "Path A", left: "", operator: "not_empty", right: "", fallback: false },
          { id: "path-b", label: "Path B", fallback: true }
        ]
      },
      connectionId: null
    };
    const empty = (id: string, label: string): Node<StepData> => ({
      id,
      type: "step",
      position: { x: 0, y: 0 },
      data: { label, kind: "action", appSlug: "", operation: "", config: {}, connectionId: null }
    });
    const pathNode: Node<StepData> = { id: pid, type: "step", position: { x: 0, y: 0 }, data: pathData };
    let nextNodes = [...nodes.filter((n) => !(afterId && n.id !== afterId && !n.data.operation && n.data.kind !== "trigger")), pathNode, empty(a, "Action"), empty(b, "Action")];
    if (afterId) {
      const outgoing = edges.filter((e) => e.source === afterId);
      const rest = edges.filter((e) => e.source !== afterId);
      nextNodes = [...nodes.filter((n) => n.id !== afterId || true), pathNode, empty(a, "Action"), empty(b, "Action")];
      const unique = new Map(nextNodes.map((n) => [n.id, n]));
      unique.set(pid, pathNode);
      unique.set(a, empty(a, "Action"));
      unique.set(b, empty(b, "Action"));
      nextNodes = [...unique.values()];
      const nextEdges: Edge[] = [
        ...rest.filter((e) => e.target !== afterId || e.source !== afterId),
        { id: `e-${afterId}-${pid}`, source: afterId, target: pid, type: "plus" },
        { id: `e-${pid}-${a}`, source: pid, target: a, sourceHandle: "path-a", type: "plus" },
        { id: `e-${pid}-${b}`, source: pid, target: b, sourceHandle: "path-b", type: "plus" },
        ...outgoing.map((e) => ({ ...e, source: a, sourceHandle: undefined, id: `e-${a}-${e.target}` }))
      ];
      commit(nextNodes, nextEdges);
      setSelected(pid);
      return;
    }
    const last = nodes[nodes.length - 1];
    const nextEdges: Edge[] = [
      ...edges,
      ...(last ? [{ id: `e-${last.id}-${pid}`, source: last.id, target: pid, type: "plus" } as Edge] : []),
      { id: `e-${pid}-${a}`, source: pid, target: a, sourceHandle: "path-a", type: "plus" },
      { id: `e-${pid}-${b}`, source: pid, target: b, sourceHandle: "path-b", type: "plus" }
    ];
    commit([...nodes, pathNode, empty(a, "Action"), empty(b, "Action")], nextEdges);
    setSelected(pid);
  }

  function addOp(app: CatalogApp, op: CatalogOp) {
    if (app.slug === "paths") {
      expandPaths(appPicker?.nodeId);
      setAppPicker(null);
      return;
    }
    const kind = graphNodeType(op, app.slug);
    const data: StepData = {
      label: op.name,
      kind,
      appSlug: app.slug,
      operation: opKey(op),
      config: {},
      connectionId:
        connections.find(
          (c) =>
            c.status === "connected" &&
            ((c.appSlug ?? c.app_slug) === app.slug || (isGoogleApp(c.appSlug ?? c.app_slug ?? "") && isGoogleApp(app.slug)))
        )?.id ?? null
    };
    if (appPicker?.edgeId) {
      insertOnEdge(appPicker.edgeId, data);
      setTestResult(null);
      setAppPicker(null);
      return;
    }
    const targetId =
      appPicker?.nodeId ??
      nodes.find((n) =>
        kind === "trigger"
          ? n.data.kind === "trigger" && !n.data.operation
          : n.data.kind !== "trigger" && !n.data.operation
      )?.id;
    if (targetId) {
      updateNode(targetId, data);
      setSelected(targetId);
      setTestResult(null);
      setAppPicker(null);
      return;
    }
    if (kind === "trigger") {
      const existing = nodes.find((n) => n.data.kind === "trigger");
      if (existing) {
        updateNode(existing.id, data);
        setSelected(existing.id);
        setAppPicker(null);
        return;
      }
    }
    const id = `${app.slug}-${opKey(op)}-${Date.now()}`;
    const node: Node<StepData> = { id, type: "step", position: { x: 0, y: 0 }, data };
    const last = nodes[nodes.length - 1];
    const nextEdges = last
      ? [...edges, { id: `e-${last.id}-${id}`, source: last.id, target: id, type: "plus" } as Edge]
      : edges;
    commit([...nodes, node], nextEdges);
    setSelected(id);
    setTestResult(null);
    setAppPicker(null);
  }

  function addPathBranch(pathsId: string) {
    const node = nodes.find((n) => n.id === pathsId);
    if (!node) return;
    const existing = (node.data.config.paths as Array<{ id: string; label: string }> | undefined) ?? [
      { id: "path-a", label: "Path A" },
      { id: "path-b", label: "Path B" }
    ];
    const id = `path-${String.fromCharCode(97 + existing.length)}`;
    const stepId = `${id}-${Date.now()}`;
    const paths = [...existing, { id, label: `Path ${String.fromCharCode(65 + existing.length)}`, fallback: false }];
    updateNode(pathsId, { config: { ...node.data.config, paths } });
    const action: Node<StepData> = {
      id: stepId,
      type: "step",
      position: { x: 0, y: 0 },
      data: { label: "Action", kind: "action", appSlug: "", operation: "", config: {}, connectionId: null }
    };
    commit([...nodes, action], [
      ...edges,
      { id: `e-${pathsId}-${stepId}`, source: pathsId, target: stepId, sourceHandle: id, type: "plus" }
    ]);
  }

  function selectedAppForNode(slug: string) {
    return apps.find((app) => app.slug === slug);
  }

  const displayNodes = useMemo(
    () =>
      layoutFlow(nodes, edges).map((n, i) => ({
        ...n,
        type: "step",
        hidden: false,
        data: {
          ...n.data,
          index: i + 1,
          empty: !n.data.operation,
          runState: runStates[n.id] ?? "idle",
          needsAccount: Boolean(n.data.kind === "action" && selectedAppForNode(n.data.appSlug) && needsConnection(selectedAppForNode(n.data.appSlug)!) && !n.data.connectionId),
          terminal: n.data.kind === "action" && !edges.some((e) => e.source === n.id),
          pathLabel: edges.find((e) => e.target === n.id && e.sourceHandle)?.sourceHandle?.replace("path-", "Path "),
          onMenu: (anchor: HTMLElement) => {
            const rect = anchor.getBoundingClientRect();
            setSelected(n.id);
            setCtxMenu({ x: Math.max(8, rect.right - 180), y: rect.bottom + 4, nodeId: n.id });
          },
          onAddAccount: () => {
            setSelected(n.id);
            setInspectorTab("setup");
            setConnectReplaceId(null);
            setConnectOpen(true);
          },
          onAddStep: () => openPicker("action", undefined, undefined)
        }
      })),
    [edges, nodes, runStates, setSelected]
  );

  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: "plus",
        animated: runStates[e.source] === "ok" || runStates[e.source] === "running",
        data: {
          onAdd: (edgeId: string) => openPicker("action", undefined, edgeId),
          label: e.sourceHandle ? String(e.sourceHandle).replace("path-", "Path ").toUpperCase() : undefined,
          active: runStates[e.source] === "ok" || runStates[e.source] === "running",
          pulse: runStates[e.source] === "running"
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#64748b" }
      })),
    [edges, runStates]
  );

  async function testStep(node = selected) {
    if (!node) return;
    setBusy("step");
    const started = Date.now();
    try {
      await saveDraft();
      const d = await api(`/automations/${automationId}/test-step`, {
        method: "POST",
        body: JSON.stringify({ nodeId: node.id, graph: toApi(nodes, edges) })
      });
      setTestResult({ ok: true, body: d, ms: Date.now() - started });
      setInspectorTab("test");
      setTestedSteps((prev) => ({ ...prev, [node.id]: true }));
      const nextId = edges.find((e) => e.source === node.id)?.target;
      if (nextId) {
        setMsg("Step tested. Continue along App → Account → Map → Test → Publish.");
        setSelected(nextId);
        setInspectorTab("setup");
      }
    } catch (err) {
      setTestResult({ ok: false, body: { error: err instanceof Error ? err.message : "Test failed" }, ms: Date.now() - started });
      setInspectorTab("test");
    } finally {
      setBusy(null);
    }
  }

  async function testWorkflow() {
    setBusy("test");
    const ordered = layoutFlow(nodes, edges);
    /* Reset all nodes to idle first, then animate step by step */
    setRunStates({});
    try {
      await saveDraft();
      const trigger = nodes.find((n) => n.data.kind === "trigger");
      const app = apps.find((x) => x.slug === trigger?.data.appSlug);
      const op = app?.operations.find((o) => opKey(o) === trigger?.data.operation);
      const payload = op ? opSample(op) : { ping: true, test: true };

      /* Step-by-step entrance animation: each node goes running sequentially */
      for (let idx = 0; idx < ordered.length; idx++) {
        await new Promise((r) => setTimeout(r, idx === 0 ? 100 : 400));
        setRunStates((prev) => {
          const next = { ...prev };
          /* Mark previous as ok if still in running */
          if (idx > 0) {
            const prevId = ordered[idx - 1].id;
            if (next[prevId] === "running") next[prevId] = "ok";
          }
          next[ordered[idx].id] = "running";
          return next;
        });
        /* Follow the active step in the inspector */
        setSelected(ordered[idx].id);
        setInspectorTab("test");
      }
      /* Mark the last one as ok after the final entrance */
      await new Promise((r) => setTimeout(r, 400));
      setRunStates((prev) => {
        const next = { ...prev };
        const lastId = ordered[ordered.length - 1].id;
        if (next[lastId] === "running") next[lastId] = "ok";
        return next;
      });

      /* Now fire the actual run */
      const d = await api<{ execution: { id: string } }>(`/automations/${automationId}/run`, {
        method: "POST",
        body: JSON.stringify({ payload })
      });
      const execId = d.execution.id;
      const lastRef: { current: { execution: { status: string }; steps: Array<{ step_id: string; status: string }> } | null } = { current: null };
      
      /* SSE-based real-time step streaming */
      await new Promise<void>((resolve) => {
        const controller = new AbortController();
        streamGetSse(`/executions/${execId}/stream`, (event, data) => {
          if (event === "snapshot" || event === "done") {
            const snap = data as { execution: { status: string }; steps: Array<{ step_id: string; status: string }> };
            lastRef.current = snap;
            const byId: Record<string, RunState> = {};
            for (const s of snap.steps) {
              byId[s.step_id] =
                s.status === "succeeded" || s.status === "success" || s.status === "completed"
                  ? "ok"
                  : s.status === "failed" || s.status === "cancelled"
                    ? "fail"
                    : s.status === "waiting" || s.status === "pending_approval"
                      ? "waiting"
                      : s.status === "queued"
                        ? "queued"
                        : "running";
            }
            const painted: Record<string, RunState> = Object.fromEntries(ordered.map((n) => [n.id, "idle" as RunState]));
            for (const n of ordered) {
              if (byId[n.id]) painted[n.id] = byId[n.id];
            }
            if (snap.execution.status === "waiting") {
              const lastExecuted = [...snap.steps].reverse().find((step) => byId[step.step_id] === "ok" || byId[step.step_id] === "waiting");
              if (lastExecuted) {
                for (const edge of edges) {
                  if (edge.source === lastExecuted.step_id && !byId[edge.target]) painted[edge.target] = "waiting";
                }
              }
            }
            setRunStates(painted);
            const runningStep = ordered.find((n) => painted[n.id] === "running");
            const failedStep = ordered.find((n) => painted[n.id] === "fail");
            const activeStep = failedStep || runningStep || ordered.find((n) => painted[n.id] === "waiting");
            if (activeStep) {
              setSelected(activeStep.id);
              setInspectorTab("test");
            }
          } else if (event === "step") {
            /* Individual step update — animate immediately */
            const stepData = data as { stepId: string; status: string };
            const state: RunState =
              stepData.status === "succeeded" ? "ok" :
              stepData.status === "failed" ? "fail" : "running";
            setRunStates((prev) => ({ ...prev, [stepData.stepId]: state }));
            setSelected(stepData.stepId);
            setInspectorTab("test");
          }
          if (event === "done") { resolve(); controller.abort(); }
        }, controller.signal).catch(() => resolve());
        /* Safety timeout: resolve after 30s regardless */
        setTimeout(() => { controller.abort(); resolve(); }, 30000);
      });
      const ok = lastRef.current?.execution.status === "succeeded";
      setTestResult({ ok: Boolean(ok), body: lastRef.current });
      /* After test completes, select the failed node if any, otherwise the last node */
      const finalFailed = ordered.find((n) => runStates[n.id] === "fail");
      const finalNode = finalFailed || ordered[ordered.length - 1];
      if (finalNode) {
        setSelected(finalNode.id);
        setInspectorTab("test");
      }
      const runStatus = lastRef.current?.execution.status ?? "timed out";
      setMsg(ok ? "Test workflow completed." : runStatus === "waiting" ? "Test workflow is waiting to resume." : `Test workflow ${runStatus}.`);
    } catch (err) {
      setTestResult({ ok: false, body: { error: err instanceof Error ? err.message : "Run failed" } });
      setMsg(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (errors.length) {
      setPublishOpen(true);
      return;
    }
    setBusy("publish");
    try {
      await saveDraft();
      const d = await api<{ webhookUrl?: string }>(`/automations/${automationId}/publish`, { method: "POST" });
      setMsg(d.webhookUrl ? `Published. Catch URL ${d.webhookUrl}` : "Workflow published and on.");
      setPublishOpen(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  }

  async function openPublishCheck() {
    setBusy("publish");
    try {
      await saveDraft();
      const result = await api<{ ok: boolean; issues: Array<{ message: string }> }>(`/automations/${automationId}/validate`, {
        method: "POST",
        body: JSON.stringify({ graph: toApi(nodes, edges) })
      });
      setServerPublishErrors(result.issues.map((issue) => issue.message));
      setPublishOpen(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not validate workflow");
    } finally {
      setBusy(null);
    }
  }

  async function runCopilot(prompt?: string) {
    copilotAbort.current = false;
    copilotAbortCtl.current?.abort();
    const ac = new AbortController();
    copilotAbortCtl.current = ac;
    setBusy("copilot");
    setCopilotOpen(true);
    setCopilotStages([{ label: "Understanding your request", state: "active" }]);
    setCopilotTodos([]);
    setCopilotReasoning("");
    const copilotOut: {
      graph?: GraphPayload;
      summary?: string;
      sessionId?: string;
      applied?: boolean;
      mode?: CopilotMode;
      rebuilt?: boolean;
      changed?: boolean;
    } = {};
    try {
      await streamSse(
        "/ai/copilot/generate",
        { prompt: prompt || copilotPrompt || `Build: ${title}`, automationId, mode: copilotMode, graph: toApi(nodes, edges), selectedStepId: selectedId },
        (ev) => {
          if (ev.type === "stage") {
            setCopilotStages((current) => [
              ...current.map((item) => ({ ...item, state: "done" as const })),
              { label: String(ev.label ?? ev.stage ?? "Working"), state: "active" }
            ]);
          }
          if (ev.type === "reasoning" && ev.text) {
            setCopilotReasoning(String(ev.text));
            setShowReasoning(true);
          }
          if (ev.type === "todo" && ev.message) {
            setCopilotTodos((current) => [...current, { kind: String(ev.kind ?? "confirm"), message: String(ev.message) }]);
          }
          if (ev.type === "result") {
            copilotOut.graph = ev.graph as GraphPayload | undefined;
            copilotOut.summary = ev.summary as string | undefined;
            copilotOut.sessionId = ev.sessionId as string | undefined;
            copilotOut.applied = Boolean(ev.applied);
            copilotOut.mode = ev.mode as CopilotMode | undefined;
            copilotOut.rebuilt = Boolean(ev.rebuilt);
            copilotOut.changed = Boolean(ev.changed);
          }
        },
        ac.signal
      );
      if (copilotAbort.current) return;
      setCopilotStages((current) => current.map((item) => ({ ...item, state: "done" as const })));
      if (copilotOut.graph && copilotOut.applied && (copilotOut.rebuilt || copilotOut.changed)) {
        const g = fromApi(copilotOut.graph);
        hydrate(g.nodes, g.edges);
        setGraph(g.nodes, g.edges);
        const blank = g.nodes.find((node) => !node.data.appSlug || !node.data.operation);
        if (blank) {
          setSelected(blank.id);
          setInspectorTab("setup");
        }
        setMsg(copilotOut.summary ?? "Copilot wrote this draft. Test, then publish yourself.");
      } else if (copilotOut.graph && !copilotOut.applied && (copilotOut.rebuilt || copilotOut.changed)) {
        setMsg("Copilot proposed a draft. Apply it from the side panel — publish stays yours.");
      } else if (copilotOut.summary) {
        setMsg(copilotOut.summary);
      }
      return Object.keys(copilotOut).length ? copilotOut : undefined;
    } catch (err) {
      if (ac.signal.aborted || copilotAbort.current) return;
      if (copilotAbort.current) return;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("AI_SERVICE_DOWN") || msg.includes("ECONNREFUSED")) {
        setMsg("Copilot could not reach the AI service. The Node catalog engine was used as fallback \u2014 check that apps/ai is running on port 8000.");
      } else if (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("STREAM_TIMEOUT")) {
        setMsg("Copilot timed out. The AI service may be overloaded \u2014 try a simpler prompt.");
      } else {
        setMsg(msg || "Copilot could not complete that request. Try rephrasing your prompt.");
      }
    } finally {
      setBusy(null);
    }
    return undefined;
  }

  const continueLabel = !selected?.data.operation
    ? "To continue, choose an event"
    : selectedApp && needsConnection(selectedApp) && !selected.data.connectionId
      ? "To continue, connect an account"
      : "Continue";
  const firstHumanAction = (() => {
    for (const [i, node] of nodes.entries()) {
      const app = apps.find((a) => a.slug === node.data.appSlug);
      if (!node.data.appSlug || !node.data.operation) {
        return `Choose an app and event on step ${i + 1}.`;
      }
      if (app && needsConnection(app) && !node.data.connectionId) {
        return `Connect ${app.name} on step ${i + 1}. Copilot cannot create that account.`;
      }
      const op = app?.operations.find((o) => opKey(o) === node.data.operation);
      const missing = (op ? opFields(op) : []).filter((f) => f.required && !String(node.data.config[fieldKey(f)] ?? "").trim());
      const picks = missing.filter((f) => /spreadsheet|worksheet|drive|calendar|channel|event/i.test(f.label));
      if (picks.length) return `Pick ${picks.map((f) => f.label).join(", ")} in Configure on step ${i + 1}.`;
    }
    if (nodes.length) return "Test this step, then Publish yourself. Copilot cannot publish.";
    return undefined;
  })();

  const stepSuggestions = useMemo(() => {
    const youDoFirst: string[] = [];
    const iCan: string[] = [];
    if (!selected) return { youDoFirst, iCan };
    const idx = nodes.findIndex((n) => n.id === selected.id) + 1;
    const label = `${idx}. ${selected.data.label || "this step"}`;
    if (!selected.data.operation) youDoFirst.push(`Choose an event for ${label}.`);
    else if (selectedApp && needsConnection(selectedApp) && !selected.data.connectionId) {
      youDoFirst.push(`Connect ${selectedApp.name} on ${label}. I cannot create that account.`);
    } else if (!configureDone) {
      const missing = (selectedOp ? opFields(selectedOp) : []).filter(
        (f) => f.required && !String(selected.data.config[fieldKey(f)] ?? "").trim()
      );
      const picks = missing.filter((f) => /spreadsheet|worksheet|drive|calendar|channel|event/i.test(f.label));
      if (picks.length) youDoFirst.push(`Choose ${picks.map((f) => f.label).join(", ")} yourself — I will not invent those IDs.`);
      else if (missing.length) iCan.push(`Map empty fields on ${label} from previous steps.`);
    } else {
      youDoFirst.push(`Test ${label}, then Publish yourself.`);
    }
    if (!youDoFirst.some((t) => /connect/i.test(t))) {
      iCan.push("Fill empty text fields without changing the app or account.");
      iCan.push("Add the next action when you say which app (Slack, Sheets, OpenAI…).");
    }
    return { youDoFirst, iCan };
  }, [selected, selectedApp, selectedOp, configureDone, nodes]);

  function askCopilot(prompt: string) {
    setCopilotOpen(true);
    setInjectPrompt(prompt);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-elevated px-3 shadow-sm">
        <Link href="/automations" className="text-xs text-ink-muted hover:text-ink">
          Workflows
        </Link>
        <Input
          className="max-w-xs border-transparent bg-transparent px-1 text-[15px] font-semibold shadow-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg p-1 text-ink-muted hover:bg-muted hover:text-ink transition-colors"
          title="Workflow overview"
          onClick={() => setFlowOverviewOpen(true)}
        >
          <Workflow className="h-4 w-4" />
        </button>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          {published ? "On" : "Draft"}
        </span>
        {msg && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-100 transition-colors cursor-pointer"
            title="View message"
            onClick={() => setMsgModal({ title: "Notification", body: msg })}
          >
            <span className="truncate max-w-[220px]">{msg}</span>
            <span className="shrink-0 rounded-full bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold">View</span>
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => undo()} aria-label="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => redo()} aria-label="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void testWorkflow()} disabled={busy === "test"}>
            {busy === "test" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…
              </>
            ) : (
              "Test workflow"
            )}
          </Button>
          <Button size="sm" onClick={() => void openPublishCheck()} disabled={busy === "publish"}>
            {busy === "publish" ? "Checking…" : "Publish"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <CopilotPanel
          automationId={automationId}
          open={copilotOpen}
          modal={copilotModal}
          onOpenModal={() => setCopilotModal(true)}
          building={busy === "copilot"}
          draftConfigured={nodes.some((n) => Boolean(n.data.appSlug && n.data.operation))}
          draftOutline={nodes
            .filter((n) => n.data.appSlug && n.data.operation)
            .map((n, i) => `${i + 1}. ${n.data.label || n.data.operation}`)
            .join(" → ")}
          firstHumanAction={firstHumanAction}
          mode={copilotMode}
          onModeChange={(next) => {
            setCopilotMode(next);
            try {
              localStorage.setItem("orchestra-copilot-mode", next);
            } catch {
              /* ignore */
            }
          }}
          reasoning={copilotReasoning}
          showReasoning={showReasoning}
          onToggleReasoning={() => setShowReasoning((v) => !v)}
          stages={copilotStages}
          todos={copilotTodos}
          onClose={() => setCopilotOpen(false)}
          onExpand={() => setCopilotOpen(true)}
          onCheckpoint={() => {
            copilotCheckpoint.current = toApi(nodes, edges);
            setMsg("Copilot checkpoint saved. Revert restores this draft.");
          }}
          onBuild={async (prompt) => {
            setCopilotPrompt(prompt);
            return runCopilot(prompt);
          }}
          onStop={() => {
            copilotAbort.current = true;
            copilotAbortCtl.current?.abort();
            setBusy(null);
          }}
          onApply={async (graph, sessionId) => {
            copilotCheckpoint.current = toApi(nodes, edges);
            if (sessionId) {
              try {
                const result = await api<{
                  ok: boolean;
                  graph?: GraphPayload;
                  applied?: Array<{ kind: string; arguments: Record<string, unknown> }>;
                  rejected?: Array<{ operation: unknown; reason: string }>;
                }>(`/copilot/sessions/${sessionId}/approve`, {
                  method: "POST",
                  body: JSON.stringify({ flowId: automationId }),
                });
                if (result.ok && result.graph) {
                  const g = fromApi(result.graph);
                  hydrate(g.nodes, g.edges);
                  setGraph(g.nodes, g.edges);
                  setMsg("Copilot changes validated and applied to the draft. Test before publishing.");
                  return;
                }
              } catch {
                // Fall through to local apply if server approval fails
              }
            }
            // Fallback: local apply (for backward compatibility with non-session flows)
            const g = fromApi(graph as GraphPayload);
            hydrate(g.nodes, g.edges);
            setGraph(g.nodes, g.edges);
            setMsg("Copilot change applied to the draft. Test before publishing.");
          }}
          onRevert={() => {
            if (!copilotCheckpoint.current) return;
            const g = fromApi(copilotCheckpoint.current);
            hydrate(g.nodes, g.edges);
            setGraph(g.nodes, g.edges);
            copilotCheckpoint.current = null;
            setMsg("Copilot change reverted.");
          }}
          incomingPrompt={injectPrompt}
          onIncomingPromptHandled={() => setInjectPrompt(null)}
          onChat={async (prompt) => {
            let d;
            try {
              d = await api<{
                reply: string;
                graph?: GraphPayload;
                sessionId?: string;
                applied?: boolean;
                summary?: string;
                youDoFirst?: string[];
                iCan?: string[];
                events?: Array<{ type: string; stage?: string; label?: string; text?: string; kind?: string; message?: string }>;
              }>("/ai/copilot/chat", {
                method: "POST",
                body: JSON.stringify({
                  prompt,
                  graph: toApi(nodes, edges),
                  plan: "free",
                  automationId,
                  mode: copilotMode,
                  selectedStepId: selectedId,
                  lastTest: testResultRef.current
                })
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : "";
              if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
                throw new Error("Copilot took too long to respond. The AI service may be overloaded \u2014 try a shorter instruction.");
              }
              if (msg.includes("ECONNREFUSED") || msg.includes("fetch")) {
                throw new Error("Cannot reach the Copilot service. Make sure the API and AI services are running.");
              }
              throw new Error(`Copilot could not process that request: ${msg || "unknown error"}. Try rephrasing or starting a new session.`);
            }
            if (!d) throw new Error("Copilot returned no response.");
            const stageEvents = (d.events ?? []).filter((e) => e.type === "stage");
            if (stageEvents.length) {
              setCopilotStages(stageEvents.map((e) => ({ label: e.label ?? e.stage ?? "stage", state: "done" as const })));
            }
            const reasoning = (d.events ?? []).find((e) => e.type === "reasoning")?.text;
            if (reasoning) setCopilotReasoning(reasoning);
            if (d.events?.some((e) => e.type === "todo")) {
              setCopilotTodos(
                (d.events ?? []).filter((e) => e.type === "todo" && e.message).map((e) => ({ kind: e.kind ?? "confirm", message: e.message! }))
              );
            }
            if (d.graph && d.applied) {
              copilotCheckpoint.current = toApi(nodes, edges);
              const g = fromApi(d.graph);
              hydrate(g.nodes, g.edges);
              setGraph(g.nodes, g.edges);
              setMsg(d.summary ?? "Copilot updated the draft. Test, then publish yourself.");
            }
            return d;
          }}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          {copilotBanner && !copilotOpen && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 w-[min(100%-2rem,560px)] -translate-x-1/2">
              <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-elevated/95 px-3 py-2 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-pink-500 to-red-500 text-white">
                  <Sparkles className="h-4 w-4" />
                </span>
                <p className="flex-1 text-sm">Copilot can fully configure your workflow</p>
                <Button
                  size="sm"
                  className="bg-violet-600 text-white hover:bg-violet-700"
                  onClick={() => {
                    setCopilotOpen(true);
                    void runCopilot();
                  }}
                >
                  Build it
                </Button>
                <button type="button" className="text-ink-muted" onClick={() => setCopilotBanner(false)} aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          <CopilotReasoning
            show={busy === "copilot"}
            text={showReasoning ? copilotReasoning : undefined}
            onStop={() => {
              copilotAbort.current = true;
              copilotAbortCtl.current?.abort();
              setBusy(null);
            }}
          />
          <div className="absolute inset-0 min-h-[560px]">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setCtxMenu(null);
              setSelected(n.id);
              setInspectorTab("setup");
              if (!n.data.operation) openPicker(n.data.kind === "trigger" ? "trigger" : "action", n.id);
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              setSelected(n.id);
              setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: n.id });
            }}
            onPaneClick={() => {
              setSelected(null);
              setCtxMenu(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const raw = e.dataTransfer.getData("application/atuomate-op");
              if (!raw) return;
              try {
                const parsed = JSON.parse(raw) as { slug: string; operation: string };
                const app = apps.find((a) => a.slug === parsed.slug);
                const op = app?.operations.find((o) => opKey(o) === parsed.operation);
                if (app && op) addOp(app, op);
              } catch {
                /* ignore */
              }
            }}
            nodesDraggable
            fitView
            defaultViewport={{ x: 40, y: 24, zoom: 0.85 }}
            minZoom={0.2}
            defaultEdgeOptions={{ type: "plus" }}
            proOptions={{ hideAttribution: true }}
            className="av-editor-flow h-full w-full"
            style={{ width: "100%", height: "100%" }}
          >
            <FitViewOnResize />
            <Background gap={22} size={1.4} color="rgb(203 213 225)" variant={BackgroundVariant.Dots} />
          </ReactFlow>
          </div>
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-full border border-line bg-elevated px-2 py-1 shadow-sm">
            <button className="rounded-full p-1.5 text-ink-muted hover:bg-muted" title="Library" type="button" onClick={() => openPicker("action")}>
              <Book className="h-4 w-4" />
            </button>
            <button className="rounded-full p-1.5 text-ink-muted hover:bg-muted" title="Apps" type="button" onClick={() => openPicker("action", undefined, undefined, "apps")}>
              <Zap className="h-4 w-4" />
            </button>
            <button className="rounded-full p-1.5 text-ink-muted hover:bg-muted" title="Utilities" type="button" onClick={() => openPicker("action", undefined, undefined, "utilities")}>
              <Wrench className="h-4 w-4" />
            </button>
            <button className="rounded-full p-1.5 text-ink-muted hover:bg-muted" title="AI" type="button" onClick={() => openPicker("action", undefined, undefined, "ai")}>
              <Sparkles className="h-4 w-4" />
            </button>
            <button className="rounded-full p-1.5 text-ink-muted hover:bg-muted" title="Search" type="button" onClick={() => openPicker("action")}>
              <Search className="h-4 w-4" />
            </button>
          </div>
          {ctxMenu && (
            <div
              className="fixed z-50 min-w-[180px] rounded-xl border border-line bg-elevated py-1 shadow-card"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setSelected(ctxMenu.nodeId);
                  setInspectorTab("setup");
                  setCtxMenu(null);
                }}
              >
                Setup
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setSelected(ctxMenu.nodeId);
                  setInspectorTab("configure");
                  setCtxMenu(null);
                }}
              >
                Map
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  const node = nodes.find((candidate) => candidate.id === ctxMenu.nodeId);
                  setSelected(ctxMenu.nodeId);
                  setInspectorTab("test");
                  setCtxMenu(null);
                  void testStep(node);
                }}
              >
                Test this step
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  const n = nodes.find((x) => x.id === ctxMenu.nodeId);
                  openPicker(n?.data.kind === "trigger" ? "trigger" : "action", ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
              >
                Change app / event
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-muted"
                onClick={() => {
                  const n = nodes.find((x) => x.id === ctxMenu.nodeId);
                  setConfirmDelete({
                    id: ctxMenu.nodeId,
                    label: n ? `${nodes.findIndex((x) => x.id === n.id) + 1}. ${n.data.label || n.data.operation || "step"}` : "this step"
                  });
                  setCtxMenu(null);
                }}
              >
                Delete step
              </button>
            </div>
          )}
        </div>
        {inspectorModal ? <div className="fixed inset-0 z-40 bg-ink/50" onClick={() => setInspectorModal(false)} /> : null}
        <aside
          className={cn(
            "flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-line bg-elevated",
            inspectorModal
              ? "fixed inset-y-4 left-1/2 z-50 w-[min(640px,96vw)] max-w-[96vw] -translate-x-1/2 rounded-2xl border shadow-card"
              : "relative border-l shadow-[-8px_0_24px_rgba(15,23,42,0.04)]"
          )}
          style={inspectorModal ? undefined : { width: inspectorW }}
        >
          {!inspectorModal ? (
            <button
              type="button"
              aria-label="Resize setup"
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-violet-400"
              onMouseDown={(e) => {
                e.preventDefault();
                inspectorDrag.current = { startX: e.clientX, startW: inspectorW };
                document.body.style.cursor = "ew-resize";
                document.body.style.userSelect = "none";
              }}
            />
          ) : null}
          {!selected && (
            <div className="p-5 text-sm text-ink-muted">
              Select a step. Setup is app and account, Map is fields, Test is sample data, Publish is only in the header.
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-center gap-2 border-b border-line bg-muted/20 px-4 py-3">
                <AppIcon slug={selected.data.appSlug || "manual"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{selected.data.operation ? `${nodes.findIndex((n) => n.id === selected.id) + 1}. ${selected.data.label}` : `${selected.data.kind === "trigger" ? "1. Select the event that starts your Zap" : `${nodes.findIndex((n) => n.id === selected.id) + 1}. Select the event`}`}</div>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-ink-muted hover:bg-muted"
                  title={inspectorModal ? "Dock setup" : "Open setup as overlay"}
                  onClick={() => {
                    const next = !inspectorModal;
                    setInspectorModal(next);
                    try {
                      localStorage.setItem("orchestra-inspector-modal", next ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {inspectorModal ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className={cn("rounded-lg p-1.5 hover:bg-muted", suggestionsOpen ? "bg-muted text-violet-600" : "text-violet-600")}
                  title={suggestionsOpen ? "Hide Copilot suggestions" : "Show Copilot suggestions"}
                  onClick={() => setSuggestionsOpen((v) => !v)}
                >
                  <Sparkles className="h-4 w-4" />
                </button>
                {selected.data.appSlug === "paths" && (
                  <button type="button" className="text-xs text-blue-600" onClick={() => addPathBranch(selected.id)}>
                    + Path
                  </button>
                )}
              </div>
              <div className="flex border-b border-line bg-muted/20">
                {(["setup", "configure", "test"] as const).map((tab) => {
                  const icon =
                    tab === "setup" ? (
                      setupDone ? <Check className="h-3.5 w-3.5 text-ok" /> : <AlertTriangle className="h-3.5 w-3.5 text-warn" />
                    ) : tab === "configure" ? (
                      !setupDone ? (
                        <Clock className="h-3.5 w-3.5 text-ink-muted" />
                      ) : configureDone ? (
                        <Check className="h-3.5 w-3.5 text-ok" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-warn" />
                      )
                    ) : selected && testedSteps[selected.id] ? (
                      <Check className="h-3.5 w-3.5 text-ok" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-ink-muted" />
                    );
                  return (
                  <button
                    key={tab}
                    type="button"
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 px-3 py-2 text-sm capitalize",
                      inspectorTab === tab ? "border-b-2 border-violet-600 font-medium" : "text-ink-muted"
                    )}
                    onClick={() => setInspectorTab(tab)}
                  >
                    {icon}
                    {tab === "setup" ? "Setup" : tab === "configure" ? "Configure" : "Test"}
                  </button>
                  );
                })}
              </div>
              <div className="av-hide-scroll min-h-0 flex-1 px-4 py-4">
                <CopilotSuggestionsCard
                  open={suggestionsOpen}
                  stepLabel={
                    selected.data.operation
                      ? `${nodes.findIndex((n) => n.id === selected.id) + 1}. ${selected.data.label}`
                      : "this step"
                  }
                  youDoFirst={stepSuggestions.youDoFirst}
                  iCan={stepSuggestions.iCan}
                  onCustomize={() => {
                    const stepLabel = selected.data.operation
                      ? `${nodes.findIndex((n) => n.id === selected.id) + 1}. ${selected.data.label}`
                      : "this step";
                    askCopilot(`Fill out the fields in step '${stepLabel}' for me please.`);
                  }}
                />
                {inspectorTab === "setup" && (
                  <>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">App</div>
                    <button
                      type="button"
                      className="mb-4 flex h-9 w-full items-center justify-between rounded-lg border border-line px-2 text-sm"
                      onClick={() => openPicker(selected.data.kind === "trigger" ? "trigger" : "action", selected.id)}
                    >
                      <span className="flex items-center gap-2">
                        <AppIcon slug={selected.data.appSlug || "manual"} size="sm" />
                        {selectedApp?.name ?? "Choose an app"}
                      </span>
                      <span className="text-blue-600">Change</span>
                    </button>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                      {selected.data.kind === "trigger" ? "Trigger event" : "Action event"}
                    </div>
                    {selectedApp ? (
                      <div className="relative mb-4">
                        <button
                          type="button"
                          className="flex h-9 w-full items-center justify-between rounded-lg border border-line bg-elevated px-2 text-sm"
                          onClick={() => setEventOpen((v) => !v)}
                        >
                          <span>{selectedOp?.name || "Choose an event"}</span>
                          <span className="text-ink-muted">▾</span>
                        </button>
                        {eventOpen && (
                          <SearchableEventList
                            value={selected.data.operation}
                            events={selectedApp.operations
                              .filter((op) => (selected.data.kind === "trigger" ? op.type === "trigger" : op.type !== "trigger"))
                              .map((op) => ({
                                key: opKey(op),
                                name: op.name,
                                description: op.description,
                                group: op.type === "search" ? "SEARCH" : op.type === "trigger" ? "TRIGGERS" : "CREATE"
                              }))}
                            onPick={(key) => {
                              const op = selectedApp.operations.find((o) => opKey(o) === key);
                              if (!op) return;
                              updateNode(selected.id, { operation: opKey(op), label: op.name, config: {} });
                              setEventOpen(false);
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mb-4 flex h-9 w-full items-center justify-between rounded-lg border border-line px-2 text-sm"
                        onClick={() => openPicker(selected.data.kind === "trigger" ? "trigger" : "action", selected.id)}
                      >
                        <span>Choose an event</span>
                        <span className="text-ink-muted">▾</span>
                      </button>
                    )}
                    {selectedApp && needsConnection(selectedApp) && (
                      <section className="mb-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Account</div>
                        <div className="flex gap-2">
                        <div className="relative flex-1">
                          <button
                            type="button"
                            className="flex h-9 w-full items-center justify-between rounded-lg border border-line bg-elevated px-2 text-left text-sm"
                            onClick={() => setAccountOpen((v) => !v)}
                          >
                            <span className="truncate">
                              {appConnections.find((c) => c.id === selected.data.connectionId)?.name ?? "Select an account"}
                            </span>
                            <span className="text-violet-600">Change</span>
                          </button>
                          {accountOpen && (
                            <SearchableValuePicker
                              title="Select account"
                              value={selected.data.connectionId ?? ""}
                              options={appConnections.map((c) => ({
                                label: c.name,
                                value: c.id,
                                hint: `${c.status.replace(/_/g, " ")}${(c as { zapCount?: number }).zapCount ? ` · used in ${(c as { zapCount?: number }).zapCount}` : ""}`
                              }))}
                              onSelect={(id) => {
                                updateNode(selected.id, { connectionId: id || null });
                                setAccountOpen(false);
                              }}
                              onClear={() => updateNode(selected.id, { connectionId: null })}
                              onClose={() => setAccountOpen(false)}
                            />
                          )}
                        </div>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => {
                              setConnectReplaceId(selected.data.connectionId ?? null);
                              setConnectOpen(true);
                            }}
                          >
                            {appConnections.some((c) => c.status === "needs_reconnect")
                              ? "Reconnect"
                              : "Add account"}
                          </Button>
                        </div>
                        {appAuth(selectedApp) !== "none" && (
                          <p className="mt-2 text-xs text-ink-muted">
                            Select an active account to reuse it. Add another only when this step needs a different account. Secrets stay encrypted after save.
                          </p>
                        )}
                      </section>
                    )}
                    {selected.data.kind === "trigger" && webhookPublicId && selected.data.appSlug === "webhook" && (
                      <p className="break-all text-xs text-ink-muted">Catch URL after publish: /api/v1/hooks/{webhookPublicId}</p>
                    )}
                  </>
                )}
                {inspectorTab === "configure" && (
                  <>
                    <p className="mb-3 text-xs text-ink-muted">Map fields from earlier steps. Leave a required field blank rather than guessing.</p>
                    {!selected.data.operation && (
                      <p className="mb-3 text-sm text-ink-muted">Choose an app and event in Setup first.</p>
                    )}
                    {selected.data.appSlug === "subflow" && (
                      <label className="mb-3 block text-xs text-ink-muted">
                        Automation
                        <select
                          className="mt-1 h-9 w-full rounded-lg border border-line bg-elevated px-2 text-sm text-ink"
                          value={String(selected.data.config.automationId ?? "")}
                          onChange={(e) => updateNode(selected.id, { config: { ...selected.data.config, automationId: e.target.value } })}
                        >
                          <option value="">Select</option>
                          {(autosQ.data?.automations ?? [])
                            .filter((a) => a.id !== automationId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {selected.data.appSlug === "paths" && Array.isArray(selected.data.config.paths) && (
                      <div className="mb-4 space-y-3">
                        {(selected.data.config.paths as Array<{ id: string; label?: string; left?: string; operator?: string; right?: string; fallback?: boolean }>).map(
                          (p, i) => (
                            <div key={p.id} className="rounded-lg border border-line p-2">
                              <div className="mb-1 text-xs font-medium">{p.label ?? p.id}</div>
                              {p.fallback ? (
                                <p className="text-xs text-ink-muted">Fallback (else) path</p>
                              ) : (
                                <>
                                  <Input
                                    className="mb-1"
                                    placeholder="Field / left value"
                                    value={p.left ?? ""}
                                    onChange={(e) => {
                                      const paths = [...(selected.data.config.paths as typeof p[])];
                                      paths[i] = { ...p, left: e.target.value };
                                      updateNode(selected.id, { config: { ...selected.data.config, paths } });
                                    }}
                                  />
                                  <Input
                                    placeholder="Compare to"
                                    value={p.right ?? ""}
                                    onChange={(e) => {
                                      const paths = [...(selected.data.config.paths as typeof p[])];
                                      paths[i] = { ...p, right: e.target.value };
                                      updateNode(selected.id, { config: { ...selected.data.config, paths } });
                                    }}
                                  />
                                </>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}
                    {(selectedOp ? opFields(selectedOp) : []).map((field) => {
                      const k = fieldKey(field);
                      const val = String(selected.data.config[k] ?? "");
                      const dyn = dynQ.data?.fields?.find((f) => f.key === k);
                      const opts = dyn?.options ?? field.options;
                      return (
                        <label key={k} className="mb-3 block text-[13px] text-ink-muted">
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                          {opts || field.type === "select" || field.type === "dynamic" ? (
                            <div className="relative mt-1">
                              <button
                                type="button"
                                className="flex h-9 w-full items-center justify-between rounded-lg border border-line bg-elevated px-2 text-left text-sm text-ink"
                                onClick={() => setValueOpen(valueOpen === k ? null : k)}
                              >
                                <span className="truncate">{val ? (opts as Array<{ label: string; value: string }> | undefined)?.find?.((o) => typeof o !== "string" && o.value === val)?.label ?? val : "Choose value..."}</span>
                                <span className="text-ink-muted">▾</span>
                              </button>
                              {valueOpen === k && (
                                <SearchableValuePicker
                                  title={`Select value for ${field.label}`}
                                  value={val}
                                  loading={dynQ.isFetching}
                                  options={(opts as Array<string | { label: string; value: string; hint?: string }> | undefined)?.map((o) =>
                                    typeof o === "string" ? { label: o, value: o } : { label: o.label, value: o.value, hint: o.hint }
                                  ) ?? []}
                                  onSelect={(next) => updateNode(selected.id, { config: { ...selected.data.config, [k]: next } })}
                                  onRefresh={() => void dynQ.refetch()}
                                  onClear={() => updateNode(selected.id, { config: { ...selected.data.config, [k]: "" } })}
                                  onClose={() => setValueOpen(null)}
                                />
                              )}
                            </div>
                          ) : field.type === "code" || field.type === "json" || field.type === "text" ? (
                            <textarea
                              className="mt-1 min-h-[88px] w-full rounded-lg border border-line bg-elevated p-2 text-sm text-ink"
                              value={val}
                              onChange={(e) => updateNode(selected.id, { config: { ...selected.data.config, [k]: e.target.value } })}
                            />
                          ) : (
                            <div className="relative mt-1">
                              <Input
                                value={val}
                                placeholder="Insert data or type a value"
                                onFocus={() => setPicker(k)}
                                onChange={(e) => updateNode(selected.id, { config: { ...selected.data.config, [k]: e.target.value } })}
                              />
                              {picker === k && (
                                <DataPicker
                                  tokens={tokens}
                                  onPick={(token) => {
                                    updateNode(selected.id, {
                                      config: { ...selected.data.config, [k]: appendMapping(val, token, k) }
                                    });
                                    setPicker(null);
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </label>
                      );
                    })}
                    {selected.data.kind === "trigger" && webhookPublicId && selected.data.appSlug === "webhook" && (
                      <p className="break-all text-xs text-ink-muted">Catch URL after publish: /api/v1/hooks/{webhookPublicId}</p>
                    )}
                  </>
                )}
                {inspectorTab === "test" && (
                  <section className="rounded-xl border border-line p-3">
                    {!testResult && <p className="text-sm text-ink-muted">Run a test to see sample data you can map in later steps.</p>}
                    {testResult && (
                      <>
                        <div className={cn("mb-2 flex items-center gap-1.5 text-[13px] font-medium", testResult.ok ? "text-ok" : "text-danger")}>
                          {testResult.ok ? <Check className="h-4 w-4" /> : null}
                          {testResult.ok ? "Test successful" : "Test failed"}
                        </div>
                        {testResult.ms != null && <p className="mb-2 text-xs text-ink-muted">Duration {testResult.ms}ms</p>}
                        <pre className="av-hide-scroll max-h-56 whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                          {JSON.stringify(testResult.body, null, 2)}
                        </pre>
                        <button
                          className="mt-2 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                          onClick={() => void navigator.clipboard.writeText(JSON.stringify(testResult.body, null, 2))}
                        >
                          <Copy className="h-3 w-3" /> Copy JSON
                        </button>
                      </>
                    )}
                  </section>
                )}
              </div>
              <div className="border-t border-line px-4 py-3">
                {inspectorTab === "setup" && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (!selected.data.operation) {
                        openPicker(selected.data.kind === "trigger" ? "trigger" : "action", selected.id);
                        return;
                      }
                      if (selectedApp && needsConnection(selectedApp) && !selected.data.connectionId) {
                        setConnectReplaceId(null);
                        setConnectOpen(true);
                        return;
                      }
                      setInspectorTab("configure");
                    }}
                  >
                    {continueLabel}
                  </Button>
                )}
                {inspectorTab === "configure" && (
                  <Button className="w-full" disabled={!configureDone} onClick={() => setInspectorTab("test")}>
                    {configureDone ? "Continue" : "To continue, finish required fields"}
                  </Button>
                )}
                {inspectorTab === "test" && (
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => void testStep()} disabled={busy === "step"}>
                      {busy === "step" ? "Testing…" : selected.data.kind === "trigger" ? "Test trigger" : "Test step"}
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={() => void testWorkflow()} disabled={busy === "test"}>
                      Test workflow
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {appPicker && (
        <AppPickerModal
          apps={apps}
          kind={appPicker.kind}
          initialTab={pickerTab}
          onClose={() => setAppPicker(null)}
          onPick={(app, op) => addOp(app, op)}
        />
      )}
      {connectOpen && selected?.data.appSlug && (
        <ConnectAccountModal
          appSlug={selected.data.appSlug}
          appName={selectedApp?.name}
          returnTo={`${pathname}?nodeId=${selected.id}`}
          replaceConnectionId={connectReplaceId}
          onClose={() => {
            setConnectOpen(false);
            setConnectReplaceId(null);
          }}
          onConnected={(id) => {
            updateNode(selected.id, { connectionId: id });
            setConnectOpen(false);
            setConnectReplaceId(null);
            setMsg("Account connected. Continue to Configure.");
          }}
        />
      )}
      {msgModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={() => setMsgModal(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100">
                <Sparkles className="h-4 w-4 text-violet-600" />
              </span>
              <h2 className="text-base font-semibold">{msgModal.title}</h2>
            </div>
            <p className="text-sm text-ink leading-relaxed">{msgModal.body}</p>
            <div className="mt-5 flex justify-end">
              <Button size="sm" onClick={() => setMsgModal(null)}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {/* Copilot Modal Overlay */}
      {copilotModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={() => setCopilotModal(false)}>
          <div className="flex h-[85vh] w-[min(640px,96vw)] rounded-2xl border border-line bg-elevated shadow-card overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <CopilotPanel
              automationId={automationId}
              open={true}
              modal={true}
              onOpenModal={() => {}}
              building={busy === "copilot"}
              draftConfigured={nodes.some((n) => Boolean(n.data.appSlug && n.data.operation))}
              draftOutline={nodes
                .filter((n) => n.data.appSlug && n.data.operation)
                .map((n, i) => `${i + 1}. ${n.data.label || n.data.operation}`)
                .join(" → ")}
              firstHumanAction={firstHumanAction}
              mode={copilotMode}
              onModeChange={(next) => {
                setCopilotMode(next);
                try {
                  localStorage.setItem("orchestra-copilot-mode", next);
                } catch {
                  /* ignore */
                }
              }}
              reasoning={copilotReasoning}
              showReasoning={showReasoning}
              onToggleReasoning={() => setShowReasoning((v) => !v)}
              stages={copilotStages}
              todos={copilotTodos}
              onClose={() => setCopilotModal(false)}
              onExpand={() => {}}
              onCheckpoint={() => {
                copilotCheckpoint.current = toApi(nodes, edges);
                setMsg("Copilot checkpoint saved. Revert restores this draft.");
              }}
              onBuild={async (prompt) => {
                setCopilotPrompt(prompt);
                return runCopilot(prompt);
              }}
              onStop={() => {
                copilotAbort.current = true;
                copilotAbortCtl.current?.abort();
                setBusy(null);
              }}
              onChat={async (prompt) => {
                let d;
                try {
                  d = await api<{
                    reply: string;
                    graph?: GraphPayload;
                    applied?: boolean;
                    summary?: string;
                    youDoFirst?: string[];
                    iCan?: string[];
                    events?: Array<{ type: string; stage?: string; label?: string; text?: string; kind?: string; message?: string }>;
                  }>("/ai/copilot/chat", {
                    method: "POST",
                    body: JSON.stringify({
                      prompt,
                      graph: toApi(nodes, edges),
                      plan: "free",
                      automationId,
                      mode: copilotMode,
                      selectedStepId: selectedId,
                      lastTest: testResultRef.current
                    })
                  });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "";
                  if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
                    throw new Error("Copilot took too long to respond. The AI service may be overloaded — try a shorter instruction.");
                  }
                  if (msg.includes("ECONNREFUSED") || msg.includes("fetch")) {
                    throw new Error("Cannot reach the Copilot service. Make sure the API and AI services are running.");
                  }
                  throw new Error(`Copilot could not process that request: ${msg || "unknown error"}. Try rephrasing or starting a new session.`);
                }
                if (!d) throw new Error("Copilot returned no response.");
                const stageEvents = (d.events ?? []).filter((e) => e.type === "stage");
                if (stageEvents.length) {
                  setCopilotStages(stageEvents.map((e) => ({ label: e.label ?? e.stage ?? "stage", state: "done" as const })));
                }
                const reasoning = (d.events ?? []).find((e) => e.type === "reasoning")?.text;
                if (reasoning) setCopilotReasoning(reasoning);
                if (d.events?.some((e) => e.type === "todo")) {
                  setCopilotTodos(
                    (d.events ?? []).filter((e) => e.type === "todo" && e.message).map((e) => ({ kind: e.kind ?? "confirm", message: e.message! }))
                  );
                }
                if (d.graph && d.applied) {
                  copilotCheckpoint.current = toApi(nodes, edges);
                  const g = fromApi(d.graph);
                  hydrate(g.nodes, g.edges);
                  setGraph(g.nodes, g.edges);
                  setMsg(d.summary ?? "Copilot updated the draft. Test, then publish yourself.");
                }
                return d;
              }}
              onApply={async (graph, sessionId) => {
                copilotCheckpoint.current = toApi(nodes, edges);
                if (sessionId) {
                  try {
                    const result = await api<{
                      ok: boolean;
                      graph?: GraphPayload;
                      applied?: Array<{ kind: string; arguments: Record<string, unknown> }>;
                      rejected?: Array<{ operation: unknown; reason: string }>;
                    }>(`/copilot/sessions/${sessionId}/approve`, {
                      method: "POST",
                      body: JSON.stringify({ flowId: automationId }),
                    });
                    if (result.ok && result.graph) {
                      const g = fromApi(result.graph);
                      hydrate(g.nodes, g.edges);
                      setGraph(g.nodes, g.edges);
                      setMsg("Copilot changes validated and applied to the draft. Test before publishing.");
                      return;
                    }
                  } catch {
                    // Fall through to local apply if server approval fails
                  }
                }
                const g = fromApi(graph as GraphPayload);
                hydrate(g.nodes, g.edges);
                setGraph(g.nodes, g.edges);
                setMsg("Copilot change applied to the draft. Test before publishing.");
              }}
              onRevert={() => {
                if (!copilotCheckpoint.current) return;
                const g = fromApi(copilotCheckpoint.current);
                hydrate(g.nodes, g.edges);
                setGraph(g.nodes, g.edges);
                copilotCheckpoint.current = null;
                setMsg("Copilot change reverted.");
              }}
              incomingPrompt={injectPrompt}
              onIncomingPromptHandled={() => setInjectPrompt(null)}
            />
          </div>
        </div>
      )}

      {publishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setPublishOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Ready to publish?</h2>
            <p className="mt-1 text-sm text-ink-muted">Publishing is a human action. Copilot cannot turn this draft on.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {errors.slice(0, 8).map((e) => (
                <li key={e} className="text-danger">
                  {e}
                </li>
              ))}
              {!errors.length && <li className="flex gap-2 text-ok"><Check className="h-4 w-4" /> Ready to go live</li>}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setPublishOpen(false); setServerPublishErrors([]); }}>
                Cancel
              </Button>
              <Button onClick={() => void publish()} disabled={errors.length > 0 || busy === "publish"}>
                {busy === "publish" ? "Publishing…" : "Publish"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this step?"
        body={
          confirmDelete
            ? `Remove ${confirmDelete.label} from the canvas. Neighboring steps stay connected. You can Undo afterward.`
            : ""
        }
        confirmLabel="Delete step"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            removeNode(confirmDelete.id);
            const next = useBuilderStore.getState();
            setGraph(layoutFlow(next.nodes, next.edges), next.edges, false);
            setMsg(`Deleted ${confirmDelete.label}.`);
          }
          setConfirmDelete(null);
        }}
      />

      {/* Flow Overview Modal */}
      {flowOverviewOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={() => setFlowOverviewOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                <Workflow className="h-4 w-4 text-violet-600" />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold">{title || "Untitled workflow"}</h2>
                <p className="text-xs text-ink-muted">{published ? "Published and active" : "Draft"} · {nodes.length} step{nodes.length !== 1 ? "s" : ""}</p>
              </div>
              <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={() => setFlowOverviewOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {nodes.map((n, i) => {
                const app = apps.find((a) => a.slug === n.data.appSlug);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${n.id === selectedId ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30" : "border-line hover:bg-muted/50"}`}
                    onClick={() => { setFlowOverviewOpen(false); setSelected(n.id); setInspectorTab("setup"); }}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-ink-muted">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{n.data.label || n.data.operation || "Choose app"}</span>
                      <span className="text-[11px] text-ink-muted">{n.data.appSlug || "No app"} {n.data.kind === "trigger" ? "· Trigger" : "· Action"}</span>
                    </span>
                    {n.data.connectionId ? (
                      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">Connected</span>
                    ) : n.data.appSlug && !(["webhook","http","manual","schedule","filter","paths"].includes(n.data.appSlug)) ? (
                      <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10px] font-medium text-warn">Needs auth</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowBuilder(props: {
  automationId: string;
  name: string;
  initialGraph: GraphPayload;
  webhookPublicId?: string;
  status?: string;
}) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, History, Lightbulb, Maximize2, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Send, Settings, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CopilotMode } from "./copilot-types";
import { WorkflowPreview, type WorkflowPreviewData } from "./workflow-preview";

type Msg = { role: "user" | "assistant"; text: string; workflowPreview?: WorkflowPreviewData; suggestion?: boolean; applied?: boolean };
type ChatResult = { reply: string; graph?: unknown; sessionId?: string; applied?: boolean; preview?: WorkflowPreviewData; youDoFirst?: string[]; iCan?: string[] };
type Activity = { label: string; detail?: string; state: "done" | "active" };
export type CopilotTodo = { kind: string; message: string };
const MIN_W = 280; const MAX_W = 720; const SNAP_MIN = 196; const DEFAULT_W = 340;

const WORKFLOW_SUGGESTIONS = [
  "Test this workflow",
  "Explain this workflow",
  "Add the next step",
  "Add a branch after this step",
  "Fill this step",
  "Map fields between steps",
  "Check my connections",
  "Validate this workflow",
];

export function CopilotPanel({ automationId, open, modal, onOpenModal, building, draftConfigured, draftOutline: _draftOutline, firstHumanAction, mode, onModeChange, reasoning, showReasoning, onToggleReasoning, stages, todos: _todos, planeHint: _planeHint, onClose, onExpand, onBuild, onStop, onChat, onApply, onRevert, onCheckpoint, incomingPrompt, onIncomingPromptHandled }: { automationId: string; open: boolean; building: boolean; draftConfigured: boolean; draftOutline?: string; firstHumanAction?: string; mode: CopilotMode; onModeChange: (mode: CopilotMode) => void; reasoning: string; showReasoning: boolean; onToggleReasoning: () => void; stages: Activity[]; todos: CopilotTodo[]; modal?: boolean; onOpenModal?: () => void; planeHint?: string; onClose: () => void; onExpand: () => void; onCheckpoint: () => void; onBuild: (prompt: string) => void | Promise<{ graph?: unknown; summary?: string; rebuilt?: boolean; changed?: boolean } | void>; onStop: () => void; onChat: (prompt: string) => Promise<ChatResult>; onApply: (graph: unknown, sessionId?: string) => void | Promise<void>; onRevert: () => void; incomingPrompt?: string | null; onIncomingPromptHandled?: () => void }) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [proposal, setProposal] = useState<unknown>(null);
  const [proposalSessionId, setProposalSessionId] = useState<string | undefined>();
  const [checkpoint, setCheckpoint] = useState(false);
  const [approving, setApproving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [width, setWidth] = useState(DEFAULT_W);
  const [humanActionModal, setHumanActionModal] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width); widthRef.current = width;

  useEffect(() => {
    setMsgs([]); setProposal(null); setProposalSessionId(undefined); setApproving(false); setCheckpoint(false); setInput(""); setMinimized(false); setHumanActionModal(false); setSuggestionsOpen(false);
    try { const w = Number(localStorage.getItem("orchestra-copilot-width")); if (w >= MIN_W && w <= MAX_W) setWidth(w); } catch {}
  }, [automationId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, building, sending]);

  useEffect(() => {
    function move(e: MouseEvent) { if (!drag.current) return; const next = drag.current.startW + (e.clientX - drag.current.startX); if (next < SNAP_MIN) { drag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; setMinimized(true); return; } setWidth(Math.min(MAX_W, Math.max(MIN_W, next))); }
    function up() { if (!drag.current) return; drag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; try { localStorage.setItem("orchestra-copilot-width", String(widthRef.current)); } catch {} }
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  async function send(kind: "auto" | "chat" | "build", requestedPrompt?: string) {
    const prompt = (requestedPrompt ?? input).trim(); if (!prompt) return;
    setMsgs((m) => [...m, { role: "user", text: prompt }]); setInput(""); setSuggestionsOpen(false);
    const emptyCanvas = !draftConfigured; const useBuild = emptyCanvas && kind !== "chat";
    if (useBuild) {
      try { const result = await onBuild(prompt); setMsgs((m) => [...m, { role: "assistant", text: result && "summary" in result && result.summary ? String(result.summary) : "Outlined a draft. Connect anything I cannot do, test a step, then publish." }]); }
      catch (err) { setMsgs((m) => [...m, { role: "assistant", text: err instanceof Error ? err.message : "Copilot is unavailable." }]); }
      return;
    }
    setSending(true);
    try {
      const result = await onChat(prompt);
      const hasSuggestion = Boolean(result.graph || result.preview);
      setMsgs((m) => [...m, { role: "assistant", text: result.reply, workflowPreview: result.preview, suggestion: hasSuggestion, applied: Boolean(result.graph && result.applied) }]);
      if (result.graph && result.applied) setCheckpoint(true);
      if (result.graph && (mode === "ask_as_you_build" || !result.applied)) { setProposal(result.graph); setProposalSessionId(result.sessionId); }
    } catch (err) { setMsgs((m) => [...m, { role: "assistant", text: err instanceof Error ? err.message : "Copilot is unavailable." }]); }
    finally { setSending(false); }
  }

  useEffect(() => { if (!incomingPrompt?.trim()) return; const prompt = incomingPrompt.trim(); onIncomingPromptHandled?.(); void send("chat", prompt); }, [incomingPrompt]);

  const empty = msgs.length === 0 && !building && !sending;
  const collapsed = !open || minimized;
  if (collapsed) return <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-line bg-elevated py-2"><button type="button" className="rounded-lg p-2 text-violet-600 hover:bg-muted" title="Expand Copilot" onClick={() => { setMinimized(false); onExpand(); }}><PanelLeftOpen className="h-5 w-5" /></button><Sparkles className="mt-2 h-4 w-4 text-violet-600" /></aside>;

  return <aside className="relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-line bg-elevated" style={{ width }}>
    <div className="relative flex h-11 min-w-0 items-center gap-1 border-b border-line px-2">
      <span className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white"><Sparkles className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-none">Copilot</p><p className="mt-0.5 text-[10px] text-ink-muted">Build faster with AI</p></div>
      {draftConfigured && <button type="button" className={cn("relative rounded-lg p-1.5 transition", suggestionsOpen ? "bg-violet-600 text-white" : "text-ink-muted hover:bg-muted")} title="Suggestions" aria-label="Open Copilot suggestions" aria-expanded={suggestionsOpen} onClick={() => setSuggestionsOpen((v) => !v)}><Lightbulb className="h-4 w-4" /><span className="absolute -right-0.5 -top-0.5 flex h-2 w-2 rounded-full bg-teal" /></button>}
      {!modal && <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Open Copilot in overlay" onClick={() => onOpenModal?.()}><Maximize2 className="h-4 w-4" /></button>}
      {!modal && <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Minimize" onClick={() => setMinimized(true)}><PanelLeftClose className="h-4 w-4" /></button>}
      <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Checkpoint" onClick={() => { onCheckpoint(); setCheckpoint(true); }}><History className="h-4 w-4" /></button>
      <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="New chat" onClick={() => setMsgs([])}><Plus className="h-4 w-4" /></button>
      <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Settings" onClick={() => setSettingsOpen((v) => !v)}><Settings className="h-4 w-4" /></button>
      {firstHumanAction ? <button type="button" className="rounded-lg p-1.5 text-warn hover:bg-warn/10" title="Action needed" onClick={() => setHumanActionModal(true)}><AlertTriangle className="h-4 w-4" /></button> : null}
      <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose} aria-label="Close Copilot"><X className="h-4 w-4" /></button>
      {suggestionsOpen && draftConfigured && <div className="absolute right-9 top-12 z-50 w-72 rounded-xl border border-line bg-elevated p-2 shadow-card"><div className="flex items-center gap-2 border-b border-line px-2 pb-2"><Lightbulb className="h-3.5 w-3.5 text-violet-600" /><div><p className="text-xs font-semibold text-ink">Suggestions</p><p className="text-[10px] text-ink-muted">Actions for the workflow you already selected</p></div></div><div className="mt-2 grid gap-1">{WORKFLOW_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" className="rounded-lg px-2.5 py-2 text-left text-[11px] text-ink transition hover:bg-muted hover:text-violet-700" onClick={() => void send("chat", suggestion)}>{suggestion}</button>)}</div></div>}
    </div>

    {settingsOpen && <div className="space-y-2 border-b border-line bg-muted/40 px-3 py-2 text-[11px] text-ink-muted"><p>Patches apply as you go, or wait until you confirm. Copilot never publishes or creates accounts.</p><div className="flex gap-1">{([["auto_build", "Apply as I go"], ["ask_as_you_build", "Suggest first"]] as const).map(([value, label]) => <button key={value} type="button" className={cn("rounded-full px-2 py-1", mode === value ? "bg-violet-600 text-white" : "bg-muted")} onClick={() => onModeChange(value)}>{label}</button>)}</div></div>}

    <div ref={scroller} className="av-hide-scroll min-h-0 min-w-0 flex-1 space-y-3 p-3 text-sm">
      {empty && <div className="rounded-2xl border border-teal/30 bg-teal-soft/20 p-3"><p className="text-sm font-semibold text-ink">{draftConfigured ? "Ask about this workflow" : "What should we automate?"}</p><p className="mt-1 text-[11px] text-ink-muted">{draftConfigured ? "Ask Copilot to modify or improve the workflow you already selected." : "Describe your goal and Copilot will help build the workflow."}</p></div>}
      {(building || sending) && <div className="rounded-2xl border border-teal/30 bg-teal-soft/20 p-3 text-xs text-ink-muted"><div className="flex items-center gap-2"><span className="relative flex h-5 w-5 items-center justify-center"><span className="absolute h-5 w-5 animate-ping rounded-full bg-teal/30" /><Sparkles className="relative h-3.5 w-3.5 text-teal" /></span><span className="font-medium text-ink">Copilot is working…</span>{building ? <button type="button" className="ml-auto text-danger" onClick={onStop}>Stop</button> : null}</div>{showReasoning && stages.length > 0 && <ul className="mt-2 space-y-1 rounded-xl border border-line bg-bg/50 px-3 py-2">{stages.slice(-6).map((s, i) => <li key={`${s.label}-${i}`} className={cn("truncate text-ink-muted", s.state === "active" && "font-medium text-ink")}>{s.state === "active" ? "→ " : "✓ "}{s.label}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ul>}{showReasoning && reasoning ? <p className="mt-2 break-words whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">{reasoning}</p> : null}</div>}
      {stages.length > 0 && showReasoning && !empty && <button type="button" className="text-[11px] text-teal" onClick={onToggleReasoning}>Hide reasoning</button>}
      {msgs.map((m, i) => m.role === "user" ? <div key={i} className="ml-6 min-w-0 break-words rounded-2xl rounded-tr-md bg-violet-600 px-3 py-2 text-[13px] text-white">{m.text}</div> : <div key={i} className="min-w-0 space-y-2"><div className="min-w-0 break-words rounded-2xl rounded-tl-md border border-line bg-muted/40 px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">{m.text}</div>{m.suggestion ? <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal-soft/30 px-2 py-1 text-[10px] font-medium text-teal"><Sparkles className="h-2.5 w-2.5" />Suggestion</span>{m.applied ? <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-1 text-[10px] font-medium text-ok"><Check className="h-2.5 w-2.5" />Applied to draft</span> : null}</div> : null}{m.workflowPreview?.steps.length ? <WorkflowPreview preview={m.workflowPreview} /> : null}</div>)}
      {proposal !== null && <div className="rounded-xl border border-teal/40 bg-teal-soft/20 p-3 text-xs text-ink"><div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal-soft/40 px-2 py-1 text-[10px] font-semibold text-teal"><Sparkles className="h-2.5 w-2.5" />Suggestion ready</span><span className="text-[10px] text-ink-muted">Review before applying</span></div><p className="mt-2">Copilot prepared a workflow change. Applying writes the draft — it still does not publish.</p><Button size="sm" className="mt-2" disabled={approving} onClick={async () => { setApproving(true); try { await onApply(proposal, proposalSessionId); setCheckpoint(true); setProposal(null); setProposalSessionId(undefined); } finally { setApproving(false); } }}>{approving ? "Applying…" : "Apply suggestion"}</Button></div>}
      {checkpoint && <div className="flex items-center gap-2 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Saved<button type="button" className="ml-auto inline-flex items-center gap-1 font-medium" onClick={() => { onRevert(); setCheckpoint(false); }}><RotateCcw className="h-3 w-3" /> Revert</button></div>}
    </div>

    <div className="border-t border-line p-3"><div className="flex items-end gap-2 rounded-2xl border border-line bg-muted/20 p-2 focus-within:border-teal"><textarea className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none" placeholder="Chat with Copilot" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send("auto"); } }} /><Button size="sm" className="shrink-0" onClick={() => void send(draftConfigured ? "chat" : "build")} disabled={sending || building || !input.trim()}>{building ? "Stop" : <Send className="h-3.5 w-3.5" />}</Button></div><p className="mt-2 text-[10px] text-ink-muted">AI-powered · review before publishing</p></div>
    <button type="button" aria-label="Resize Copilot" className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize hover:bg-teal" onMouseDown={(e) => { e.preventDefault(); drag.current = { startX: e.clientX, startW: width }; document.body.style.cursor = "ew-resize"; document.body.style.userSelect = "none"; }} />
    {humanActionModal && firstHumanAction && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={() => setHumanActionModal(false)}><div className="w-full max-w-md rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}><div className="mb-3 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100"><AlertTriangle className="h-4 w-4 text-warn" /></span><h2 className="text-base font-semibold">Action Required</h2></div><p className="text-sm leading-relaxed text-ink">{firstHumanAction}</p><p className="mt-2 text-xs text-ink-muted">Copilot can guide you, but this step requires your action.</p><div className="mt-5 flex justify-end"><Button size="sm" onClick={() => setHumanActionModal(false)}>Got it</Button></div></div></div>}
  </aside>;
}

export function CopilotReasoning({ show = false, text, onStop }: { show?: boolean; text?: string; onStop: () => void }) { if (!show) return null; return <div className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2"><div className="pointer-events-auto max-w-lg rounded-2xl border border-line bg-elevated px-3 py-2 shadow-card"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">C</span><span className="text-sm">Working…</span><button type="button" className="ml-auto rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white" onClick={onStop}>Stop</button></div>{text && <p className="mt-2 max-h-24 overflow-auto text-[11px] leading-relaxed text-ink-muted">{text}</p>}</div></div>; }
"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  AlertTriangle, Bot, Check, ChevronRight, History, Lightbulb, Loader2,
  Maximize2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw,
  Send, Settings, Sparkles, X, Zap, AlertCircle,
  ArrowRight, Pencil, Copy, Pencil as EditIcon, CheckCheck, Play, CircleDot
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CopilotMode, AgentState, AgentActivityItem, AgentActivityKind } from "./copilot-types";
import { WorkflowPreview, type WorkflowPreviewData } from "./workflow-preview";

// ── Types ───────────────────────────────────────────────────────────────────

type Msg = {
  role: "user" | "assistant";
  text: string;
  workflowPreview?: WorkflowPreviewData;
  suggestion?: boolean;
  applied?: boolean;
  suggestions?: SuggestionBadge[];
  operations?: OperationCard[];
  clarification?: Clarification;
  systemPlan?: SystemPlanResult;
  activities?: AgentActivityItem[];
  agentState?: AgentState;
  agentTitle?: string;
  thinking?: string;
  streaming?: boolean;
  /** Rich structured response blocks */
  stepCards?: StepCard[];
  connectionCards?: ConnectionCard[];
  fieldMappings?: FieldMappingCard[];
  testResults?: TestResultCard[];
  warnings?: string[];
};
type StepCard = { index: number; label: string; app?: string; status: "configured" | "needs_config" | "needs_connection" | "needs_action" | "tested"; issues?: string[]; actions?: Array<{ label: string; prompt: string }> };
type ConnectionCard = { appSlug: string; appName: string; status: "connected" | "not_configured"; message?: string; actions?: Array<{ label: string; prompt: string }> };
type FieldMappingCard = { sourceLabel: string; sourceFields: string[]; targetLabel: string; targetFields: string[]; mappings: Array<{ source: string; target: string }> };
type TestResultCard = { stepLabel: string; success: boolean; fields?: Record<string, unknown>; actions?: Array<{ label: string; prompt: string }> };
type SystemPlanResult = { goal: string; summary: string; products_used: string[]; entry_surface: string; primary_product: string; confidence: number; capabilities: Array<{ type: string; description: string; product: string; app_hint?: string }>; resource_graph: Array<{ index: number; product: string; capability: string; description: string; app_hint?: string; depends_on: number[] }>; needs_connections: string[]; recommended_actions: string[]; is_single_product: boolean };
type ChatResult = { reply: string; graph?: unknown; sessionId?: string; applied?: boolean; preview?: WorkflowPreviewData; youDoFirst?: string[]; iCan?: string[]; suggestions?: SuggestionBadge[]; operations?: OperationCard[]; clarification?: Clarification; systemPlan?: SystemPlanResult; thinking?: string; stepCards?: StepCard[]; connectionCards?: ConnectionCard[]; warnings?: string[] };
type Activity = { label: string; detail?: string; state: "done" | "active" };
export type CopilotTodo = { kind: string; message: string };

const MIN_W = 280; const MAX_W = 720; const SNAP_MIN = 196; const DEFAULT_W = 340;

type SuggestionBadge = { label: string; prompt: string; icon?: "zap" | "check" | "arrow" | "pencil" | "alert" };
type OperationCard = { title: string; steps: OperationStep[]; status: "running" | "completed" | "failed"; actions?: Array<{ label: string; prompt: string }> };
type OperationStep = { label: string; status: "pending" | "running" | "completed" | "failed" | "skipped"; detail?: string };
type Clarification = { question: string; options: Array<{ label: string; prompt: string; description?: string }> };

const EMPTY_CANVAS_PROMPTS: SuggestionBadge[] = [
  { label: "Gmail \u2192 Slack", prompt: "When a new Gmail arrives, send a summary to Slack", icon: "zap" },
  { label: "Calendar \u2192 Sheets", prompt: "When a new calendar event is created, add it to Google Sheets", icon: "zap" },
  { label: "Form \u2192 Email", prompt: "When a form is submitted, send a confirmation email", icon: "zap" },
  { label: "Schedule \u2192 AI", prompt: "Every morning, summarize tasks with AI and send to Slack", icon: "zap" },
  { label: "Webhook \u2192 HTTP", prompt: "When a webhook arrives, POST the body to an HTTP endpoint", icon: "zap" },
  { label: "Lead \u2192 AI \u2192 Sheets", prompt: "When a new lead arrives, analyze with AI and save to Sheets", icon: "zap" },
];

const WORKFLOW_PROMPTS: SuggestionBadge[] = [
  { label: "Explain this flow", prompt: "Explain this workflow", icon: "check" },
  { label: "Find problems", prompt: "Find problems in this workflow", icon: "alert" },
  { label: "Add a step", prompt: "Add the next step", icon: "arrow" },
  { label: "Add condition", prompt: "Add a condition/branch after this step", icon: "pencil" },
  { label: "Add AI step", prompt: "Add an AI processing step", icon: "zap" },
  { label: "Test this flow", prompt: "Test this workflow", icon: "zap" },
  { label: "Optimize", prompt: "Optimize this workflow", icon: "check" },
  { label: "Add error handling", prompt: "Add error handling and retry logic", icon: "alert" },
];

const PRODUCT_ICONS: Record<string, string> = { form: "\ud83d\udcdd", table: "\ud83d\uddc3", workflow: "\u26a1", agent: "\ud83e\udd16", chatbot: "\ud83d\udcac", interface: "\ud83d\udda5", connection: "\ud83d\udd17" };

/** Map agent states to user-safe display labels — never expose internals */
const STATE_DISPLAY: Record<AgentState, { label: string; icon: "spinner" | "check" | "alert" | "idle" }> = {
  idle: { label: "Ready", icon: "idle" },
  understanding: { label: "Understanding your request", icon: "spinner" },
  inspecting: { label: "Inspecting workflow", icon: "spinner" },
  planning: { label: "Designing workflow", icon: "spinner" },
  executing: { label: "Building workflow", icon: "spinner" },
  testing: { label: "Testing workflow", icon: "spinner" },
  validating: { label: "Validating workflow", icon: "spinner" },
  waiting_for_user: { label: "Waiting for your choice", icon: "alert" },
  completed: { label: "Done", icon: "check" },
  blocked: { label: "Needs your attention", icon: "alert" },
  error: { label: "Something went wrong", icon: "alert" },
};

/** Map backend SSE stages to user-facing pipeline steps */
const PIPELINE_STAGES = [
  { key: "intent", label: "Understanding your request" },
  { key: "plan", label: "Finding capabilities" },
  { key: "retrieve", label: "Looking at your workflow" },
  { key: "select", label: "Checking available apps" },
  { key: "connections", label: "Checking connections" },
  { key: "schemas", label: "Reading data fields" },
  { key: "mapping", label: "Mapping fields" },
  { key: "assemble", label: "Building workflow" },
  { key: "validate", label: "Validating workflow" },
  { key: "persist", label: "Saving draft" },
];

const THINKING_PATTERNS = [
  /^\s*Thinking\.\.\.\s*/i,
  /^\s*(?:The user is asking me to|The user wants me to|Let me (?:analyze|think|consider|look|check|examine|inspect|understand|review)|I should (?:first|start|begin|check|look|analyze)|Looking at (?:the|this|what)|Given the context|The user might be|I need to (?:first|check|look|see|understand|analyze)|Wait\s*[\u2014,]|But wait\s*[\u2014,]|Actually\s*[\u2014,]|Now\s*[\u2014,]|So\s*[\u2014,]).*/im,
  /^\d+\.\s+(?:The user|Let me|I should|I need|Looking|Given|The workflow|Step \d).*/gm,
  /^(?:First,|Second,|Third,)?\s*(?:I(?:'ll| will| should| need to| can)|Let me|The user|Looking at|Given that|I notice|I see that|The current state).*/gm,
  /(?:I can see you have|This appears to be|The user said|Let me first test|But first,|But I need to know|I need to see what)/g,
  /(?:Let me explain what(?:'s| is) needed|ask for the action step direction|explain what(?:'s| is) needed and ask)/g,
];

/** Convert raw backend reasoning text into a concise user-facing activity label */
function reasoningToActivity(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(intent|understand|classify|parse)\b/.test(lower)) return "Understanding your request";
  if (/\b(retrieve|find|search|lookup|catalog)\b/.test(lower)) return "Finding matching apps";
  if (/\b(select|pick|choose|match)\b/.test(lower)) return "Selecting operations";
  if (/\b(connect|auth|account|credential)\b/.test(lower)) return "Checking connections";
  if (/\b(schema|field|column|output|input)\b/.test(lower)) return "Reading data fields";
  if (/\b(map|mapping|lineage|link)\b/.test(lower)) return "Mapping fields between steps";
  if (/\b(assemble|build|graph|compile|construct)\b/.test(lower)) return "Building workflow";
  if (/\b(validate|check|verify|repair)\b/.test(lower)) return "Validating workflow";
  if (/\b(persist|save|draft|store)\b/.test(lower)) return "Saving draft";
  if (/\b(test|run|execute|trigger)\b/.test(lower)) return "Testing workflow";
  if (/\b(error|fail|broken|issue)\b/.test(lower)) return "Found an issue";
  // Fallback: take first sentence, truncated
  const first = text.split(/\n/)[0] || text;
  return first.length > 60 ? first.slice(0, 57) + "..." : first;
}

function stripChainOfThought(text: string): string {
  if (!text) return text;
  let cleaned = text;
  for (const pat of THINKING_PATTERNS) cleaned = cleaned.replace(pat, "");
  cleaned = cleaned.replace(/^\s*\d+\.\s+\*?\*?(?:The user|Let me|I should|I need|Looking|Given|The workflow|Step \d|Wait|But|Actually).*$/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || text;
}

// ── Small components ────────────────────────────────────────────────────────

function ActivityIcon({ kind, size = "sm" }: { kind: AgentActivityKind; size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  switch (kind) {
    case "done": return <span className={cn(s, "flex items-center justify-center rounded-full bg-ok/15 text-ok")}><Check className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} /></span>;
    case "running": return <Loader2 className={cn(s, "animate-spin text-teal")} />;
    case "warn": return <span className={cn(s, "flex items-center justify-center rounded-full bg-warn/15 text-warn")}><AlertTriangle className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} /></span>;
    case "error": return <span className={cn(s, "flex items-center justify-center rounded-full bg-danger/15 text-danger")}><X className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} /></span>;
    default: return <CircleDot className={cn(s, "text-ink-muted/50")} />;
  }
}

/** Live build pipeline — shows user-safe progress with animated transitions */
function BuildPipeline({ activities, agentState, agentTitle }: { activities: AgentActivityItem[]; agentState: AgentState; agentTitle: string }) {
  const isWorking = agentState !== "idle" && agentState !== "completed" && agentState !== "error";
  const doneCount = activities.filter((a) => a.kind === "done").length;
  const totalEstimate = PIPELINE_STAGES.length;
  const progress = Math.min(1, doneCount / totalEstimate);

  if (!isWorking && activities.length === 0) return null;

  return (
    <div className="rounded-xl border border-teal/20 bg-gradient-to-b from-teal-soft/10 to-transparent p-3 mx-1">
      {/* Progress bar */}
      {isWorking && (
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-teal/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal to-teal/60 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(5, progress * 100)}%` }}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-6 w-6 items-center justify-center">
          {isWorking && <span className="absolute h-6 w-6 animate-ping rounded-full bg-teal/20" />}
          {isWorking ? (
            <Loader2 className="relative h-3.5 w-3.5 animate-spin text-teal" />
          ) : agentState === "completed" ? (
            <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-ok text-white"><Check className="h-3 w-3" /></span>
          ) : agentState === "error" ? (
            <AlertTriangle className="relative h-3.5 w-3.5 text-danger" />
          ) : (
            <Sparkles className="relative h-3.5 w-3.5 text-teal" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink leading-none">{agentTitle || "Working..."}</p>
        </div>
      </div>

      {/* Activity items with slide-in animation */}
      {activities.length > 0 && (
        <div className="mt-3 space-y-1">
          {activities.slice(-8).map((item, idx) => (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1 text-[12px] transition-all duration-300",
                item.kind === "running" && "bg-teal-soft/20",
                item.kind === "done" && "opacity-80",
                // Slide-in animation for new items
                idx === activities.slice(-8).length - 1 && "animate-[slideIn_0.3s_ease-out]",
              )}
            >
              <ActivityIcon kind={item.kind} />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "font-medium transition-colors duration-300",
                    item.kind === "done" && "text-ok",
                    item.kind === "running" && "text-ink",
                    item.kind === "warn" && "text-warn",
                    item.kind === "error" && "text-danger",
                    item.kind === "info" && "text-ink-muted",
                  )}
                >
                  {item.label}
                </span>
                {item.detail && (
                  <span className="ml-1 text-ink-muted">{"\u2014"} {item.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status footer */}
      {isWorking && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-ink-muted animate-pulse">Working...</span>
          {doneCount > 0 && <span className="text-[10px] text-ink-muted">{doneCount}/{totalEstimate} steps</span>}
        </div>
      )}
    </div>
  );
}

/** System plan card — shows what copilot understood and proposes to build */
function SystemPlanView({ plan, onBuild }: { plan: SystemPlanResult; onBuild?: () => void }) {
  return (
    <div className="rounded-xl border border-violet-400/30 bg-gradient-to-b from-violet-500/5 to-transparent p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
        <div>
          <p className="text-xs font-semibold text-ink">I understand what you're building</p>
          <p className="mt-1 text-[11px] text-ink-muted leading-relaxed">{plan.summary}</p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {plan.capabilities.map((cap, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="text-sm">{PRODUCT_ICONS[cap.product] || "\ud83d\udce6"}</span>
            <span className="font-medium text-ink capitalize">{cap.product}</span>
            <span className="text-ink-muted">{"\u2014"} {cap.description}{cap.app_hint ? ` (${cap.app_hint})` : ""}</span>
          </div>
        ))}
      </div>
      {plan.needs_connections.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-500/5 p-2">
          <p className="text-[11px] font-medium text-amber-700">Connections needed:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.needs_connections.map((c) => (
              <span key={c} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">{c}</span>
            ))}
          </div>
        </div>
      )}
      {plan.recommended_actions.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">I'll create</p>
          <ul className="mt-1 space-y-0.5">
            {plan.recommended_actions.map((action, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[11px] text-ink">
                <Check className="h-3 w-3 text-ok" />{action}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-ink-muted">Entry: <span className="font-medium text-ink">{plan.entry_surface.replace(/_/g, " ")}</span></span>
        <span className="text-[10px] text-ink-muted">Confidence: <span className="font-medium text-ink">{Math.round(plan.confidence * 100)}%</span></span>
      </div>
      {onBuild && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="h-7 text-[11px]" onClick={onBuild}>
            <Play className="mr-1 h-3 w-3" /> Build system
          </Button>
        </div>
      )}
    </div>
  );
}

function BadgeIcon({ type }: { type?: string }) {
  switch (type) { case "zap": return <Zap className="h-2.5 w-2.5" />; case "check": return <Check className="h-2.5 w-2.5" />; case "arrow": return <ArrowRight className="h-2.5 w-2.5" />; case "pencil": return <Pencil className="h-2.5 w-2.5" />; case "alert": return <AlertCircle className="h-2.5 w-2.5" />; default: return <Sparkles className="h-2.5 w-2.5" />; }
}

function OperationCardView({ card, onSend }: { card: OperationCard; onSend?: (prompt: string) => void }) {
  return (
    <div className={cn("rounded-xl border p-3 text-xs", card.status === "completed" ? "border-ok/30 bg-ok/5" : card.status === "failed" ? "border-danger/30 bg-danger/5" : "border-teal/30 bg-teal-soft/10")}>
      <div className="flex items-center gap-2">
        {card.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-teal" />}
        {card.status === "completed" && <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ok text-[8px] text-white">{"\u2713"}</div>}
        {card.status === "failed" && <AlertCircle className="h-3.5 w-3.5 text-danger" />}
        <span className="font-semibold text-ink">{card.title}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {card.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            {step.status === "completed" && <div className="h-2 w-2 rounded-full bg-ok" />}
            {step.status === "running" && <Loader2 className="h-2 w-2 animate-spin text-teal" />}
            {step.status === "failed" && <div className="h-2 w-2 rounded-full bg-danger" />}
            {step.status === "pending" && <div className="h-2 w-2 rounded-full bg-ink-muted/30" />}
            <span className={cn(step.status === "completed" ? "text-ok" : step.status === "running" ? "text-ink font-medium" : step.status === "failed" ? "text-danger" : "text-ink-muted")}>{step.status === "completed" ? "\u2713 " : step.status === "running" ? "\u2192 " : step.status === "failed" ? "\u2717 " : "\u25CB "}{step.label}</span>
            {step.detail && <span className="text-ink-muted/70">{"\u2014"} {step.detail}</span>}
          </div>
        ))}
      </div>
      {card.actions && card.actions.length > 0 && (<div className="mt-2 flex flex-wrap gap-1.5">{card.actions.map((action, i) => (<button key={i} type="button" className="rounded-full border border-teal/30 bg-teal-soft/20 px-2 py-0.5 text-[10px] font-medium text-teal transition hover:bg-teal-soft/40 active:scale-95" onClick={() => onSend?.(action.prompt)}>{action.label}</button>))}</div>)}
    </div>
  );
}

/** Step card — shows a workflow step with status and issues */
function StepCardView({ card, onSend }: { card: StepCard; onSend?: (prompt: string) => void }) {
  const statusColors = {
    configured: "border-ok/30 bg-ok/5",
    needs_config: "border-amber-300/30 bg-amber-500/5",
    needs_connection: "border-amber-300/30 bg-amber-500/5",
    needs_action: "border-line bg-muted/20",
    tested: "border-ok/30 bg-ok/5",
  };
  const statusIcons = {
    configured: <Check className="h-3 w-3 text-ok" />,
    needs_config: <AlertTriangle className="h-3 w-3 text-amber-600" />,
    needs_connection: <AlertTriangle className="h-3 w-3 text-amber-600" />,
    needs_action: <AlertCircle className="h-3 w-3 text-ink-muted" />,
    tested: <Check className="h-3 w-3 text-ok" />,
  };
  const statusLabels = {
    configured: "Configured",
    needs_config: "Needs configuration",
    needs_connection: "Account required",
    needs_action: "Needs an action",
    tested: "Tested",
  };
  return (
    <div className={cn("rounded-xl border p-3 text-xs", statusColors[card.status])}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-ink">Step {card.index}</span>
        <span className="font-medium text-ink">{card.label}</span>
        {card.app && <span className="text-ink-muted">({card.app})</span>}
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          {statusIcons[card.status]}
          <span className="text-ink-muted">{statusLabels[card.status]}</span>
        </span>
      </div>
      {card.issues && card.issues.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {card.issues.map((issue, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />{issue}
            </div>
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.actions.map((action, i) => (
            <button key={i} type="button" className="rounded-full border border-teal/30 bg-teal-soft/20 px-2 py-0.5 text-[10px] font-medium text-teal transition hover:bg-teal-soft/40 active:scale-95" onClick={() => onSend?.(action.prompt)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Connection card — shows authentication status with connect action */
function ConnectionCardView({ card, onSend }: { card: ConnectionCard; onSend?: (prompt: string) => void }) {
  return (
    <div className={cn("rounded-xl border p-3 text-xs", card.status === "connected" ? "border-ok/30 bg-ok/5" : "border-amber-300/30 bg-amber-500/5")}>
      <div className="flex items-center gap-2">
        {card.status === "connected" ? (
          <Check className="h-3.5 w-3.5 text-ok" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        )}
        <span className="font-medium text-ink">{card.appName}</span>
        <span className="text-ink-muted">{card.status === "connected" ? "Connected" : "Not connected"}</span>
      </div>
      {card.message && <p className="mt-1 text-[11px] text-ink-muted">{card.message}</p>}
      {card.actions && card.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.actions.map((action, i) => (
            <button key={i} type="button" className="rounded-full border border-teal/30 bg-teal-soft/20 px-2 py-0.5 text-[10px] font-medium text-teal transition hover:bg-teal-soft/40 active:scale-95" onClick={() => onSend?.(action.prompt)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Field mapping card — shows suggested field mappings */
function FieldMappingView({ card }: { card: FieldMappingCard }) {
  return (
    <div className="rounded-xl border border-line bg-muted/20 p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Field Mapping</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-ink-muted">{card.sourceLabel}</p>
          <ul className="mt-0.5 space-y-0.5">
            {card.sourceFields.map((f, i) => (
              <li key={i} className="text-[11px] text-ink">{f}</li>
            ))}
          </ul>
        </div>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-teal" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-ink-muted">{card.targetLabel}</p>
          <ul className="mt-0.5 space-y-0.5">
            {card.targetFields.map((f, i) => (
              <li key={i} className="text-[11px] text-ink">{f}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Test result card — shows step test output */
function TestResultView({ card, onSend }: { card: TestResultCard; onSend?: (prompt: string) => void }) {
  return (
    <div className={cn("rounded-xl border p-3 text-xs", card.success ? "border-ok/30 bg-ok/5" : "border-danger/30 bg-danger/5")}>
      <div className="flex items-center gap-2">
        {card.success ? <Check className="h-3.5 w-3.5 text-ok" /> : <AlertCircle className="h-3.5 w-3.5 text-danger" />}
        <span className="font-medium text-ink">{card.stepLabel}</span>
        <span className="text-ink-muted">{card.success ? "Passed" : "Failed"}</span>
      </div>
      {card.fields && Object.keys(card.fields).length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(card.fields).slice(0, 6).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-ink-muted truncate">{key}</span>
              <span className="text-[11px] text-ink truncate">{String(value).slice(0, 40)}</span>
            </div>
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.actions.map((action, i) => (
            <button key={i} type="button" className="rounded-full border border-teal/30 bg-teal-soft/20 px-2 py-0.5 text-[10px] font-medium text-teal transition hover:bg-teal-soft/40 active:scale-95" onClick={() => onSend?.(action.prompt)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionBadges({ badges, onSelect }: { badges: SuggestionBadge[]; onSelect: (prompt: string) => void }) {
  return (<div className="flex flex-wrap gap-1.5">{badges.map((badge) => (<button key={badge.label} type="button" className="inline-flex items-center gap-1 rounded-full border border-line bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink transition-all hover:border-teal/50 hover:bg-teal-soft/20 hover:text-teal active:scale-95" onClick={() => onSelect(badge.prompt)}><BadgeIcon type={badge.icon} />{badge.label}</button>))}</div>);
}

function ClarificationView({ clarification, onSelect }: { clarification: Clarification; onSelect: (prompt: string) => void }) {
  return (
    <div className="rounded-xl border border-violet-400/30 bg-violet-500/5 p-3">
      <div className="flex items-start gap-2"><MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" /><p className="text-xs font-medium text-ink">{clarification.question}</p></div>
      <div className="mt-2 space-y-1">{clarification.options.map((option) => (<button key={option.label} type="button" className="flex w-full items-center gap-2 rounded-lg border border-line bg-elevated p-2 text-left text-[11px] transition-all hover:border-violet-400/40 hover:bg-violet-500/5 active:scale-[0.98]" onClick={() => onSelect(option.prompt)}><ChevronRight className="h-3 w-3 shrink-0 text-violet-600" /><div><span className="font-medium text-ink">{option.label}</span>{option.description && <span className="ml-1.5 text-ink-muted">{option.description}</span>}</div></button>))}</div>
    </div>
  );
}

/** Typed action buttons — handles real UI actions, not just chat prompts */
function ActionButtons({ actions, onSend }: { actions: Array<{ type: string; label: string; prompt?: string; href?: string; appSlug?: string; stepId?: string }>; onSend?: (prompt: string) => void }) {
  const iconMap: Record<string, React.ReactNode> = {
    connect_account: <Zap className="h-2.5 w-2.5" />,
    choose_app: <ChevronRight className="h-2.5 w-2.5" />,
    choose_action: <ChevronRight className="h-2.5 w-2.5" />,
    test_step: <Play className="h-2.5 w-2.5" />,
    test_workflow: <Play className="h-2.5 w-2.5" />,
    add_step: <Plus className="h-2.5 w-2.5" />,
    remove_step: <X className="h-2.5 w-2.5" />,
    select_step: <CircleDot className="h-2.5 w-2.5" />,
    retry: <RotateCcw className="h-2.5 w-2.5" />,
    prompt: <Sparkles className="h-2.5 w-2.5" />,
    navigate: <ArrowRight className="h-2.5 w-2.5" />,
  };
  const colorMap: Record<string, string> = {
    connect_account: "border-amber-300/50 bg-amber-100/50 text-amber-700 hover:bg-amber-100",
    choose_app: "border-teal/30 bg-teal-soft/20 text-teal hover:bg-teal-soft/40",
    choose_action: "border-teal/30 bg-teal-soft/20 text-teal hover:bg-teal-soft/40",
    test_step: "border-ok/30 bg-ok/10 text-ok hover:bg-ok/20",
    test_workflow: "border-ok/30 bg-ok/10 text-ok hover:bg-ok/20",
    add_step: "border-violet-300/30 bg-violet-500/5 text-violet-600 hover:bg-violet-500/10",
    remove_step: "border-danger/30 bg-danger/5 text-danger hover:bg-danger/10",
    retry: "border-amber-300/30 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10",
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action, i) => {
        const icon = iconMap[action.type] || iconMap.prompt;
        const colors = colorMap[action.type] || "border-teal/30 bg-teal-soft/20 text-teal hover:bg-teal-soft/40";
        return (
          <button
            key={i}
            type="button"
            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all active:scale-95", colors)}
            onClick={() => {
              if (action.type === "navigate" && action.href) {
                window.open(action.href, "_blank");
              } else if (action.type === "connect_account" && action.appSlug) {
                onSend?.(`Connect my ${action.appSlug} account`);
              } else if (action.type === "test_step" && action.stepId) {
                onSend?.(`Test step ${action.stepId}`);
              } else if (action.type === "test_workflow") {
                onSend?.("Test this workflow");
              } else if (action.type === "add_step") {
                onSend?.("Add the next step");
              } else if (action.type === "remove_step" && action.stepId) {
                onSend?.(`Remove step ${action.stepId}`);
              } else if (action.type === "select_step" && action.stepId) {
                onSend?.(`Select step ${action.stepId}`);
              } else if (action.type === "retry") {
                onSend?.("Retry");
              } else if (action.prompt) {
                onSend?.(action.prompt);
              }
            }}
          >
            {icon}{action.label}
          </button>
        );
      })}
    </div>
  );
}

/** Render the assistant text with chain-of-thought stripped */
function AgentMessage({ text, onSend }: { text: string; onSend?: (prompt: string) => void }) {
  const cleaned = stripChainOfThought(text);
  if (!cleaned) return null;
  const lines = cleaned.split("\n");
  const buttons: Array<{ label: string; prompt?: string }> = [];
  const textLines: string[] = [];
  for (const line of lines) { const m = line.trim().match(/^\[([^(]+)\](?:\(([^)]+)\))?$/); if (m) { buttons.push({ label: m[1].trim(), prompt: m[2]?.trim() }); } else { textLines.push(line); } }
  const displayText = textLines.join("\n").trim();
  return (
    <div className="space-y-2">
      {displayText && (<div className="min-w-0 break-words rounded-2xl rounded-tl-md border border-line bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">{displayText}</div>)}
      {buttons.length > 0 && onSend && (<div className="flex flex-wrap gap-1.5 pl-1">{buttons.map((btn) => (<button key={btn.label} type="button" className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal-soft/30 px-2.5 py-1 text-[11px] font-medium text-teal transition-all hover:bg-teal-soft/50 active:scale-95" onClick={() => onSend(btn.prompt || btn.label)}>{btn.label}</button>))}</div>)}
    </div>
  );
}

/** Thinking/reasoning block — only shown when explicitly expanded via details element */
function ThinkingBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="rounded-lg border border-line bg-muted/10 text-[11px] transition-all open:border-violet-400/30 open:bg-violet-500/[0.02]">
      <summary className="cursor-pointer select-none px-3 py-1.5 font-medium text-ink-muted hover:text-ink flex items-center gap-1.5">
        <CircleDot className="h-3 w-3 text-ink-muted/50" />
        Details
      </summary>
      <div className="border-t border-line px-3 py-2">
        <p className="leading-relaxed text-ink-muted whitespace-pre-wrap">{text}</p>
      </div>
    </details>
  );
}

/** Copy button for assistant messages */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="rounded-md p-1 text-ink-muted/50 hover:text-ink-muted transition-colors" title="Copy response" onClick={handleCopy}>
      {copied ? <CheckCheck className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Main CopilotPanel ───────────────────────────────────────────────────────

export function CopilotPanel({ automationId, open, modal, onOpenModal, building, draftConfigured, draftOutline: _draftOutline, firstHumanAction, mode, onModeChange, reasoning: _reasoning, showReasoning: _showReasoning, onToggleReasoning: _onToggleReasoning, stages: _stages, todos: _todos, planeHint: _planeHint, onClose, onExpand, onBuild, onStop, onChat, streamChat, onApply, onRevert, onCheckpoint, incomingPrompt, onIncomingPromptHandled }: { automationId: string; open: boolean; building: boolean; draftConfigured: boolean; draftOutline?: string; firstHumanAction?: string; mode: CopilotMode; onModeChange: (mode: CopilotMode) => void; reasoning: string; showReasoning: boolean; onToggleReasoning: () => void; stages: Activity[]; todos: CopilotTodo[]; modal?: boolean; onOpenModal?: () => void; planeHint?: string; onClose: () => void; onExpand: () => void; onCheckpoint: () => void; onBuild: (prompt: string) => void | Promise<{ graph?: unknown; summary?: string; rebuilt?: boolean; changed?: boolean } | void>; onStop: () => void; onChat: (prompt: string) => Promise<ChatResult>; streamChat?: (prompt: string, onEvent: (ev: Record<string, unknown>) => void, signal?: AbortSignal) => Promise<ChatResult>; onApply: (graph: unknown, sessionId?: string) => void | Promise<void>; onRevert: () => void; incomingPrompt?: string | null; onIncomingPromptHandled?: () => void }) {
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
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [agentTitle, setAgentTitle] = useState("");
  const [liveActivities, setLiveActivities] = useState<AgentActivityItem[]>([]);
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width); widthRef.current = width;
  const actId = useRef(0);

  useEffect(() => {
    setMsgs([]); setProposal(null); setProposalSessionId(undefined); setApproving(false);
    setCheckpoint(false); setInput(""); setMinimized(false); setHumanActionModal(false);
    setSuggestionsOpen(false); setAgentState("idle"); setAgentTitle(""); setLiveActivities([]);
    try { const w = Number(localStorage.getItem("orchestra-copilot-width")); if (w >= MIN_W && w <= MAX_W) setWidth(w); } catch {}
  }, [automationId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, building, sending, liveActivities]);

  useEffect(() => {
    function move(e: MouseEvent) { if (!drag.current) return; const next = drag.current.startW + (e.clientX - drag.current.startX); if (next < SNAP_MIN) { drag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; setMinimized(true); return; } setWidth(Math.min(MAX_W, Math.max(MIN_W, next))); }
    function up() { if (!drag.current) return; drag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; try { localStorage.setItem("orchestra-copilot-width", String(widthRef.current)); } catch {} }
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const addActivity = useCallback((kind: AgentActivityKind, label: string, detail?: string) => {
    actId.current += 1;
    const item: AgentActivityItem = { id: `act-${actId.current}`, kind, label, detail, timestamp: Date.now() };
    setLiveActivities((prev) => [...prev, item]);
    return item.id;
  }, []);

  const updateActivity = useCallback((id: string, kind: AgentActivityKind, detail?: string) => {
    setLiveActivities((prev) => prev.map((item) => item.id === id ? { ...item, kind, detail: detail ?? item.detail } : item));
  }, []);

  async function send(kind: "auto" | "chat" | "build", requestedPrompt?: string) {
    const prompt = (requestedPrompt ?? input).trim(); if (!prompt) return;
    setMsgs((m) => [...m, { role: "user", text: prompt }]); setInput(""); setSuggestionsOpen(false);
    const emptyCanvas = !draftConfigured; const useBuild = emptyCanvas && kind !== "chat";

    if (useBuild) {
      setAgentState("executing"); setAgentTitle("Building workflow"); setLiveActivities([]); actId.current = 0;
      try {
        const result = await onBuild(prompt);
        setLiveActivities((prev) => [...prev.map((a) => ({ ...a, kind: "done" as AgentActivityKind })), { id: `act-${++actId.current}`, kind: "done", label: "Workflow built", detail: "Draft ready for review", timestamp: Date.now() }]);
        setAgentState("completed"); setAgentTitle("Workflow ready");
        setMsgs((m) => { const summary = result && "summary" in result && result.summary ? String(result.summary) : "Outlined a draft. Connect anything I cannot do, test a step, then publish."; return [...m, { role: "assistant", text: summary, activities: [...liveActivities], agentState: "completed", agentTitle: "Workflow ready", operations: [{ title: "Workflow built", steps: [{ label: "Analyzed request", status: "completed" }, { label: "Planned steps", status: "completed" }, { label: "Created nodes", status: "completed" }, { label: "Connected steps", status: "completed" }], status: "completed", actions: [{ label: "Test workflow", prompt: "Test this workflow" }, { label: "Add a step", prompt: "Add the next step" }] }] }]; });
      } catch (err) { setAgentState("error"); setAgentTitle("Build failed"); addActivity("error", "Build failed", err instanceof Error ? err.message : "Unknown error"); setMsgs((m) => [...m, { role: "assistant", text: err instanceof Error ? err.message : "Copilot is unavailable." }]); }
      return;
    }

    setSending(true); setAgentState("understanding"); setAgentTitle("Working...");
    setLiveActivities([]); actId.current = 0;

    if (streamChat) {
      let streamingOps: OperationCard[] = [];
      let thinkingText = "";
      try {
        const abortCtrl = new AbortController();
        const result = await streamChat(prompt, (ev) => {
          if (ev.type === "agent_state") { setAgentState(ev.state as AgentState); if (ev.title) setAgentTitle(ev.title as string); }
          if (ev.type === "agent_activity") { const kind = (ev.kind as AgentActivityKind) || "info"; if (ev.id) updateActivity(ev.id as string, kind, ev.detail as string | undefined); else addActivity(kind, ev.label as string, ev.detail as string | undefined); }
          if (ev.type === "step_completed") addActivity(ev.success ? "done" : "error", ev.label as string, ev.detail as string | undefined);
          if (ev.type === "blocking_issue") addActivity("warn", ev.title as string, ev.detail as string | undefined);
          if (ev.type === "test_result") addActivity(ev.success ? "done" : "warn", `Tested ${ev.label}`, ev.success ? "Passed" : "Failed");
          if (ev.type === "operation_card" && ev.operation) { streamingOps = [ev.operation as OperationCard]; setMsgs((m) => { const last = m[m.length - 1]; if (last && last.role === "assistant" && last.text === "") return [...m.slice(0, -1), { ...last, operations: [...streamingOps] }]; return [...m, { role: "assistant", text: "", operations: [...streamingOps] }]; }); }
          if (ev.type === "stage") { addActivity("done", (ev.label ?? ev.stage ?? "Working") as string); }
          if (ev.type === "reasoning" && ev.text) { const txt = String(ev.text); if (txt.length > 5) { const summary = reasoningToActivity(txt); addActivity("done", summary); } }
          if (ev.type === "analysis_summary" && ev.title && Array.isArray(ev.items)) { const title = String(ev.title); const items = ev.items as string[]; addActivity("done", title); items.forEach((item) => addActivity("done", `  ${item}`)); }
          if (ev.type === "connection_required") { const appName = String(ev.appName || ev.appSlug || "App"); const msg = ev.message ? String(ev.message) : "Connect your account to continue"; addActivity("warn", `${appName} needs authentication`, msg); }
          if (ev.type === "field_mapping") { const src = String(ev.sourceLabel || "Source"); const tgt = String(ev.targetLabel || "Target"); addActivity("done", "Field mapping", `${src} \u2192 ${tgt}`); }
          if (ev.type === "chat_result") {
            const cr = ev as Record<string, unknown>;
            if (Array.isArray(cr.stepCards)) {
              setMsgs((m) => { const last = m[m.length - 1]; if (last && last.role === "assistant") return [...m.slice(0, -1), { ...last, stepCards: cr.stepCards as StepCard[] }]; return m; });
            }
            if (Array.isArray(cr.connectionCards)) {
              setMsgs((m) => { const last = m[m.length - 1]; if (last && last.role === "assistant") return [...m.slice(0, -1), { ...last, connectionCards: cr.connectionCards as ConnectionCard[] }]; return m; });
            }
            if (Array.isArray(cr.warnings)) {
              setMsgs((m) => { const last = m[m.length - 1]; if (last && last.role === "assistant") return [...m.slice(0, -1), { ...last, warnings: cr.warnings as string[] }]; return m; });
            }
          }
        }, abortCtrl.signal);
        const hasSuggestion = Boolean(result.graph || result.preview);
        setAgentState("completed"); setAgentTitle("Done");
        setLiveActivities((prev) => prev.map((a) => a.kind === "running" ? { ...a, kind: "done" as AgentActivityKind } : a));
        setMsgs((m) => { const fa = liveActivities.map((a) => a.kind === "running" ? { ...a, kind: "done" as AgentActivityKind } : a); const last = m[m.length - 1]; const msg: Msg = { role: "assistant", text: result.reply, workflowPreview: result.preview, suggestion: hasSuggestion, applied: Boolean(result.graph && result.applied), suggestions: result.suggestions, operations: result.operations?.length ? result.operations : streamingOps, clarification: result.clarification, activities: fa, agentState: "completed", agentTitle: "Done", stepCards: (result as Record<string, unknown>).stepCards as StepCard[] | undefined, connectionCards: (result as Record<string, unknown>).connectionCards as ConnectionCard[] | undefined, warnings: (result as Record<string, unknown>).warnings as string[] | undefined }; if (last && last.role === "assistant" && last.text === "") return [...m.slice(0, -1), { ...msg, stepCards: msg.stepCards || last.stepCards, connectionCards: msg.connectionCards || last.connectionCards, warnings: msg.warnings || last.warnings }]; return [...m, msg]; });
        if (result.graph && result.applied) {
          setCheckpoint(true);
          void onApply(result.graph, result.sessionId);
        } else if (result.graph) {
          setProposal(result.graph); setProposalSessionId(result.sessionId);
        }
      } catch (err) { setAgentState("error"); setAgentTitle("Error"); addActivity("error", "Request failed", err instanceof Error ? err.message : "Unknown error"); setMsgs((m) => [...m, { role: "assistant", text: err instanceof Error ? err.message : "Copilot is unavailable." }]); }
      finally { setSending(false); }
    } else {
      try {
        const result = await onChat(prompt);
        const hasSuggestion = Boolean(result.graph || result.preview);
        setAgentState("completed"); setAgentTitle("Done");
        setMsgs((m) => [...m, { role: "assistant", text: result.reply, workflowPreview: result.preview, suggestion: hasSuggestion, applied: Boolean(result.graph && result.applied), suggestions: result.suggestions, operations: result.operations, clarification: result.clarification, stepCards: result.stepCards, connectionCards: result.connectionCards, warnings: result.warnings }]);
        if (result.graph && result.applied) {
          setCheckpoint(true);
          void onApply(result.graph, result.sessionId);
        } else if (result.graph) {
          setProposal(result.graph); setProposalSessionId(result.sessionId);
        }
      } catch (err) { setAgentState("error"); setAgentTitle("Error"); setMsgs((m) => [...m, { role: "assistant", text: err instanceof Error ? err.message : "Copilot is unavailable." }]); }
      finally { setSending(false); }
    }
  }

  /** Edit a user message and re-send it */
  function startEdit(idx: number, text: string) { setEditingMsgIdx(idx); setEditingText(text); }
  function cancelEdit() { setEditingMsgIdx(null); setEditingText(""); }
  function submitEdit() {
    if (editingMsgIdx === null || !editingText.trim()) return;
    const idx = editingMsgIdx;
    cancelEdit();
    setMsgs((m) => m.slice(0, idx));
    setTimeout(() => { void send("chat", editingText.trim()); }, 50);
  }

  useEffect(() => { if (!incomingPrompt?.trim()) return; const p = incomingPrompt.trim(); onIncomingPromptHandled?.(); void send("chat", p); }, [incomingPrompt]);

  const empty = msgs.length === 0 && !building && !sending;
  const collapsed = !open || minimized;
  if (collapsed) return <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-line bg-elevated py-2"><button type="button" className="rounded-lg p-2 text-violet-600 hover:bg-muted" title="Expand Copilot" onClick={() => { setMinimized(false); onExpand(); }}><PanelLeftOpen className="h-5 w-5" /></button><Sparkles className="mt-2 h-4 w-4 text-violet-600" /></aside>;

  const isWorking = building || sending;

  return (
    <aside className="relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-line bg-elevated" style={{ width }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="relative flex h-11 min-w-0 items-center gap-1 border-b border-line px-2">
        <span className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-sm shadow-violet-600/20"><Sparkles className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-none">Copilot</p>
          <p className="mt-0.5 text-[10px] text-ink-muted">
            {isWorking ? <span className="text-teal font-medium">Working...</span> : agentState === "completed" ? <span className="text-ok">Ready</span> : "AI-powered assistant"}
          </p>
        </div>
        {draftConfigured && <button type="button" className={cn("relative rounded-lg p-1.5 transition", suggestionsOpen ? "bg-violet-600 text-white" : "text-ink-muted hover:bg-muted")} title="Suggestions" onClick={() => setSuggestionsOpen((v) => !v)}><Lightbulb className="h-4 w-4" /><span className="absolute -right-0.5 -top-0.5 flex h-2 w-2 rounded-full bg-teal" /></button>}
        {!modal && <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Open Copilot in overlay" onClick={() => onOpenModal?.()}><Maximize2 className="h-4 w-4" /></button>}
        {!modal && <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Minimize" onClick={() => setMinimized(true)}><PanelLeftClose className="h-4 w-4" /></button>}
        <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Checkpoint" onClick={() => { onCheckpoint(); setCheckpoint(true); }}><History className="h-4 w-4" /></button>
        <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="New chat" onClick={() => { setMsgs([]); setAgentState("idle"); setAgentTitle(""); setLiveActivities([]); }}><Plus className="h-4 w-4" /></button>
        <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Settings" onClick={() => setSettingsOpen((v) => !v)}><Settings className="h-4 w-4" /></button>
        {firstHumanAction ? <button type="button" className="rounded-lg p-1.5 text-warn hover:bg-warn/10" title="Action needed" onClick={() => setHumanActionModal(true)}><AlertTriangle className="h-4 w-4" /></button> : null}
        <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose} aria-label="Close Copilot"><X className="h-4 w-4" /></button>
        {suggestionsOpen && draftConfigured && <div className="absolute right-9 top-12 z-50 w-72 rounded-xl border border-line bg-elevated p-2 shadow-card"><div className="flex items-center gap-2 border-b border-line px-2 pb-2"><Lightbulb className="h-3.5 w-3.5 text-violet-600" /><div><p className="text-xs font-semibold text-ink">Suggestions</p><p className="text-[10px] text-ink-muted">Actions for the workflow you already selected</p></div></div><div className="mt-2 grid gap-1">{["Test this workflow", "Explain this workflow", "Add the next step", "Add a branch after this step", "Fill this step", "Map fields between steps", "Check my connections", "Validate this workflow"].map((s) => <button key={s} type="button" className="rounded-lg px-2.5 py-2 text-left text-[11px] text-ink transition hover:bg-muted hover:text-violet-700" onClick={() => void send("chat", s)}>{s}</button>)}</div></div>}
      </div>

      {settingsOpen && <div className="space-y-2 border-b border-line bg-muted/40 px-3 py-2 text-[11px] text-ink-muted"><p>Patches apply as you go, or wait until you confirm. Copilot never publishes or creates accounts.</p><div className="flex gap-1">{([["auto_build", "Apply as I go"], ["ask_as_you_build", "Suggest first"]] as const).map(([value, label]) => <button key={value} type="button" className={cn("rounded-full px-2 py-1", mode === value ? "bg-violet-600 text-white" : "bg-muted")} onClick={() => onModeChange(value)}>{label}</button>)}</div></div>}

      {/* ── Messages ───────────────────────────────────────────────── */}
      <div ref={scroller} className="av-hide-scroll min-h-0 min-w-0 flex-1 overflow-y-auto space-y-1 px-3 pt-3 pb-3 text-sm">
        {empty && <div className="space-y-3"><div className="rounded-2xl border border-teal/30 bg-teal-soft/20 p-3"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-teal" /><p className="text-sm font-semibold text-ink">{draftConfigured ? "Ask about this workflow" : "What should we automate?"}</p></div><p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{draftConfigured ? "Ask Copilot to modify or improve the workflow you already selected." : "Describe your goal and Copilot will help build the workflow."}</p></div><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{draftConfigured ? "Workflow actions" : "Quick start ideas"}</p><SuggestionBadges badges={draftConfigured ? WORKFLOW_PROMPTS : EMPTY_CANVAS_PROMPTS} onSelect={(p) => { setInput(p); }} /></div></div>}

        {/* Live build pipeline (only while working) */}
        {isWorking && (
          <BuildPipeline activities={liveActivities} agentState={agentState} agentTitle={agentTitle} />
        )}

        {/* Chat messages with clear user/assistant spacing */}
        {msgs.map((m, i) => (
          <div key={i} className={cn("relative group", m.role === "user" ? "mt-3 mb-1" : "mt-1 mb-3")}>
            {m.role === "user" ? (
              <div className="flex items-start gap-2 justify-end">
                <div className="min-w-0 max-w-[85%]">
                  {editingMsgIdx === i ? (
                    <div className="rounded-2xl rounded-tr-md border border-violet-400 bg-violet-500/5 p-2">
                      <textarea className="w-full min-h-[40px] resize-none rounded-lg bg-transparent text-[13px] text-ink outline-none" value={editingText} onChange={(e) => setEditingText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); } if (e.key === "Escape") cancelEdit(); }} autoFocus />
                      <div className="flex justify-end gap-1 mt-1">
                        <button type="button" className="rounded-md px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted" onClick={cancelEdit}>Cancel</button>
                        <button type="button" className="rounded-md px-2 py-0.5 text-[10px] font-medium text-violet-600 hover:bg-violet-100" onClick={submitEdit}>Send</button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl rounded-tr-md bg-violet-600 px-3 py-2 text-[13px] text-white shadow-sm">
                      {m.text}
                    </div>
                  )}
                </div>
                {editingMsgIdx !== i && !isWorking && (
                  <button type="button" className="mt-1 rounded-md p-1 text-ink-muted/0 group-hover:text-ink-muted/50 hover:!text-ink-muted transition-all" title="Edit message" onClick={() => startEdit(i, m.text)}>
                    <EditIcon className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-violet-500 text-white mt-0.5 shadow-sm">
                  <Sparkles className="h-3 w-3" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Thinking (below request, above response) */}
                  {m.thinking && <ThinkingBlock text={m.thinking} />}

                  {/* Main assistant message */}
                  <AgentMessage text={m.text} onSend={(p) => { setInput(p); void send("chat", p); }} />

                  {/* Operations */}
                  {m.operations && m.operations.length > 0 && <div className="space-y-2">{m.operations.map((op, j) => <OperationCardView key={j} card={op} onSend={(p) => { setInput(p); void send("chat", p); }} />)}</div>}

                  {/* Step cards */}
                  {m.stepCards && m.stepCards.length > 0 && <div className="space-y-2">{m.stepCards.map((card, j) => <StepCardView key={j} card={card} onSend={(p) => { setInput(p); void send("chat", p); }} />)}</div>}

                  {/* Connection cards */}
                  {m.connectionCards && m.connectionCards.length > 0 && <div className="space-y-2">{m.connectionCards.map((card, j) => <ConnectionCardView key={j} card={card} onSend={(p) => { setInput(p); void send("chat", p); }} />)}</div>}

                  {/* Field mappings */}
                  {m.fieldMappings && m.fieldMappings.length > 0 && <div className="space-y-2">{m.fieldMappings.map((card, j) => <FieldMappingView key={j} card={card} />)}</div>}

                  {/* Test results */}
                  {m.testResults && m.testResults.length > 0 && <div className="space-y-2">{m.testResults.map((card, j) => <TestResultView key={j} card={card} onSend={(p) => { setInput(p); void send("chat", p); }} />)}</div>}

                  {/* Warnings */}
                  {m.warnings && m.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-500/5 p-3 text-xs">
                      {m.warnings.map((w, i) => (
                        <div key={i} className="flex items-center gap-2 text-amber-700">
                          <AlertTriangle className="h-3 w-3 shrink-0" /><span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Clarification */}
                  {m.clarification && <ClarificationView clarification={m.clarification} onSelect={(p) => { setInput(p); void send("chat", p); }} />}

                  {/* Suggestions */}
                  {m.suggestions && m.suggestions.length > 0 && <SuggestionBadges badges={m.suggestions} onSelect={(p) => { setInput(p); void send("chat", p); }} />}

                  {/* System plan */}
                  {m.systemPlan && <SystemPlanView plan={m.systemPlan} />}
                  {m.workflowPreview?.steps.length ? <WorkflowPreview preview={m.workflowPreview} /> : null}

                  {/* Typed action buttons — derived from step/connection cards */}
                  {(() => {
                    const quickActions: Array<{ type: string; label: string; prompt?: string; appSlug?: string; stepId?: string }> = [];
                    if (m.connectionCards) {
                      m.connectionCards.filter((c) => c.status === "not_configured").forEach((c) => {
                        quickActions.push({ type: "connect_account", label: `Connect ${c.appName}`, appSlug: c.appSlug });
                      });
                    }
                    if (m.stepCards) {
                      m.stepCards.filter((s) => s.status === "needs_action" || s.status === "needs_config").forEach((s) => {
                        quickActions.push({ type: "test_step", label: `Test Step ${s.index}`, stepId: String(s.index) });
                      });
                      const hasConfigurable = m.stepCards.some((s) => s.status === "needs_config" || s.status === "needs_action");
                      if (hasConfigurable) {
                        quickActions.push({ type: "add_step", label: "Add step" });
                      }
                    }
                    if (quickActions.length === 0) return null;
                    return <div className="mt-1"><ActionButtons actions={quickActions} onSend={(p) => { setInput(p); void send("chat", p); }} /></div>;
                  })()}

                  {/* Applied badge + Copy button */}
                  <div className="flex items-center gap-2 mt-1">
                    {m.suggestion && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal-soft/30 px-2 py-0.5 text-[10px] font-medium text-teal">
                        <Sparkles className="h-2.5 w-2.5" /> Suggestion
                      </span>
                    )}
                    {m.applied && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">
                        <Check className="h-2.5 w-2.5" /> Applied to draft
                      </span>
                    )}
                    <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={m.text} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Proposal card */}
        {proposal !== null && <div className="rounded-xl border border-teal/40 bg-teal-soft/20 p-3 text-xs text-ink"><div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal-soft/40 px-2 py-1 text-[10px] font-semibold text-teal"><Sparkles className="h-2.5 w-2.5" /> Suggestion ready</span><span className="text-[10px] text-ink-muted">Review before applying</span></div><p className="mt-2">Copilot prepared a workflow change. Applying writes the draft {"\u2014"} it still does not publish.</p><Button size="sm" className="mt-2" disabled={approving} onClick={async () => { setApproving(true); try { await onApply(proposal, proposalSessionId); setCheckpoint(true); setProposal(null); setProposalSessionId(undefined); } finally { setApproving(false); } }}>{approving ? "Applying\u2026" : "Apply suggestion"}</Button></div>}

        {/* Checkpoint */}
        {checkpoint && <div className="flex items-center gap-2 text-xs text-ok mx-1"><Check className="h-3.5 w-3.5" /> Saved<button type="button" className="ml-auto inline-flex items-center gap-1 font-medium" onClick={() => { onRevert(); setCheckpoint(false); }}><RotateCcw className="h-3 w-3" /> Revert</button></div>}
      </div>

      {/* ── Input bar ──────────────────────────────────────────────── */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-muted/20 p-2 focus-within:border-teal transition-colors">
          <textarea className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none" placeholder={draftConfigured ? "Ask about this workflow..." : "Describe what to automate..."} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send("auto"); } }} />
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="rounded-lg p-1.5 text-ink-muted transition hover:bg-muted hover:text-violet-600" title="Get suggestions" onClick={() => { if (!input.trim()) { const s = ["Test this workflow", "Add a Slack notification", "Add a branch after this step", "Map fields between steps"]; setInput(s[Math.floor(Math.random() * s.length)]); } else { void send("chat"); } }} disabled={sending || building}><Lightbulb className="h-3.5 w-3.5" /></button>
            <Button size="sm" onClick={() => void send(draftConfigured ? "chat" : "build")} disabled={sending || building || !input.trim()} className="shadow-sm">{building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-ink-muted">AI-powered {"\u00b7"} review before publishing</p>
      </div>

      <button type="button" aria-label="Resize Copilot" className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize hover:bg-teal transition-colors" onMouseDown={(e) => { e.preventDefault(); drag.current = { startX: e.clientX, startW: width }; document.body.style.cursor = "ew-resize"; document.body.style.userSelect = "none"; }} />
      {humanActionModal && firstHumanAction && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={() => setHumanActionModal(false)}><div className="w-full max-w-md rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}><div className="mb-3 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100"><AlertTriangle className="h-4 w-4 text-warn" /></span><h2 className="text-base font-semibold">Action Required</h2></div><p className="text-sm leading-relaxed text-ink">{firstHumanAction}</p><p className="mt-2 text-xs text-ink-muted">Copilot can guide you, but this step requires your action.</p><div className="mt-5 flex justify-end"><Button size="sm" onClick={() => setHumanActionModal(false)}>Got it</Button></div></div></div>}
    </aside>
  );
}

export function CopilotReasoning({ show = false, text, onStop }: { show?: boolean; text?: string; onStop: () => void }) { if (!show) return null; return <div className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2"><div className="pointer-events-auto max-w-lg rounded-2xl border border-line bg-elevated px-3 py-2 shadow-card"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">C</span><span className="text-sm">Working{"\u2026"}</span><button type="button" className="ml-auto rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white" onClick={onStop}>Stop</button></div>{text && <p className="mt-2 max-h-24 overflow-auto text-[11px] leading-relaxed text-ink-muted">{text}</p>}</div></div>; }

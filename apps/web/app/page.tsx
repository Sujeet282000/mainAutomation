"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BarChart3, Bot, Check, CheckCircle2, FileInput, Globe, LayoutTemplate,
  Shield, Sparkles, Table2, Workflow, Zap, Mail, MessageSquare,
  Calendar, CreditCard, Database, GitBranch, Layers, Clock, Wrench, X,
} from "lucide-react";
import { Logo } from "@/features/shell/logo";
import { Button } from "@/components/ui/button";

/* ── Data ──────────────────────────────────────────────────────────────── */

const APPS = [
  { name: "Gmail", color: "EA4335", icon: Mail },
  { name: "Slack", color: "4A154B", icon: MessageSquare },
  { name: "Sheets", color: "34A853", icon: Table2 },
  { name: "Notion", color: "000000", icon: FileInput },
  { name: "HubSpot", color: "FF7A59", icon: Database },
  { name: "Stripe", color: "635BFF", icon: CreditCard },
  { name: "Salesforce", color: "00A1E0", icon: Globe },
  { name: "GitHub", color: "181717", icon: GitBranch },
  { name: "Discord", color: "5865F2", icon: MessageSquare },
  { name: "Airtable", color: "FCBF49", icon: Layers },
  { name: "Calendar", color: "4285F4", icon: Calendar },
  { name: "Webhooks", color: "7C3AED", icon: Zap },
];

const TEMPLATES = [
  { title: "Gmail → Slack", body: "Post a channel message when a labeled email arrives.", from: "Gmail", to: "Slack", color: "from-red-500 to-purple-600", apps: ["✉️", "💬"] },
  { title: "Form → Sheets", body: "Log every form response as a new spreadsheet row.", from: "Forms", to: "Sheets", color: "from-blue-500 to-green-500", apps: ["📝", "📊"] },
  { title: "Stripe → CRM", body: "Create or update a contact when a payment succeeds.", from: "Stripe", to: "HubSpot", color: "from-indigo-500 to-orange-400", apps: ["💳", "🧲"] },
  { title: "Schedule → AI → Email", body: "Summarize yesterday's runs and email the team each morning.", from: "Schedule", to: "Gmail", color: "from-amber-500 to-red-400", apps: ["⏰", "✦", "✉️"] },
  { title: "Sheets → Calendar", body: "Turn new spreadsheet rows into calendar events instantly.", from: "Sheets", to: "Calendar", color: "from-green-500 to-blue-500", apps: ["📊", "📅"] },
  { title: "Webhook → AI → Report", body: "Enrich incoming webhooks with AI and file a daily report.", from: "Webhook", to: "Notion", color: "from-violet-500 to-pink-500", apps: ["⚡", "✦", "📚"] },
];

const STEPS = [
  { n: "1", title: "Pick a trigger", body: "Choose the event that starts the workflow — a new email, form submission, webhook, or schedule.", icon: Zap, color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300", mock: ["✉️ Gmail", "⚡ Webhook", "⏰ Schedule", "📝 Form"] },
  { n: "2", title: "Add actions", body: "Connect Slack, Sheets, CRM, HTTP, or AI. Map fields with data from prior steps.", icon: Workflow, color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", mock: ["💬 Slack", "📊 Sheets", "✦ AI step", "🔀 Paths"] },
  { n: "3", title: "Test & publish", body: "Run a sample through every node, watch status icons, then turn it on.", icon: Sparkles, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", mock: ["✓ Step 1 ok", "✓ Step 2 ok", "✓ Step 3 ok", "🚀 Publish"] },
];

const FEATURES = [
  { icon: Workflow, title: "Visual builder", body: "Paths, loops, delays, filters, and drag-and-drop between steps — every node tests individually.", color: "text-violet-600", span: "lg:col-span-2", gradient: "from-violet-500/10 to-transparent" },
  { icon: Sparkles, title: "AI Copilot", body: "Describe the outcome in plain language. It proposes apps, events, and mappings for review.", color: "text-amber-500", span: "", gradient: "from-amber-500/10 to-transparent" },
  { icon: Bot, title: "AI steps & agents", body: "Extract, summarize, classify, and write in-line — or hand the job to a tool-using agent with approvals.", color: "text-blue-600", span: "", gradient: "from-blue-500/10 to-transparent" },
  { icon: Table2, title: "Tables & forms", body: "Native records, public forms, and submissions that start automations automatically.", color: "text-teal", span: "", gradient: "from-teal/10 to-transparent" },
  { icon: BarChart3, title: "Analytics", body: "Run volume, success rate, P95 latency, and top errors — computed in the database, not faked.", color: "text-pink-500", span: "", gradient: "from-pink-500/10 to-transparent" },
  { icon: Globe, title: "50+ integrations", body: "Gmail, Slack, Sheets, Stripe, HubSpot, Notion, plus a first-class HTTP connector for anything else.", color: "text-emerald-600", span: "lg:col-span-2", gradient: "from-emerald-500/10 to-transparent" },
];

const PLANS = [
  { name: "Free", price: "$0", detail: "5 workflows · 100 tasks/mo · 2 members", featured: false },
  { name: "Professional", price: "$29", detail: "2,000 tasks/mo · 10 members · Copilot", featured: true },
  { name: "Team", price: "$69", detail: "50,000 tasks/mo · extra seats · shared folders", featured: false },
];

const TESTIMONIALS = [
  { name: "Sarah Chen", role: "Ops Lead at Acme", quote: "We replaced 4 manual hours per day with one workflow. The Copilot built it in 3 minutes.", rating: 5 },
  { name: "Marcus Rivera", role: "Founder, NovaCRM", quote: "The visual builder is exactly what we needed. No code, full control, real tests before publish.", rating: 5 },
  { name: "Priya Sharma", role: "Growth at ScaleUp", quote: "Tables + Forms + Workflows in one product. Our lead pipeline runs itself now.", rating: 5 },
];

/* ── Hooks ─────────────────────────────────────────────────────────────── */

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function useStaggeredReveal(count: number, baseDelay = 80) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return {
    ref,
    visible,
    staggerDelay: (i: number) => ({ animationDelay: `${baseDelay + i * baseDelay}ms` }),
  };
}

/** Deterministic pseudo-random for SSR-stable particles. */
function seededRandom(seed: number) {
  let s = seed + 1;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function FloatingParticles({ count = 20 }: { count?: number }) {
  const particles = Array.from({ length: count }, (_, i) => {
    const rand = seededRandom(i * 7 + 42);
    return {
      id: i,
      left: `${rand() * 100}%`,
      top: `${rand() * 100}%`,
      size: 2 + rand() * 4,
      delay: rand() * 6,
      duration: 4 + rand() * 4,
      opacity: 0.15 + rand() * 0.25,
    };
  });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-violet-400"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animation: `particle-drift ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Mockup components (product-true "images") ─────────────────────────── */

function AnimatedWorkflow() {
  const nodes = [
    { label: "Gmail", sub: "New email", color: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40", icon: "✉️", x: 0 },
    { label: "AI", sub: "Classify", color: "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40", icon: "✦", x: 1 },
    { label: "Sheets", sub: "Add row", color: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40", icon: "📊", x: 2 },
    { label: "Slack", sub: "Notify", color: "border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/40", icon: "💬", x: 3 },
  ];
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {nodes.map((step, i) => (
        <div key={step.label} className="contents">
          <div
            className={`rounded-xl border p-2.5 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:p-3 ${step.color}`}
            style={{ animation: `float 3s ease-in-out ${i * 0.4}s infinite` }}
          >
            <span className="text-base sm:text-lg">{step.icon}</span>
            <p className="mt-1 text-[10px] font-semibold sm:text-[11px]">{step.label}</p>
            <p className="text-[8px] text-ink-muted sm:text-[9px]">{step.sub}</p>
          </div>
          {i < nodes.length - 1 && (
            <div className="relative flex items-center">
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-violet-400 sm:h-4 sm:w-4" />
              <div
                className="absolute left-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-violet-400 to-violet-600"
                style={{
                  width: 16,
                  animation: `data-flow 1s linear ${i * 0.3}s infinite`,
                  backgroundSize: "16px 2px",
                  backgroundImage: "repeating-linear-gradient(90deg, currentColor, currentColor 4px, transparent 4px, transparent 8px)",
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Full editor mockup — sidebar, canvas with animated success sweep,
 * inspector panel, and bottom test bar. This is the hero "screenshot".
 */
function EditorMockup() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % 6), 1400);
    return () => clearInterval(t);
  }, []);
  const lanes = ["Gmail · New email", "AI · Classify intent", "Sheets · Add row", "Slack · Notify #ops"];
  const nodeStates = lanes.map((_, i) => (stage > i ? "ok" : stage === i ? "running" : "idle"));

  return (
    <div className="animate-float-slow rounded-3xl border border-line bg-elevated p-1 shadow-2xl ring-1 ring-black/5">
      <div className="overflow-hidden rounded-2xl bg-muted/30">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 border-b border-line/60 px-4 py-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
          <div className="ml-3 flex-1 truncate rounded-md bg-bg px-3 py-1 text-[10px] text-ink-muted">flowship.app/automations/lead-router/editor</div>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Draft</span>
        </div>

        <div className="grid grid-cols-[52px_1fr_92px] sm:grid-cols-[64px_1fr_110px]">
          {/* Step library rail */}
          <div className="flex flex-col items-center gap-2.5 border-r border-line/60 px-2 py-3">
            {[Zap, Workflow, Sparkles, Table2, Clock, Bot].map((Icon, i) => (
              <span key={i} className="flex h-7 w-7 items-center justify-center rounded-lg bg-elevated text-ink-muted shadow-sm transition hover:scale-110 hover:text-violet-600">
                <Icon className="h-3.5 w-3.5" />
              </span>
            ))}
          </div>

          {/* Canvas */}
          <div className="space-y-1.5 px-3 py-3.5 sm:px-5">
            {lanes.map((label, i) => {
              const st = nodeStates[i];
              return (
                <div key={label}>
                  <div
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[10px] sm:text-[11px] transition-all duration-500 ${
                      st === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : st === "running" ? "border-violet-400 bg-violet-50 text-violet-800 shadow-md shadow-violet-500/10 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-200"
                      : "border-line bg-elevated text-ink-muted"
                    }`}
                    style={{ animation: st === "running" ? "none" : `float 4s ease-in-out ${i * 0.5}s infinite` }}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ${st === "ok" ? "bg-emerald-500" : st === "running" ? "bg-violet-500 animate-pulse" : "bg-slate-300 dark:bg-slate-600"}`}>
                      {st === "ok" ? "✓" : st === "running" ? "•" : i + 1}
                    </span>
                    <span className="truncate font-medium">{label}</span>
                    {st === "ok" && <span className="ml-auto text-[9px] text-emerald-600 dark:text-emerald-300">0.{3 + i}s</span>}
                  </div>
                  {i < lanes.length - 1 && <div className="ml-4 h-2.5 w-px bg-line" />}
                </div>
              );
            })}
            <div className="pt-1 text-center">
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                {stage >= 4 ? "✓ Test passed · 4 steps · 2.1s" : "Running test…"}
              </span>
            </div>
          </div>

          {/* Inspector */}
          <div className="hidden flex-col gap-1.5 border-l border-line/60 px-2 py-3 sm:flex">
            <p className="text-[8px] font-bold uppercase tracking-wider text-ink-muted">Inspector</p>
            {["Account", "Channel", "Message", "Test"].map((f, i) => (
              <div key={f} className={`rounded-md border px-1.5 py-1 text-[8px] ${i === 1 ? "border-violet-300 bg-violet-50 font-semibold text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : "border-line bg-elevated text-ink-muted"}`}>
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-line/60 bg-elevated px-4 py-2 text-[9px]">
          <span className="flex items-center gap-1.5 font-medium text-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> {stage >= 4 ? "All steps tested" : "Test running"}
          </span>
          <span className="hidden text-ink-muted sm:block">4 nodes · 3 connections</span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700 dark:bg-violet-900 dark:text-violet-300">Publish →</span>
        </div>
      </div>
    </div>
  );
}

/** Copilot conversation mockup — plan → review → build. */
function CopilotMockup() {
  return (
    <div className="rounded-3xl border border-line bg-elevated p-1 shadow-xl">
      <div className="space-y-2.5 rounded-2xl bg-muted/30 p-4 text-[11px]">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-3 py-2 text-white shadow-sm">
          When a new Gmail arrives, summarize it with AI and post to Slack
        </div>
        <div className="max-w-[90%] space-y-1.5">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-violet-600">
            <Sparkles className="h-3 w-3" /> Copilot plan
          </div>
          <div className="space-y-1 rounded-2xl rounded-bl-md border border-line bg-elevated p-2.5 shadow-sm">
            {["Trigger — Gmail · new email", "Action — AI · summarize", "Action — Slack · post message"].map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 text-ink" style={{ animation: `reveal-up 0.5s ease both ${i * 160}ms` }}>
                <CheckCircle2 className="h-3 w-3 shrink-0 text-ok" /> {s}
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-0.5 text-[9px] text-ink-muted">
              <Shield className="h-3 w-3 shrink-0 text-amber-500" /> 1 connection needed: Slack
            </div>
          </div>
          <div className="flex gap-1.5 pl-1">
            <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[9px] font-semibold text-white">Review & build</span>
            <span className="rounded-full border border-line bg-elevated px-2.5 py-1 text-[9px] text-ink-muted">Ask a question</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Agent run trace mockup — tool calls with observations. */
function AgentMockup() {
  const rows = [
    { icon: Wrench, label: "sheets__read_rows", state: "ok", detail: "12 rows" },
    { icon: Sparkles, label: "analyze · gpt-4o-mini", state: "ok", detail: "3 insights" },
    { icon: Shield, label: "request_tool_approval", state: "wait", detail: "awaiting you" },
    { icon: Check, label: "slack__post_message", state: "pending", detail: "—" },
  ];
  return (
    <div className="rounded-3xl border border-line bg-elevated p-1 shadow-xl">
      <div className="rounded-2xl bg-muted/30 p-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white"><Bot className="h-3.5 w-3.5" /></span>
          <p className="text-[11px] font-semibold text-ink">Ops agent · run #4821</p>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Approval pause</span>
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.label} className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[10px]" style={{ animation: `reveal-up 0.5s ease both ${i * 140}ms` }}>
              <r.icon className={`h-3 w-3 shrink-0 ${r.state === "ok" ? "text-ok" : r.state === "wait" ? "text-amber-500" : "text-ink-muted"}`} />
              <span className="font-mono text-ink">{r.label}</span>
              <span className="ml-auto text-ink-muted">{r.detail}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[9px] leading-relaxed text-ink-muted">Every decision and tool call is recorded — auditable run traces, human approvals before risky actions.</p>
      </div>
    </div>
  );
}

/** Dashboard stats mockup. */
function AnalyticsMockup() {
  const bars = [42, 68, 35, 80, 55, 92, 61];
  return (
    <div className="rounded-3xl border border-line bg-elevated p-1 shadow-xl">
      <div className="rounded-2xl bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink">Runs this week</p>
          <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[9px] font-semibold text-ok">98.2% success</span>
        </div>
        <div className="mt-3 flex h-20 items-end gap-1.5">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-violet-500/70 to-violet-400 transition-all duration-300 hover:from-violet-600 hover:to-violet-500" style={{ height: `${h}%`, animation: `reveal-up 0.6s ease both ${i * 80}ms` }} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[["4,823", "runs"], ["1.1s", "p50"], ["3.4s", "p95"]].map(([v, l]) => (
            <div key={l} className="rounded-lg border border-line bg-elevated px-1 py-1.5">
              <p className="text-[11px] font-bold text-ink">{v}</p>
              <p className="text-[8px] text-ink-muted">{l}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TypingHeadline() {
  const [index, setIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [deleting, setDeleting] = useState(false);
  const phrases = [
    "Automate the busywork.",
    "Connect your apps.",
    "Build with AI.",
    "Ship workflows fast.",
  ];
  useEffect(() => {
    const current = phrases[index];
    if (!deleting) {
      if (displayed.length < current.length) {
        const t = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 60);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setDeleting(true), 2000);
      return () => clearTimeout(t);
    }
    if (displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 30);
      return () => clearTimeout(t);
    }
    setDeleting(false);
    setIndex((i) => (i + 1) % phrases.length);
  }, [displayed, deleting, index]);
  return (
    <span className="text-violet-600">
      {displayed}
      <span className="animate-cursor text-violet-600">|</span>
    </span>
  );
}

function MarqueeIntegrations() {
  const doubled = [...APPS, ...APPS];
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-20 bg-gradient-to-r from-elevated to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-20 bg-gradient-to-l from-elevated to-transparent" />
      <div className="flex animate-marquee gap-8">
        {doubled.map((a, i) => (
          <div key={`${a.name}-${i}`} className="flex shrink-0 cursor-default items-center gap-2 text-sm font-medium text-ink-muted opacity-60 transition hover:opacity-100">
            <div className="flex h-6 w-6 items-center justify-center rounded-md shadow-sm" style={{ backgroundColor: `#${a.color}` }}>
              <a.icon className="h-3.5 w-3.5 text-white" />
            </div>
            {a.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnimatedCounter({ value, suffix = "" }: { value: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  // Values without digits (e.g. "Copilot", "Templates") render verbatim — no NaN.
  const digits = value.replace(/[^0-9]/g, "");
  const numericPart = digits ? parseInt(digits, 10) : 0;
  const hasNumeric = digits.length > 0;
  const textPart = value.replace(/[0-9]/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect(); } }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started || !hasNumeric || numericPart === 0) { setCount(numericPart); return; }
    let start = 0;
    const duration = 1200;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * numericPart));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [started, numericPart]);

  return <span ref={ref}>{hasNumeric ? `${textPart}${count}${suffix}` : value}</span>;
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export default function HomePage() {
  const heroInView = useInView(0.1);
  const howItWorks = useInView();
  const copilotSection = useInView();
  const agentSection = useInView();
  const featureGrid = useStaggeredReveal(FEATURES.length);
  const dataSection = useInView();
  const templateGrid = useStaggeredReveal(TEMPLATES.length);
  const testimonials = useStaggeredReveal(TESTIMONIALS.length);
  const pricing = useStaggeredReveal(PLANS.length);

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-30 border-b border-line/80 bg-elevated/90 backdrop-blur supports-[backdrop-filter]:bg-elevated/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo href="/" />
          <nav className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
            <a href="#product" className="transition hover:text-ink">Product</a>
            <a href="#copilot" className="transition hover:text-ink">Copilot</a>
            <a href="#agents" className="transition hover:text-ink">Agents</a>
            <a href="#templates" className="transition hover:text-ink">Templates</a>
            <a href="#pricing" className="transition hover:text-ink">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm text-ink-muted transition hover:text-ink sm:block">Sign in</Link>
            <Link href="/register"><Button>Start free</Button></Link>
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <section ref={heroInView.ref} className="relative overflow-hidden border-b border-line bg-bg">
        {/* Animated gradient orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-orb absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-violet-400/20 via-indigo-400/15 to-transparent blur-3xl" />
          <div className="animate-orb-reverse absolute -right-24 top-0 h-[400px] w-[400px] rounded-full bg-gradient-to-bl from-blue-400/18 via-purple-400/12 to-transparent blur-3xl" />
          <div className="animate-orb absolute bottom-0 left-1/3 h-[300px] w-[300px] rounded-full bg-gradient-to-t from-teal/10 to-transparent blur-3xl" />
        </div>
        <FloatingParticles />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-14 lg:grid-cols-2 lg:pt-20">
          <div className={heroInView.visible ? "animate-fade-in-up" : "opacity-0"}>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 transition hover:scale-[1.02] dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
              <Sparkles className="h-3.5 w-3.5" /> Copilot can build the workflow for you
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              <TypingHeadline />
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-muted">
              Connect Gmail, Slack, Sheets, Stripe, and 50+ apps. Describe the workflow, test each step, then publish — the same setup, configure, and test rhythm teams already know.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg" className="animate-pulse-glow transition-all duration-300 hover:scale-105">
                  Create a workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login"><Button size="lg" variant="secondary">Sign in</Button></Link>
            </div>
            <p className="mt-4 text-xs text-ink-muted">Free plan includes 5 workflows and 100 tasks/month. No credit card to start.</p>
          </div>

          <div className={`relative ${heroInView.visible ? "animate-fade-in-right" : "opacity-0"}`}>
            <EditorMockup />
            {/* Floating badges */}
            <div className="animate-float absolute -left-4 top-8 rounded-xl border border-line bg-elevated px-3 py-2 shadow-lg">
              <p className="text-[10px] font-semibold text-violet-600">Copilot</p>
              <p className="text-[9px] text-ink-muted">Building workflow…</p>
            </div>
            <div className="animate-float-delayed absolute -right-2 bottom-12 rounded-xl border border-line bg-elevated px-3 py-2 shadow-lg">
              <p className="text-[10px] font-semibold text-ok">✓ Test passed</p>
              <p className="text-[9px] text-ink-muted">2.4s · 4 steps</p>
            </div>
            <div className="animate-float-delayed absolute right-8 -top-2 rounded-xl border border-line bg-elevated px-3 py-2 shadow-lg">
              <p className="text-[10px] font-semibold text-amber-500">⚡ New trigger</p>
              <p className="text-[9px] text-ink-muted">Webhook received</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Integrations Bar ═══ */}
      <section className="border-b border-line bg-elevated py-8">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-5 text-center text-xs font-medium uppercase tracking-wider text-ink-muted">Works with the tools you already use</p>
          <MarqueeIntegrations />
        </div>
      </section>

      {/* ═══ Stats ═══ */}
      <section className="border-b border-line bg-muted/40 py-10">
        <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-3">
          {[
            { k: "50+", v: "apps in the catalog", icon: Globe },
            { k: "Copilot", v: "drafts workflows from plain language", icon: Sparkles },
            { k: "Templates", v: "clone a proven flow in one click", icon: LayoutTemplate },
          ].map((s) => (
            <div key={s.v} className="group flex items-center gap-4 rounded-2xl border border-line bg-elevated px-5 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300/30 hover:shadow-md">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 transition-colors group-hover:bg-violet-100 dark:bg-violet-950/50 dark:group-hover:bg-violet-900/50">
                <s.icon className="h-5 w-5 shrink-0 text-violet-600" />
              </div>
              <div>
                <p className="text-lg font-semibold"><AnimatedCounter value={s.k} /></p>
                <p className="text-sm text-ink-muted">{s.v}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ How It Works ═══ */}
      <section id="product" ref={howItWorks.ref} className="border-b border-line bg-bg py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">How it works</p>
            <h2 className="text-3xl font-semibold">Three steps to automation</h2>
            <p className="mt-2 text-ink-muted">Same model as the editor: trigger, actions, then a real test run.</p>
          </div>
          <div className={`mt-10 grid gap-6 md:grid-cols-3 ${howItWorks.visible ? "stagger-children" : ""}`}>
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className={`group rounded-2xl border border-line bg-elevated p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-violet-300/40 hover:shadow-md ${howItWorks.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={howItWorks.visible ? { animationDelay: `${i * 100}ms` } : undefined}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${s.color}`}>
                  {s.n}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
                {/* mini mock chips */}
                <div className="mt-4 flex flex-wrap gap-1.5 opacity-70 transition group-hover:opacity-100">
                  {s.mock.map((m) => (
                    <span key={m} className="rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted transition group-hover:border-violet-200 group-hover:text-ink">{m}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Feature grid — bento style with hover gradients */}
          <div ref={featureGrid.ref} className={`mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${featureGrid.visible ? "stagger-children" : ""}`}>
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`group relative overflow-hidden rounded-2xl border border-line bg-elevated p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300/30 hover:shadow-md ${f.span} ${featureGrid.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={featureGrid.visible ? featureGrid.staggerDelay(i) : undefined}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
                <div className="relative">
                  <f.icon className={`mb-3 h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${f.color}`} />
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Copilot section ═══ */}
      <section id="copilot" ref={copilotSection.ref} className="relative overflow-hidden border-b border-line bg-elevated py-20">
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-orb absolute -left-24 top-10 h-[350px] w-[350px] rounded-full bg-violet-500/10 blur-3xl" />
        </div>
        <div className={`relative mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2 ${copilotSection.visible ? "stagger-children" : ""}`}>
          <div className={copilotSection.visible ? "animate-reveal-left" : "opacity-0"}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">AI Copilot</p>
            <h2 className="text-3xl font-semibold">Describe it. Review the plan. Ship it.</h2>
            <p className="mt-3 text-ink-muted">
              Copilot reads the real app catalog and your real connections — it never invents apps or fields. You always approve the plan before anything is built, and nothing publishes itself.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {["Plans built only from the live app catalog", "Warns when a connection is missing", "Field mappings between steps, shown visually", "Suggest first, apply on your approval"].map((item, i) => (
                <li key={item} className="flex items-center gap-2.5" style={{ animation: copilotSection.visible ? `reveal-up 0.4s ease both ${200 + i * 100}ms` : undefined }}>
                  <Check className="h-4 w-4 shrink-0 text-violet-600" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <div className={copilotSection.visible ? "animate-reveal-right" : "opacity-0"}>
            <CopilotMockup />
          </div>
        </div>
      </section>

      {/* ═══ Agents section ═══ */}
      <section id="agents" ref={agentSection.ref} className="border-b border-line bg-bg py-20">
        <div className={`mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2 ${agentSection.visible ? "stagger-children" : ""}`}>
          <div className={`order-2 lg:order-1 ${agentSection.visible ? "animate-reveal-left" : "opacity-0"}`}>
            <AgentMockup />
          </div>
          <div className={`order-1 lg:order-2 ${agentSection.visible ? "animate-reveal-right" : "opacity-0"}`}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">AI Agents</p>
            <h2 className="text-3xl font-semibold">Teammates that act — with guardrails</h2>
            <p className="mt-3 text-ink-muted">
              Give an agent a job, allow-list the exact actions it may take, and require human approval before risky calls. Every decision, tool call, and observation lands in an auditable run trace.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {["Allow-listed tools — nothing else is reachable", "Approval pause before sensitive actions", "Round-by-round run traces you can replay", "Knowledge, budgets, and model routing built in"].map((item, i) => (
                <li key={item} className="flex items-center gap-2.5" style={{ animation: agentSection.visible ? `reveal-up 0.4s ease both ${200 + i * 100}ms` : undefined }}>
                  <Check className="h-4 w-4 shrink-0 text-violet-600" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══ Templates ═══ */}
      <section id="templates" ref={templateGrid.ref} className="border-b border-line bg-muted/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">Templates</p>
              <h2 className="text-3xl font-semibold">Start from a template</h2>
              <p className="mt-2 text-ink-muted">Common workflows you can clone into a draft and customize.</p>
            </div>
            <Link href="/register" className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 transition hover:text-violet-800">
              <LayoutTemplate className="h-4 w-4" /> See all templates after sign up
            </Link>
          </div>
          <div className={`mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${templateGrid.visible ? "stagger-children" : ""}`}>
            {TEMPLATES.map((t, i) => (
              <div
                key={t.title}
                className={`group rounded-2xl border border-line bg-elevated p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-violet-300/30 hover:shadow-md ${templateGrid.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={templateGrid.visible ? templateGrid.staggerDelay(i) : undefined}
              >
                <div className={`mb-3 h-1 w-12 rounded-full bg-gradient-to-r ${t.color}`} />
                <div className="flex items-center gap-1.5 text-xl" aria-hidden>
                  {t.apps.map((a, j) => (
                    <span key={j} className="transition-transform duration-300 group-hover:scale-110" style={{ transitionDelay: `${j * 60}ms` }}>{a}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs uppercase tracking-wide text-violet-700">{t.from} → {t.to}</p>
                <h3 className="mt-1.5 font-semibold transition group-hover:text-violet-700">{t.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{t.body}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-700 opacity-0 transition group-hover:opacity-100">
                  Use template <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Test Like Production ═══ */}
      <section className="border-b border-line bg-elevated py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <div className="group rounded-3xl border border-line bg-bg p-6 shadow-card transition-all duration-300 hover:shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-ok" />
              <span className="text-xs font-medium text-ok">Test run complete</span>
              <span className="ml-auto text-[10px] text-ink-muted">2.4s</span>
            </div>
            <div className="space-y-2">
              {[
                { step: "Gmail trigger", status: "ok", time: "0.3s" },
                { step: "AI classification", status: "ok", time: "1.2s" },
                { step: "Sheets row", status: "ok", time: "0.4s" },
                { step: "Slack message", status: "ok", time: "0.5s" },
              ].map((s, i) => (
                <div
                  key={s.step}
                  className="flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2 text-xs transition-all duration-300 hover:border-violet-300/30 hover:shadow-sm"
                  style={{ animation: `reveal-up 0.4s ease both ${i * 120}ms` }}
                >
                  <span className="h-2 w-2 rounded-full bg-ok" />
                  <span className="flex-1 font-medium">{s.step}</span>
                  <span className="text-ink-muted">{s.time}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">Test like production</p>
            <h2 className="text-3xl font-semibold">See every step before it goes live</h2>
            <p className="mt-3 text-ink-muted">
              Sample data in, data out, and a pulse on the canvas so you can see which step is live. Right-click any node to set up, configure, or retest that action.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {["Status icons on every step", "Human approvals when a path needs a person", "Activity timeline for every run", "Real-time error diagnostics"].map((item, i) => (
                <li key={item} className="flex items-center gap-2.5" style={{ animation: `reveal-up 0.4s ease both ${200 + i * 100}ms` }}>
                  <Check className="h-4 w-4 shrink-0 text-violet-600" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══ Analytics band ═══ */}
      <section className="border-b border-line bg-muted/40 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">Analytics</p>
            <h2 className="text-3xl font-semibold">Know what your automations do</h2>
            <p className="mt-3 text-ink-muted">
              Run volume, success rates, latency percentiles, and the real error behind every failure — computed server-side, filterable by workflow, app, and status.
            </p>
          </div>
          <AnalyticsMockup />
        </div>
      </section>

      {/* ═══ Tables / Forms / Interfaces showcase ═══ */}
      <section ref={dataSection.ref} className="border-b border-line bg-elevated py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600">One connected platform</p>
            <h2 className="text-3xl font-semibold">Data in, data out, all connected</h2>
            <p className="mt-2 text-ink-muted">Forms feed Tables, Tables trigger workflows, agents act on records — one shared data layer, not four disconnected products.</p>
          </div>
          <div className={`mt-10 grid gap-5 lg:grid-cols-3 ${dataSection.visible ? "stagger-children" : ""}`}>
            <div className={`group overflow-hidden rounded-2xl border border-line bg-elevated shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-teal/40 hover:shadow-lg ${dataSection.visible ? "animate-reveal-up" : "opacity-0"}`}>
              <div className="flex items-center gap-2 border-b border-line bg-muted/40 px-4 py-2.5 text-[11px] font-semibold text-ink-muted"><Table2 className="h-3.5 w-3.5 text-teal" /> Tables · Lead pipeline</div>
              <div className="space-y-1.5 p-4">
                {["Ada · ada@acme.com · Hot", "Marcus · m@nova.io · Warm", "Priya · p@scale.co · New"].map((row, i) => (
                  <div key={row} className="flex items-center gap-2 rounded-lg border border-line bg-muted/30 px-2.5 py-1.5 text-[10px] transition-all duration-300 group-hover:border-teal/30 group-hover:translate-x-0.5" style={{ animation: dataSection.visible ? `reveal-up 0.4s ease both ${i * 100}ms` : undefined }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-teal" /> {row}
                  </div>
                ))}
                <div className="pt-1 text-[9px] text-ink-muted">+ Record created → triggers “Sheets → Calendar” workflow</div>
              </div>
            </div>
            <div className={`group overflow-hidden rounded-2xl border border-line bg-elevated shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-violet-300/40 hover:shadow-lg ${dataSection.visible ? "animate-reveal-up" : "opacity-0"}`} style={dataSection.visible ? { animationDelay: "100ms" } : undefined}>
              <div className="flex items-center gap-2 border-b border-line bg-muted/40 px-4 py-2.5 text-[11px] font-semibold text-ink-muted"><FileInput className="h-3.5 w-3.5 text-blue-500" /> Forms · Contact us</div>
              <div className="space-y-2 p-4">
                {["Name", "Email", "Company"].map((f, i) => (
                  <div key={f} className="transition-all duration-300 group-hover:translate-x-0.5" style={{ animation: dataSection.visible ? `reveal-up 0.4s ease both ${150 + i * 100}ms` : undefined }}>
                    <p className="mb-0.5 text-[9px] font-medium text-ink-muted">{f}</p>
                    <div className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[10px] text-ink-muted">{f === "Email" ? "ada@acme.com" : "…"}</div>
                  </div>
                ))}
                <div className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-center text-[10px] font-semibold text-white shadow-sm transition group-hover:shadow-md">Submit → creates record + starts workflow</div>
              </div>
            </div>
            <div className={`group overflow-hidden rounded-2xl border border-line bg-elevated shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/40 hover:shadow-lg ${dataSection.visible ? "animate-reveal-up" : "opacity-0"}`} style={dataSection.visible ? { animationDelay: "200ms" } : undefined}>
              <div className="flex items-center gap-2 border-b border-line bg-muted/40 px-4 py-2.5 text-[11px] font-semibold text-ink-muted"><Layers className="h-3.5 w-3.5 text-amber-500" /> Interfaces · Live dashboard</div>
              <div className="space-y-2 p-4">
                <div className="grid grid-cols-2 gap-2">
                  {["Open deals · 24", "New leads · 9"].map((s, i) => (
                    <div key={s} className="rounded-lg border border-line bg-muted/30 px-2.5 py-2 transition group-hover:border-amber-300/30" style={{ animation: dataSection.visible ? `reveal-up 0.4s ease both ${200 + i * 100}ms` : undefined }}>
                      <p className="text-[13px] font-bold">{s.split(" · ")[1]}</p>
                      <p className="text-[9px] text-ink-muted">{s.split(" · ")[0]}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-line bg-muted/30 px-2.5 py-2 transition group-hover:border-amber-300/30" style={{ animation: dataSection.visible ? "reveal-up 0.4s ease both 400ms" : undefined }}>
                  <p className="text-[9px] font-medium text-ink-muted">Pipeline value</p>
                  <div className="mt-1.5 flex h-8 items-end gap-1">
                    {[40, 65, 30, 80, 55, 92].map((h, i) => <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-amber-400/70 to-amber-300 transition-all duration-300 group-hover:from-amber-500" style={{ height: `${h}%` }} />)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Testimonials ═══ */}
      <section ref={testimonials.ref} className="border-b border-line bg-elevated py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-violet-600">What teams say</p>
          <h2 className="text-center text-3xl font-semibold">Trusted by operators</h2>
          <div className={`mt-10 grid gap-4 md:grid-cols-3 ${testimonials.visible ? "stagger-children" : ""}`}>
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                className={`rounded-2xl border border-line bg-muted/30 p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300/30 hover:shadow-md ${testimonials.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={testimonials.visible ? testimonials.staggerDelay(i) : undefined}
              >
                <div className="mb-3 flex gap-0.5">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <span key={j} className="text-amber-400">★</span>
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-ink">&ldquo;{t.quote}&rdquo;</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-sm font-bold text-white">
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-[11px] text-ink-muted">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Pricing ═══ */}
      <section id="pricing" ref={pricing.ref} className="border-b border-line bg-bg py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-violet-600">Pricing</p>
          <h2 className="text-center text-3xl font-semibold">Simple plans</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-ink-muted">Start on Free. Upgrade when the team needs more tasks, members, and paths.</p>
          <div className={`mt-10 grid gap-4 md:grid-cols-3 ${pricing.visible ? "stagger-children" : ""}`}>
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={`${p.featured ? "relative rounded-2xl border-2 border-violet-500 bg-violet-50/40 p-6 shadow-sm dark:bg-violet-950/20" : "rounded-2xl border border-line p-6"} transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${pricing.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={pricing.visible ? pricing.staggerDelay(i) : undefined}
              >
                {p.featured && <span className="absolute -top-3 left-6 rounded-full bg-violet-600 px-3 py-0.5 text-[10px] font-semibold text-white">Most popular</span>}
                <p className="text-sm font-medium text-violet-700">{p.name}</p>
                <p className="mt-2 text-3xl font-semibold">{p.price}<span className="text-sm font-normal text-ink-muted"> / mo</span></p>
                <p className="mt-2 text-sm text-ink-muted">{p.detail}</p>
                <Link href="/register" className="mt-5 inline-block">
                  {p.featured ? <Button>Get started</Button> : <Button variant="secondary">Get started</Button>}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative overflow-hidden px-6 py-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-orb absolute -left-20 top-0 h-[300px] w-[300px] rounded-full bg-violet-500/10 blur-3xl" />
          <div className="animate-orb-reverse absolute -right-20 bottom-0 h-[300px] w-[300px] rounded-full bg-indigo-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-3xl bg-ink px-8 py-14 text-center text-white">
          <FloatingParticles count={14} />
          <div className="relative z-10">
            <Zap className="mb-4 h-8 w-8 animate-float text-violet-300" />
            <h2 className="text-3xl font-semibold">Ship your first workflow today</h2>
            <p className="mt-2 max-w-md text-sm text-white/70">Create a workspace, pick a template, and watch the test run move down the canvas.</p>
            <Link href="/register" className="mt-6 inline-block">
              <Button className="bg-white text-ink transition-all duration-300 hover:scale-105 hover:bg-violet-50">
                Start free <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-ink-muted">
          <Logo compact href="/" />
          <p>© {new Date().getFullYear()} FlowShip. Automate without the busywork.</p>
          <div className="flex gap-4">
            <Link href="/login" className="transition hover:text-ink">Sign in</Link>
            <Link href="/register" className="transition hover:text-ink">Create workspace</Link>
            <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Workspace isolation</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

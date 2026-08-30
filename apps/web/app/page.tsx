"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BarChart3, Bot, Check, FileInput, Globe, LayoutTemplate,
  Moon, Shield, Sparkles, Sun, Table2, Workflow, Zap, Mail, MessageSquare,
  Calendar, CreditCard, Database, GitBranch, Layers, Clock,
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
  { name: "Zapier", color: "FF4F00", icon: Zap },
];

const TEMPLATES = [
  { title: "Gmail → Slack", body: "Post a channel message when a labeled email arrives.", from: "Gmail", to: "Slack", color: "from-red-500 to-purple-600" },
  { title: "Form → Sheets", body: "Log every form response as a new spreadsheet row.", from: "Forms", to: "Sheets", color: "from-blue-500 to-green-500" },
  { title: "Stripe → CRM", body: "Create or update a contact when a payment succeeds.", from: "Stripe", to: "HubSpot", color: "from-indigo-500 to-orange-400" },
  { title: "Schedule → AI → Email", body: "Summarize yesterday's runs and email the team each morning.", from: "Schedule", to: "Gmail", color: "from-amber-500 to-red-400" },
];

const STEPS = [
  { n: "1", title: "Pick a trigger", body: "Choose the event that starts the workflow — a new email, form submission, webhook, or schedule.", icon: Zap, color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
  { n: "2", title: "Add actions", body: "Connect Slack, Sheets, CRM, HTTP, or AI. Map fields with data from prior steps.", icon: Workflow, color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  { n: "3", title: "Test & publish", body: "Run a sample through every node, watch status icons, then turn it on.", icon: Sparkles, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
];

const FEATURES = [
  { icon: Workflow, title: "Visual builder", body: "Paths, delays, filters, and drag-and-drop between steps.", color: "text-violet-600" },
  { icon: Sparkles, title: "AI Copilot", body: "Describe the outcome in plain language. It proposes apps, events, and mappings.", color: "text-amber-500" },
  { icon: Bot, title: "AI steps", body: "Extract, summarize, classify, write, and translate in-line.", color: "text-blue-600" },
  { icon: Table2, title: "Tables & forms", body: "Native records and public forms that start automations.", color: "text-teal" },
  { icon: BarChart3, title: "Analytics", body: "Real-time dashboards with per-workflow performance and CSV/PDF export.", color: "text-pink-500" },
  { icon: Globe, title: "50+ integrations", body: "Gmail, Slack, Sheets, Stripe, HubSpot, Notion, and more.", color: "text-emerald-600" },
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
  return { ref, visible, staggerDelay: (i: number) => ({ animationDelay: `${i * baseDelay}ms` }) };
}

/* ── Animated sub-components ───────────────────────────────────────────── */

/** Deterministic pseudo-random number generator seeded by index.
 *  Ensures server and client produce identical particle positions,
 *  eliminating the Next.js hydration mismatch. */
function seededRandom(seed: number) {
  let s = seed + 1;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function FloatingParticles() {
  const particles = Array.from({ length: 20 }, (_, i) => {
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
          <div key={`${a.name}-${i}`} className="flex shrink-0 items-center gap-2 text-sm font-medium text-ink-muted opacity-60 transition hover:opacity-100">
            <div className="h-5 w-5 rounded" style={{ backgroundColor: `#${a.color}` }} />
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
  const numericPart = parseInt(value.replace(/[^0-9]/g, ""), 10);
  const textPart = value.replace(/[0-9]/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect(); } }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started || numericPart === 0) { setCount(numericPart); return; }
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

  return <span ref={ref}>{textPart}{count}{suffix}</span>;
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export default function HomePage() {
  const heroInView = useInView(0.1);
  const howItWorks = useInView();
  const featureGrid = useStaggeredReveal(FEATURES.length);
  const templateGrid = useStaggeredReveal(TEMPLATES.length);
  const testimonials = useStaggeredReveal(TESTIMONIALS.length);
  const pricing = useStaggeredReveal(PLANS.length);

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-30 border-b border-line/80 bg-elevated/90 backdrop-blur supports-[backdrop-filter]:bg-elevated/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
            <a href="#product" className="transition hover:text-ink">Product</a>
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
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
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
            {/* Editor mock */}
            <div className="animate-float-slow rounded-3xl border border-line bg-elevated p-1 shadow-2xl ring-1 ring-black/5">
              <div className="rounded-2xl bg-muted/30 p-4">
                {/* Window chrome */}
                <div className="mb-3 flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                  <div className="ml-3 flex-1 rounded-md bg-bg px-3 py-1 text-[10px] text-ink-muted">FlowShip Editor</div>
                </div>
                {/* Mini workflow canvas */}
                <AnimatedWorkflow />
                {/* Status bar */}
                <div className="mt-3 flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-[10px]">
                  <span className="flex items-center gap-1.5 text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" /> All steps tested
                  </span>
                  <span className="text-ink-muted">4 nodes · 3 connections</span>
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-300">Ready to publish</span>
                </div>
              </div>
            </div>

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
            <div key={s.v} className="group flex items-center gap-4 rounded-2xl border border-line bg-elevated px-5 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-violet-300/30">
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
                className={`group rounded-2xl border border-line bg-elevated p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-violet-300/40 ${howItWorks.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={howItWorks.visible ? { animationDelay: `${i * 100}ms` } : undefined}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${s.color}`}>
                  {s.n}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>

          {/* Feature grid */}
          <div ref={featureGrid.ref} className={`mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${featureGrid.visible ? "stagger-children" : ""}`}>
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`group rounded-2xl border border-line bg-elevated p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-violet-300/30 ${featureGrid.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={featureGrid.visible ? featureGrid.staggerDelay(i) : undefined}
              >
                <f.icon className={`mb-3 h-5 w-5 ${f.color}`} />
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{f.body}</p>
              </div>
            ))}
          </div>

          {/* Editor preview */}
          <div className="mt-14 overflow-hidden rounded-3xl border border-line bg-elevated shadow-card">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Live workflow preview</p>
                <p className="mt-1 text-sm text-ink-muted">A clear path from event to outcome</p>
              </div>
              <span className="rounded-full bg-ok/10 px-3 py-1 text-xs font-medium text-ok">Ready to test</span>
            </div>
            <div className="grid gap-4 px-6 py-8 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
              {[
                { label: "New email", app: "Gmail", tone: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" },
                { label: "Check priority", app: "Filter", tone: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" },
                { label: "Notify team", app: "Slack", tone: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" },
              ].map((step, i) => (
                <div key={step.label} className="contents">
                  <div className={`rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${step.tone}`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Step {i + 1}</p>
                    <p className="mt-2 font-semibold">{step.label}</p>
                    <p className="mt-1 text-xs text-ink-muted">{step.app}</p>
                  </div>
                  {i < 2 && <ArrowRight className="mx-auto hidden h-5 w-5 text-violet-500 md:block" />}
                </div>
              ))}
            </div>
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
          <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${templateGrid.visible ? "stagger-children" : ""}`}>
            {TEMPLATES.map((t, i) => (
              <div
                key={t.title}
                className={`group rounded-2xl border border-line bg-elevated p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${templateGrid.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={templateGrid.visible ? templateGrid.staggerDelay(i) : undefined}
              >
                <div className={`mb-3 h-1 w-12 rounded-full bg-gradient-to-r ${t.color}`} />
                <p className="text-xs uppercase tracking-wide text-violet-700">{t.from} → {t.to}</p>
                <h3 className="mt-2 font-semibold group-hover:text-violet-700 transition">{t.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Test Like Production ═══ */}
      <section className="border-b border-line bg-elevated py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-line bg-bg p-6 shadow-card">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2.5 w-2.5 rounded-full bg-ok animate-pulse" />
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
                  className="flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2 text-xs transition-all duration-300 hover:border-violet-300/30"
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

      {/* ═══ Testimonials ═══ */}
      <section ref={testimonials.ref} className="border-b border-line bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-violet-600">What teams say</p>
          <h2 className="text-center text-3xl font-semibold">Trusted by operators</h2>
          <div className={`mt-10 grid gap-4 md:grid-cols-3 ${testimonials.visible ? "stagger-children" : ""}`}>
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                className={`rounded-2xl border border-line bg-elevated p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${testimonials.visible ? "animate-reveal-up" : "opacity-0"}`}
                style={testimonials.visible ? testimonials.staggerDelay(i) : undefined}
              >
                <div className="mb-3 flex gap-0.5">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <span key={j} className="text-amber-400">★</span>
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-ink">&ldquo;{t.quote}&rdquo;</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-900 dark:text-violet-300">
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
          <FloatingParticles />
          <div className="relative z-10">
            <Zap className="mb-4 h-8 w-8 text-violet-300 animate-float" />
            <h2 className="text-3xl font-semibold">Ship your first workflow today</h2>
            <p className="mt-2 max-w-md text-sm text-white/70">Create a workspace, pick a template, and watch the test run move down the canvas.</p>
            <Link href="/register" className="mt-6 inline-block">
              <Button className="bg-white text-ink hover:bg-violet-50 transition-all duration-300 hover:scale-105">
                Start free <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-ink-muted">
          <Logo compact />
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

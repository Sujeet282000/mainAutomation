import Link from "next/link";
import { ArrowRight, Check, Sparkles, Workflow, Bot, Table2, Shield, Zap, LayoutTemplate } from "lucide-react";
import { Logo } from "@/features/shell/logo";
import { Button } from "@/components/ui/button";

const APPS = [
  { name: "Gmail", src: "https://cdn.simpleicons.org/gmail/EA4335" },
  { name: "Slack", src: "https://cdn.simpleicons.org/slack/4A154B" },
  { name: "Google Sheets", src: "https://cdn.simpleicons.org/googlesheets/34A853" },
  { name: "Notion", src: "https://cdn.simpleicons.org/notion/000000" },
  { name: "HubSpot", src: "https://cdn.simpleicons.org/hubspot/FF7A59" },
  { name: "Stripe", src: "https://cdn.simpleicons.org/stripe/635BFF" },
  { name: "Salesforce", src: "https://cdn.simpleicons.org/salesforce/00A1E0" },
  { name: "GitHub", src: "https://cdn.simpleicons.org/github/181717" }
];

const TEMPLATES = [
  { title: "New Gmail → Slack", body: "Post a channel message when a labeled email arrives.", from: "Gmail", to: "Slack" },
  { title: "Form submit → Sheet", body: "Log every form response as a new spreadsheet row.", from: "Forms", to: "Sheets" },
  { title: "Stripe payment → CRM", body: "Create or update a contact when a payment succeeds.", from: "Stripe", to: "HubSpot" },
  { title: "Schedule → digest", body: "Summarize yesterday’s runs and email the team each morning.", from: "Schedule", to: "Gmail" }
];

const STEPS = [
  { n: "1", title: "Pick a trigger", body: "Choose the event that starts the Zap — a new email, a form, a webhook, or a schedule." },
  { n: "2", title: "Add actions", body: "Connect Slack, Sheets, CRM, HTTP, or AI. Map fields with data from prior steps." },
  { n: "3", title: "Test, then publish", body: "Run a sample through every node, watch status icons, then turn it on." }
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    detail: "5 Zaps · 100 tasks / mo · 2 members",
    featured: false
  },
  {
    name: "Professional",
    price: "$29",
    detail: "2,000 tasks / mo · 10 members · 2-minute polling · Copilot",
    featured: true
  },
  {
    name: "Team",
    price: "$69",
    detail: "50,000 tasks / mo · extra seats · shared folders",
    featured: false
  }
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-elevated/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
            <a href="#product" className="hover:text-ink">
              Product
            </a>
            <a href="#templates" className="hover:text-ink">
              Templates
            </a>
            <a href="#pricing" className="hover:text-ink">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm text-ink-muted hover:text-ink sm:block">
              Sign in
            </Link>
            <Link href="/register">
              <Button>Start free</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-line bg-bg">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_15%_-10%,rgba(139,92,246,0.28),transparent),radial-gradient(700px_380px_at_90%_0%,rgba(99,102,241,0.18),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-14 lg:grid-cols-2 lg:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800">
              <Sparkles className="h-3.5 w-3.5" /> Copilot can build the Zap for you
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Automate the busywork.
              <span className="mt-1 block text-violet-600">Keep the decisions.</span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-muted">
              FlowShip connects Gmail, Slack, Sheets, Stripe, and 50+ apps. Describe the workflow, test each step, then
              publish — the same setup, configure, and test rhythm teams already know.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg">
                  Create a workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="secondary">
                  Sign in
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-ink-muted">Free plan includes 5 Zaps and 100 tasks / month. No credit card to start.</p>
          </div>
          <div className="relative">
            <img
              alt="Operations team reviewing automations on a laptop"
              className="h-[360px] w-full rounded-3xl object-cover shadow-card ring-1 ring-black/5"
              src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1400&q=80"
            />
            <div className="absolute -bottom-5 left-5 right-5 rounded-2xl border border-line bg-elevated/95 p-4 shadow-card backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">Canvas preview</p>
              <p className="mt-1 text-sm font-medium">Gmail → Filter → Slack</p>
              <p className="text-xs text-ink-muted">Copilot maps fields. You test the sample, then publish.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-elevated py-8">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-5 text-center text-xs font-medium uppercase tracking-wider text-ink-muted">
            Works with the tools you already use
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-80">
            {APPS.map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <img src={a.src} alt="" className="h-5 w-5" />
                {a.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-muted/40 py-12">
        <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-3">
        {[
          { k: "50+", v: "apps in the catalog" },
          { k: "Copilot", v: "drafts Zaps from plain language" },
          { k: "Templates", v: "clone a proven flow in one click" }
        ].map((s) => (
          <div key={s.v} className="rounded-2xl border border-line bg-elevated px-5 py-4 text-center">
            <p className="text-2xl font-semibold text-violet-700">{s.k}</p>
            <p className="mt-1 text-sm text-ink-muted">{s.v}</p>
          </div>
        ))}
        </div>
      </section>

      <section id="product" className="border-b border-line bg-bg py-20">
        <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold">How a Zap comes together</h2>
          <p className="mt-2 text-ink-muted">Three steps. Same model as the editor: trigger, actions, then a real test run.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line bg-elevated p-6 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                {s.n}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Workflow, title: "Visual builder", body: "Paths, delays, filters, and plus-buttons between steps." },
            { icon: Sparkles, title: "Copilot", body: "Describe the outcome. It proposes apps, events, and mappings." },
            { icon: Bot, title: "AI steps", body: "Extract, summarize, classify, write, and translate in-line." },
            { icon: Table2, title: "Tables & forms", body: "Native records and public forms that start automations." }
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-elevated p-5">
              <f.icon className="mb-3 h-5 w-5 text-violet-600" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 overflow-hidden rounded-3xl border border-line bg-elevated p-5 shadow-card">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Workflow preview</p><p className="mt-1 text-sm text-ink-muted">A clear path from event to outcome</p></div>
            <span className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-medium text-teal">Ready to test</span>
          </div>
          <div className="grid gap-3 py-6 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
            {[{ label: "New email", app: "Gmail", tone: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" }, { label: "Check priority", app: "Filter", tone: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" }, { label: "Notify team", app: "Slack", tone: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" }].map((step, index) => (
              <div key={step.label} className="contents"><div className={`rounded-2xl border p-4 ${step.tone}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Step {index + 1}</p><p className="mt-2 font-semibold">{step.label}</p><p className="mt-1 text-xs text-ink-muted">{step.app}</p></div>{index < 2 && <ArrowRight className="mx-auto hidden h-5 w-5 text-violet-500 md:block" />}</div>
            ))}
          </div>
        </div>
        </div>
      </section>

      <section id="templates" className="border-b border-line bg-muted/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold">Start from a template</h2>
              <p className="mt-2 text-ink-muted">Common Zaps you can clone into a draft and customize.</p>
            </div>
            <Link href="/register" className="inline-flex items-center gap-1 text-sm font-medium text-violet-700">
              <LayoutTemplate className="h-4 w-4" /> See templates after you sign up
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <div key={t.title} className="rounded-2xl border border-line bg-elevated p-5 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-violet-700">
                  {t.from} → {t.to}
                </p>
                <h3 className="mt-2 font-semibold">{t.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-elevated py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
        <img
          alt="Marketer reviewing campaign performance"
          className="h-72 w-full rounded-3xl object-cover shadow-card ring-1 ring-black/5 lg:h-80"
          src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80"
        />
        <div>
          <h2 className="text-3xl font-semibold">Test like production</h2>
          <p className="mt-3 text-ink-muted">
            Sample data in, data out, and a pulse on the canvas so you can see which step is live. Right-click any node
            to set up, configure, or retest that action.
          </p>
          <ul className="mt-5 space-y-2 text-sm">
            {["Status icons on every step", "Human approvals when a path needs a person", "Activity timeline for every run"].map(
              (item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-violet-600" /> {item}
                </li>
              )
            )}
          </ul>
        </div>
        </div>
      </section>

      <section id="pricing" className="border-b border-line bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold">Simple plans</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-ink-muted">
            Start on Free. Upgrade when the team needs more tasks, members, and paths.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "rounded-2xl border-2 border-violet-500 bg-violet-50/40 p-6 shadow-sm"
                    : "rounded-2xl border border-line p-6"
                }
              >
                <p className="text-sm font-medium text-violet-700">{p.name}</p>
                <p className="mt-2 text-3xl font-semibold">
                  {p.price}
                  <span className="text-sm font-normal text-ink-muted"> / mo</span>
                </p>
                <p className="mt-2 text-sm text-ink-muted">{p.detail}</p>
                <Link href="/register" className="mt-5 inline-block">
                  {p.featured ? <Button>Get started</Button> : <Button variant="secondary">Get started</Button>}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-3xl bg-ink px-8 py-12 text-center text-white">
          <Zap className="mb-4 h-8 w-8 text-violet-300" />
          <h2 className="text-3xl font-semibold">Ship your first Zap today</h2>
          <p className="mt-2 max-w-md text-sm text-white/70">
            Create a workspace, pick a template, and watch the test run move down the canvas.
          </p>
          <Link href="/register" className="mt-6">
            <Button className="bg-white text-ink hover:bg-violet-50">Start free</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-ink-muted">
          <Logo compact />
          <p>© {new Date().getFullYear()} FlowShip. Automate without the busywork.</p>
          <div className="flex gap-4">
            <Link href="/login">Sign in</Link>
            <Link href="/register">Create workspace</Link>
            <span className="inline-flex items-center gap-1">
              <Shield className="h-3 w-3" /> Workspace isolation
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

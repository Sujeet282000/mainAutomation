"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  ExternalLink,
  GitBranch,
  Home,
  PlusCircle,
  Search,
  Sparkles,
  Wrench,
  Zap
} from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { opKey, type CatalogApp, type CatalogOp } from "@/lib/catalog";

export type PickerTab = "home" | "apps" | "ai" | "flow" | "utilities" | "products" | "custom";

const TABS: { id: PickerTab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "apps", label: "Apps", icon: Boxes },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "flow", label: "Flow controls", icon: GitBranch },
  { id: "utilities", label: "Utilities", icon: Wrench },
  { id: "products", label: "Products", icon: Zap },
  { id: "custom", label: "Custom", icon: PlusCircle }
];

const FILTERS = ["All", "Send", "Receive", "Transform", "Manage"] as const;

const AI_ACTIONS = [
  { key: "extract", name: "Extract", hint: "Pull fields from text", color: "bg-blue-500" },
  { key: "summarize", name: "Summarize", hint: "Condense long content", color: "bg-amber-400" },
  { key: "classify", name: "Classify", hint: "Label or score text", color: "bg-emerald-500" },
  { key: "write", name: "Write", hint: "Draft emails, posts, replies", color: "bg-pink-500" },
  { key: "translate", name: "Translate", hint: "Change language", color: "bg-teal-500" },
  { key: "analyze", name: "Analyze", hint: "Insights and sentiment", color: "bg-red-500" },
  { key: "transcribe", name: "Transcribe", hint: "Speech to text", color: "bg-orange-500" },
  { key: "search", name: "Search", hint: "Find answers in data", color: "bg-violet-500" }
];

const BUILTINS = new Set([
  "webhook",
  "schedule",
  "manual",
  "email",
  "code",
  "filter",
  "paths",
  "loop",
  "delay",
  "formatter",
  "digest",
  "storage",
  "http",
  "subflow",
  "approval",
  "tables",
  "forms",
  "manager",
  "openai",
  "anthropic",
  "gemini",
  "ai",
  "ai-guardrails",
  "rss",
  "email-parser",
  "transfer",
  "agents",
  "chatbots"
]);

const AI_SLUGS = new Set(["openai", "anthropic", "gemini", "ai", "ai-guardrails", "huggingface", "cohere", "replicate", "elevenlabs"]);
const FLOW_SLUGS = new Set(["filter", "paths", "loop", "delay", "approval"]);
const UTIL_SLUGS = new Set([
  "formatter",
  "digest",
  "storage",
  "email",
  "email-parser",
  "webhook",
  "schedule",
  "manual",
  "rss"
]);
const PRODUCT_SLUGS = new Set(["tables", "forms", "chatbots", "agents", "subflow", "manager", "transfer"]);
const CUSTOM_SLUGS = new Set(["http", "code", "webhook"]);

function tabFor(app: CatalogApp): PickerTab {
  if (AI_SLUGS.has(app.slug) || app.category === "ai") return "ai";
  if (FLOW_SLUGS.has(app.slug)) return "flow";
  if (PRODUCT_SLUGS.has(app.slug)) return "products";
  if (CUSTOM_SLUGS.has(app.slug) && app.slug !== "webhook") return "custom";
  if (UTIL_SLUGS.has(app.slug) || app.category === "utilities") return "utilities";
  return "apps";
}

const FLOW_BLURBS: Record<string, string> = {
  delay: "Pause the workflow for a duration or until a time.",
  filter: "Only continue if a condition matches.",
  approval: "Human in the Loop — pause for approve/reject.",
  loop: "Looping — run downstream steps for each item.",
  paths: "Paths (router) — create branching logic to multiple nodes.",
  subflow: "Sub-Zap — call another published workflow."
};

const UTIL_BLURBS: Record<string, string> = {
  openai: "Extract data, analyze information, generate content — and more!",
  http: "Make authenticated REST API calls from your Zaps.",
  code: "Write custom Python or JavaScript for your Zaps.",
  digest: "Condense info from multiple events into a summary for any app.",
  email: "Send and receive email via a custom mailbox.",
  "email-parser": "Parse inbound email into fields.",
  formatter: "Transform data (dates, times, text) into the format needed.",
  webhook: "Catch or send HTTP webhooks.",
  schedule: "Run on a timetable.",
  storage: "Store and recall values between runs.",
  rss: "Watch an RSS or Atom feed for new items.",
  tables: "Create and look up workspace table records.",
  forms: "Start from a form submission.",
  chatbots: "Send a message through a workspace chatbot.",
  agents: "Run an agent with instructions and tools.",
  manager: "React to run status or turn automations off.",
  transfer: "Bulk copy historical records between apps."
};

export function AppPickerModal({
  apps,
  kind,
  initialTab = "home",
  onPick,
  onClose
}: {
  apps: CatalogApp[];
  kind: "trigger" | "action";
  initialTab?: PickerTab;
  onPick: (app: CatalogApp, op: CatalogOp) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [picked, setPicked] = useState<CatalogApp | null>(null);

  const catalog = useMemo(() => mergeWithBuiltins(apps), [apps]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const toolTab = tab === "flow" || tab === "utilities" || tab === "products" || tab === "custom" || tab === "ai";
    return catalog
      .map((app) => {
        const opsForKind = app.operations.filter((op) => {
          if (kind === "trigger" && op.type !== "trigger") return false;
          if (kind !== "trigger" && op.type === "trigger") return false;
          return true;
        });
        const operations = (toolTab && !opsForKind.length ? app.operations : opsForKind).filter((op) => {
          const hay = `${app.name} ${op.name} ${op.type} ${app.description ?? ""}`.toLowerCase();
          if (query && !hay.includes(query)) return false;
          if (filter === "Send") return /send|create|post|write|notify/i.test(op.name);
          if (filter === "Receive") return op.type === "trigger" || /get|find|search|new/i.test(op.name);
          if (filter === "Transform") return /format|parse|extract|translate|code|http|formatter/i.test(`${app.slug} ${op.name}`);
          if (filter === "Manage") return /update|delete|delay|filter|path|loop|storage|digest/i.test(`${app.slug} ${op.name}`);
          return true;
        });
        return { ...app, operations };
      })
      .filter((app) => app.operations.length || (toolTab && !query && categoryHasApp(tab, app.slug)));
  }, [catalog, kind, q, filter, tab]);

  const inTab = filtered.filter((app) => {
    if (tab === "home") return true;
    if (tab === "custom") return CUSTOM_SLUGS.has(app.slug);
    if (tab === "apps") return tabFor(app) === "apps";
    if (tab === "flow") return FLOW_SLUGS.has(app.slug);
    return tabFor(app) === tab;
  });

  const topApps = inTab.filter((a) => !BUILTINS.has(a.slug)).slice(0, 16);
  const tools = inTab.filter((a) => UTIL_SLUGS.has(a.slug) || CUSTOM_SLUGS.has(a.slug));
  const products = inTab.filter((a) => PRODUCT_SLUGS.has(a.slug));

  function pickAiAction(key: string) {
    const app = apps.find((a) => a.slug === "openai");
    if (!app) return;
    const named = AI_ACTIONS.find((a) => a.key === key);
    const op =
      app.operations.find((o) => opKey(o) === key) ??
      app.operations.find((o) => o.type !== "trigger") ??
      app.operations[0];
    if (!op) return;
    onPick(app, { ...op, key, name: named?.name ?? op.name });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[min(760px,90vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-elevated shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-[176px] shrink-0 border-r border-line bg-muted py-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setPicked(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm",
                  tab === t.id ? "bg-teal-soft font-medium text-ink" : "text-ink-muted hover:bg-muted hover:text-ink"
                )}
              >
                <Icon className={cn("h-4 w-4", t.id === "ai" && "text-orange-500")} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-line px-5 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
                <Input
                  className="pl-9"
                  autoFocus
                  placeholder={`Search ${catalog.length} available apps and tools…`}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPicked(null);
                  }}
                />
              </div>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
                Browse all <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "pb-1",
                    filter === f ? "border-b-2 border-violet-600 font-medium text-violet-700" : "text-ink-muted"
                  )}
                >
                  {f}
                </button>
              ))}
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted">
                <BookOpen className="h-3.5 w-3.5" /> Help docs
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {kind === "trigger" ? "1. Choose the event that starts your Zap" : "Choose the app and action for this step"}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {picked ? (
              <div>
                <button type="button" className="mb-3 text-sm text-teal" onClick={() => setPicked(null)}>
                  ← All apps
                </button>
                <div className="mb-3 flex items-center gap-2 font-medium">
                  <AppIcon slug={picked.slug} />
                  {picked.name}
                </div>
                <p className="mb-4 text-sm leading-6 text-ink-muted">{picked.description}</p>
                <div className="grid gap-1">
                  {picked.operations.map((op) => (
                    <button
                      key={opKey(op)}
                      type="button"
                      className="rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:border-violet-500 hover:bg-muted"
                      onClick={() => onPick(picked, op)}
                    >
                      <div className="font-medium">{op.name}</div>
                      <div className="text-xs capitalize text-ink-muted">{op.description || `${op.type} event`}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : tab === "ai" ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Generate a prompt from scratch</h3>
                <button
                  type="button"
                  className="mb-6 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                  onClick={() => pickAiAction("write")}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  Custom prompt
                </button>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Start with a quick action</h3>
                <div className="grid gap-0.5">
                  {AI_ACTIONS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted"
                      onClick={() => pickAiAction(a.key)}
                    >
                      <span className={cn("h-8 w-8 rounded-lg", a.color)} />
                      <span>
                        <span className="block text-sm font-medium">{a.name}</span>
                        <span className="block text-xs text-ink-muted">{a.hint}</span>
                      </span>
                      <span className="ml-auto text-ink-muted">›</span>
                    </button>
                  ))}
                </div>
                {kind !== "trigger" && (
                  <div className="mt-6">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">AI apps</h3>
                    <AppList apps={filtered.filter((a) => tabFor(a) === "ai")} onSelect={setPicked} />
                  </div>
                )}
              </div>
            ) : tab === "home" && !q ? (
              <div className="grid gap-8 md:grid-cols-2">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Your top apps</h3>
                  <AppList apps={topApps.length ? topApps : inTab.slice(0, 12)} onSelect={setPicked} />
                </section>
                <div className="space-y-6">
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Popular built-in tools</h3>
                    <AppList apps={tools.length ? tools : inTab.filter((a) => BUILTINS.has(a.slug)).slice(0, 8)} onSelect={setPicked} />
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Products</h3>
                    <AppList
                      apps={products.length ? products : inTab.filter((a) => ["tables", "forms", "subflow"].includes(a.slug))}
                      onSelect={setPicked}
                    />
                  </section>
                </div>
              </div>
            ) : tab === "flow" || tab === "utilities" || tab === "products" ? (
              <div className="grid gap-1">
                {kind === "trigger" && tab === "flow" && (
                  <p className="mb-3 text-sm text-ink-muted">
                    Filter, Paths, Looping, Delay, and Human in the Loop run after a trigger — picking one adds it as the next step, Zapier-style.
                  </p>
                )}
                {inTab.map((app) => (
                  <button
                    key={app.slug}
                    type="button"
                    className="rounded-lg px-3 py-2.5 text-left hover:bg-muted"
                    onClick={() => setPicked(app)}
                  >
                    <div className="flex items-center gap-3">
                      <AppIcon slug={app.slug} size="sm" />
                      <div>
                        <div className="font-medium">
                          {app.slug === "approval"
                            ? "Human in the Loop"
                            : app.slug === "paths"
                              ? "Paths (router)"
                              : app.slug === "loop"
                                ? "Looping"
                                : app.slug === "openai"
                                  ? "AI"
                                  : app.name}
                        </div>
                        <p className="text-xs text-ink-muted">{FLOW_BLURBS[app.slug] ?? UTIL_BLURBS[app.slug] ?? app.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
                {!inTab.length && (
                  <p className="text-sm text-ink-muted">
                    {kind === "trigger" ? "These tools are mostly actions — add them after a trigger." : "Nothing in this category."}
                  </p>
                )}
              </div>
            ) : tab === "custom" && !picked ? (
              <div>
                <p className="mb-4 text-sm text-ink-muted">
                  Call any API, run code, or catch a webhook when no pre-built piece covers the system.
                </p>
                <AppList apps={inTab} onSelect={setPicked} />
              </div>
            ) : (
              <AppList apps={inTab} onSelect={setPicked} />
            )}
            {!inTab.length && tab !== "ai" && q.trim() ? (
              <p className="mt-2 text-sm text-ink-muted">No apps match this search.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function categoryHasApp(tab: PickerTab, slug: string) {
  if (tab === "flow") return FLOW_SLUGS.has(slug);
  if (tab === "utilities") return UTIL_SLUGS.has(slug);
  if (tab === "products") return PRODUCT_SLUGS.has(slug);
  if (tab === "custom") return CUSTOM_SLUGS.has(slug);
  if (tab === "ai") return AI_SLUGS.has(slug);
  return false;
}

function op(key: string, name: string, type: CatalogOp["type"], description?: string): CatalogOp {
  return { key, name, type, description };
}

function builtin(slug: string, name: string, category: string, operations: CatalogOp[], description?: string): CatalogApp {
  return { slug, name, category, authType: "none", description, operations };
}

const BUILTIN_APPS: CatalogApp[] = [
  builtin("filter", "Filter", "flow", [op("only_continue_if", "Only continue if", "action", "Stop the Zap unless a condition is true.")], "Only continue if… — skip the rest of the Zap when the condition fails."),
  builtin("paths", "Paths", "flow", [op("router", "Paths (router)", "action", "Split into Path A / Path B with rules.")], "Paths (router) — create branching logic to multiple nodes."),
  builtin("loop", "Looping", "flow", [op("for_each", "For Each", "action", "Run the following steps once per item in a list.")], "Looping — run downstream steps for each item."),
  builtin("delay", "Delay", "flow", [
    op("for", "Delay For", "action", "Wait a number of seconds, minutes, hours, or days."),
    op("until", "Delay Until", "action", "Wait until a specific date and time.")
  ], "Pause the workflow for a duration or until a time."),
  builtin("approval", "Human in the Loop", "flow", [op("approve", "Ask for approval", "action", "Pause until someone approves or rejects.")], "Pause for approve / reject before later steps run."),
  builtin("formatter", "Formatter", "utilities", [
    op("text", "Text", "action"),
    op("date", "Date / Time", "action"),
    op("number", "Numbers", "action")
  ], "Transform data (dates, times, text) into the format needed."),
  builtin("digest", "Digest", "utilities", [op("add", "Add to Digest", "action"), op("release", "Release Digest", "action")], "Condense info from multiple events into a summary."),
  builtin("storage", "Storage", "utilities", [op("set", "Set Value", "action"), op("get", "Get Value", "action")], "Store and recall values between runs."),
  builtin("webhook", "Webhooks", "utilities", [op("catch_hook", "Catch Hook", "trigger"), op("send_hook", "Send Webhook", "action")], "Catch inbound HTTP events or send outbound HTTP."),
  builtin("schedule", "Schedule", "utilities", [op("cron", "Every day / interval", "trigger")], "Run on a timetable."),
  builtin("manual", "Manual", "utilities", [op("button", "Manual Trigger", "trigger")], "Start a run from the UI."),
  builtin("rss", "RSS", "utilities", [op("new_item", "New Item in Feed", "trigger")], "Watch an RSS or Atom feed."),
  builtin("email", "Email", "utilities", [op("new_email", "New Email", "trigger"), op("send", "Send Outbound Email", "action")], "Send and receive email via a custom mailbox."),
  builtin("http", "HTTP", "custom", [op("request", "Custom Request", "action")], "Make authenticated REST API calls."),
  builtin("code", "Code", "custom", [op("javascript", "Run JavaScript", "action"), op("python", "Run Python", "action")], "Write custom Python or JavaScript."),
  builtin("tables", "Tables", "products", [op("new_record", "New Record", "trigger"), op("create_record", "Create Record", "action")], "Workspace data tables."),
  builtin("forms", "Forms", "products", [op("submitted", "New Submission", "trigger")], "Public form submissions start automations."),
  builtin("subflow", "Sub-Zap", "products", [op("run", "Call a Zap", "action")], "Call another published workflow."),
  builtin("agents", "Agents", "products", [op("run", "Run Agent", "action")], "Run a workspace AI agent."),
  builtin("chatbots", "Chatbots", "products", [op("message", "Send Chatbot Message", "action")], "Send a chatbot reply."),
  builtin("openai", "OpenAI", "ai", AI_ACTIONS.map((a) => op(a.key, a.name, "action", a.hint)), "Extract, summarize, classify, write, and more.")
];

function mergeWithBuiltins(apps: CatalogApp[]): CatalogApp[] {
  const bySlug = new Map<string, CatalogApp>();
  for (const app of apps) {
    if (app?.slug) bySlug.set(app.slug, { ...app, operations: app.operations?.length ? app.operations : [] });
  }
  for (const extra of BUILTIN_APPS) {
    const existing = bySlug.get(extra.slug);
    if (!existing) {
      bySlug.set(extra.slug, extra);
      continue;
    }
    const keys = new Set(existing.operations.map((o) => opKey(o) || o.name));
    const operations = [...existing.operations];
    for (const o of extra.operations) {
      const k = opKey(o) || o.name;
      if (!keys.has(k)) operations.push(o);
    }
    bySlug.set(extra.slug, { ...existing, description: existing.description || extra.description, operations });
  }
  return [...bySlug.values()];
}

function AppList({ apps, onSelect }: { apps: CatalogApp[]; onSelect: (app: CatalogApp) => void }) {
  return (
    <div className="grid gap-0.5">
      {apps.map((app) => (
        <button
          key={app.slug}
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => onSelect(app)}
        >
          <AppIcon slug={app.slug} size="sm" />
          <span className="truncate">{app.name}</span>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Check, Copy, ExternalLink, Globe, MessageSquare, Plus, RefreshCw,
  Send, Settings, Trash2,
} from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

type Bot = {
  id: string;
  name: string;
  slug?: string;
  instructions?: string;
  knowledge?: string;
  automationId?: string | null;
  keyword?: string | null;
  is_public?: boolean;
  model?: string | null;
  welcomeMessage?: string | null;
};
type ModelOption = { value: string; label: string; provider: string; available: boolean };
type ChatMessage = { id: number; role: string; content: string; created_at: string };

// ── Settings editor ──────────────────────────────────────────────────────────

function BotSettings({ bot, onClose, onSaved }: { bot: Bot; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(bot.name);
  const [instructions, setInstructions] = useState(bot.instructions ?? "");
  const [knowledge, setKnowledge] = useState(bot.knowledge ?? "");
  const [keyword, setKeyword] = useState(bot.keyword ?? "");
  const [automationId, setAutomationId] = useState(bot.automationId ?? "");
  const [model, setModel] = useState(bot.model ?? "auto");
  const [welcome, setWelcome] = useState(bot.welcomeMessage ?? "");
  const [isPublic, setIsPublic] = useState(bot.is_public !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();

  const modelsQ = useQuery({ queryKey: ["model-options"], queryFn: () => api<{ options: ModelOption[] }>("/ai/model-options") });
  const automationsQ = useQuery({ queryKey: ["automations"], queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations") });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/chatbots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          instructions,
          knowledge,
          keyword: keyword || null,
          automationId: automationId || null,
          model: model === "auto" ? null : model,
          welcomeMessage: welcome || null,
          isPublic,
        }),
      });
      qc.invalidateQueries({ queryKey: ["chatbots"] });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the chatbot");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10"><Settings className="h-4 w-4 text-cyan-600" /></div>
          <h2 className="text-base font-semibold">Chatbot settings</h2>
        </div>
        {error && <p className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-ink-muted">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-ink-muted">Instructions</label>
            <textarea className="min-h-[80px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="How should the bot behave? Tone, scope, rules…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-ink-muted">Knowledge base</label>
            <textarea className="min-h-[70px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder="Paste FAQs, product facts, or docs the bot should answer from…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-ink-muted">Welcome message</label>
            <Input value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder="Hi! How can I help you today?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase text-ink-muted">Model</label>
              <select className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm" value={model} onChange={(e) => setModel(e.target.value)}>
                {(modelsQ.data?.options ?? [{ value: "auto", label: "Auto (best available)", available: true }]).map((o) => (
                  <option key={o.value} value={o.value} disabled={!o.available}>{o.label}{o.available ? "" : " (no key)"}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase text-ink-muted">Keyword trigger</label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. onboard" />
              <p className="text-[10px] text-ink-muted">Messages containing this word start the linked workflow.</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase text-ink-muted">Linked workflow</label>
            <select className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm" value={automationId} onChange={(e) => setAutomationId(e.target.value)}>
              <option value="">None</option>
              {(automationsQ.data?.automations ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 rounded border-line" />
            Public — anyone with the share link can chat
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Conversation panel (persisted history) ──────────────────────────────────

function ChatPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const historyQ = useQuery({
    queryKey: ["chatbot-messages", bot.id],
    queryFn: () => api<{ messages: ChatMessage[] }>(`/chatbots/${bot.id}/messages`),
  });
  const messages = historyQ.data?.messages ?? [];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async () => {
    const text = msg.trim();
    if (!text || sending) return;
    setMsg("");
    setSending(true);
    setError("");
    try {
      await api(`/chatbots/${bot.id}/chat`, { method: "POST", body: JSON.stringify({ message: text }) });
      historyQ.refetch();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Message failed";
      setError(/NO_MODEL_PROVIDER/i.test(raw)
        ? "No AI provider is configured. Add a provider API key to enable live chat."
        : /rate_limited/i.test(raw)
          ? "This bot is rate limited — wait a moment and try again."
          : raw);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="flex h-[75vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-elevated shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500"><MessageSquare className="h-3.5 w-3.5 text-white" /></div>
            <div>
              <span className="text-sm font-semibold">{bot.name}</span>
              <p className="text-[10px] text-ink-muted">Test chat · history is saved</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-muted hover:bg-muted hover:text-danger"
              title="Clear conversation history"
              onClick={async () => {
                await api(`/chatbots/${bot.id}/messages`, { method: "DELETE" });
                historyQ.refetch();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
          </div>
        </div>
        <div ref={scroller} className="flex-1 space-y-3 overflow-auto p-4">
          {messages.length === 0 && !sending && (
            <p className="mt-12 text-center text-sm text-ink-muted">
              {bot.welcomeMessage || "Send a message to test the chatbot."}
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-12" : "mr-12"}>
              <div className={cn(
                "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
                m.role === "user" ? "ml-auto bg-violet-600 text-white rounded-br-md" : "bg-muted rounded-bl-md",
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="mr-12 flex items-center gap-2 text-xs text-ink-muted">
              <Bot className="h-3.5 w-3.5" /> Thinking…
            </div>
          )}
          {error && <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
        <div className="border-t border-line p-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message…" className="flex-1" />
            <Button type="submit" size="sm" disabled={sending || !msg.trim()}><Send className="h-3.5 w-3.5" /></Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChatbotsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const q = useQuery({ queryKey: ["chatbots"], queryFn: () => api<{ chatbots: Bot[] }>("/chatbots") });
  const [openChat, setOpenChat] = useState<Bot | null>(null);
  const [openSettings, setOpenSettings] = useState<Bot | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [embedBot, setEmbedBot] = useState<Bot | null>(null);
  const [deleteBot, setDeleteBot] = useState<Bot | null>(null);

  const bots = q.data?.chatbots ?? [];

  const copyLink = (b: Bot) => {
    const url = `${window.location.origin}/c/${ws}/${b.slug}`;
    void navigator.clipboard.writeText(url).catch(() => undefined);
    setCopiedId(b.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div>
      <PageHeader
        title="Chatbots"
        description="AI assistants powered by the same agent runtime as Agents — with knowledge bases, keyword workflow triggers, and public share links."
        actions={
          <div className="flex items-center gap-2">
            <PageInfo
              title="Chatbots"
              description="Chatbots answer questions from your knowledge, collect leads, and start workflows on keywords. Deploy them on a public link or embed them anywhere."
              tips={[
                "Write clear instructions — the bot follows them in every conversation.",
                "Add a knowledge base so answers stay grounded in your facts.",
                "Set a keyword trigger to start a linked workflow mid-conversation.",
                "Copy the public link or use the embed snippet to deploy the bot.",
              ]}
            />
            <Button onClick={() => { setCreateName("New Chatbot"); setCreateInstructions(""); setCreateOpen(true); }}>
              <Plus className="mr-1 h-3.5 w-3.5" />New chatbot
            </Button>
          </div>
        }
      />

      {!q.isLoading && !bots.length && (
        <EmptyState icon={<MessageSquare className="h-10 w-10" />} title="No chatbots yet" description="Create a bot with knowledge and share the public link." />
      )}

      {createOpen && (
        <Card className="mb-4 space-y-3">
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Chatbot name" autoFocus />
          <textarea className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={createInstructions} onChange={(e) => setCreateInstructions(e.target.value)} placeholder="Instructions for the chatbot — refine everything in settings afterwards." />
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                if (!createName.trim()) return;
                await api("/chatbots", { method: "POST", body: JSON.stringify({ name: createName, instructions: createInstructions || "You are a helpful assistant.", knowledge: "" }) });
                setCreateOpen(false);
                setCreateName("");
                setCreateInstructions("");
                qc.invalidateQueries({ queryKey: ["chatbots"] });
              }}
            >
              Create chatbot
            </Button>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="ws-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bots.map((b) => {
          const publicUrl = `/c/${ws}/${b.slug}`;
          const isPublic = b.is_public !== false;
          return (
            <Card key={b.id} interactive className="group hover:border-cyan-400/40" onClick={() => setOpenChat(b)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
                    <MessageSquare className="h-5 w-5 text-cyan-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{b.name}</h3>
                    <p className="line-clamp-1 text-[11px] text-ink-muted">{b.instructions || "No instructions yet"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-cyan-600"
                    title="Settings"
                    onClick={(e) => { e.stopPropagation(); setOpenSettings(b); }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded-lg p-1 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-danger"
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); setDeleteBot(b); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted"
                  onClick={() => copyLink(b)}
                  title="Copy public link"
                >
                  {copiedId === b.id ? <Check className="h-2.5 w-2.5 text-ok" /> : <Copy className="h-2.5 w-2.5" />}
                  {copiedId === b.id ? "Copied" : "Copy link"}
                </button>
                {isPublic ? (
                  <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                    <ExternalLink className="h-2.5 w-2.5" /> Public chat
                  </a>
                ) : (
                  <span className="flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700">
                    <Globe className="h-2.5 w-2.5" /> Private
                  </span>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted"
                  onClick={() => setEmbedBot(b)}
                >
                  Embed
                </button>
                {b.keyword && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Keyword: {b.keyword}</span>}
                {b.automationId && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">→ Workflow</span>}
              </div>
            </Card>
          );
        })}
      </div>

      {openChat && <ChatPanel bot={openChat} onClose={() => setOpenChat(null)} />}
      {openSettings && <BotSettings bot={openSettings} onClose={() => setOpenSettings(null)} onSaved={() => setOpenSettings(null)} />}
      {embedBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setEmbedBot(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-line bg-elevated p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Embed &ldquo;{embedBot.name}&rdquo;</h2>
            <p className="mt-1 text-xs text-ink-muted">Paste this iframe anywhere the bot should appear.</p>
            <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-[10px] text-ink-muted">{`<iframe\n  src="${typeof window !== "undefined" ? window.location.origin : ""}/c/${ws}/${embedBot.slug}"\n  width="420" height="600"\n  style="border:0;border-radius:16px"\n  title="${embedBot.name}"\n></iframe>`}</pre>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setEmbedBot(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteBot)}
        title={`Delete "${deleteBot?.name ?? ""}"?`}
        body="The chatbot and its conversation history will be removed. This cannot be undone."
        confirmLabel="Delete chatbot"
        danger
        onCancel={() => setDeleteBot(null)}
        onConfirm={async () => {
          if (!deleteBot) return;
          await api(`/chatbots/${deleteBot.id}`, { method: "DELETE" });
          setDeleteBot(null);
          qc.invalidateQueries({ queryKey: ["chatbots"] });
        }}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageInfo } from "@/components/ui/page-info";
import { EmptyState } from "@/components/ui/empty-state";

type Bot = { id: string; name: string; slug: string; instructions: string; knowledge?: string; automation_id?: string | null; keyword?: string | null };

function ChatPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<Array<{ role: "user" | "bot"; text: string }>>([]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="flex h-[70vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-elevated shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500"><MessageSquare className="h-3.5 w-3.5 text-white" /></div>
            <span className="text-sm font-semibold">{bot.name}</span>
          </div>
          <button className="rounded-lg p-1.5 text-ink-muted hover:bg-muted" onClick={onClose}>×</button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {log.length === 0 && <p className="mt-12 text-center text-sm text-ink-muted">Send a message to test the chatbot.</p>}
          {log.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-12" : "mr-12"}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-violet-600 text-white rounded-br-md" : "bg-muted rounded-bl-md"}`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <form className="flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            const userMsg = msg; setMsg("");
            setLog((l) => [...l, { role: "user", text: userMsg }]);
            const d = await api<{ reply: string }>(`/chatbots/${bot.id}/chat`, { method: "POST", body: JSON.stringify({ message: userMsg }) });
            setLog((l) => [...l, { role: "bot", text: d.reply }]);
          }}>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message..." className="flex-1" />
            <Button type="submit" size="sm"><Send className="h-3.5 w-3.5" /></Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ChatbotsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const q = useQuery({ queryKey: ["chatbots"], queryFn: () => api<{ chatbots: Bot[] }>("/chatbots") });
  const [openChat, setOpenChat] = useState<Bot | null>(null);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");

  return (
    <div>
      <PageHeader
        title="Chatbots"
        description="Custom AI assistants with knowledge bases, keyword triggers, and public share links."
        actions={
          <div className="flex items-center gap-2">
            <PageInfo
              title="Chatbots"
              description="Chatbots are conversational AI assistants that answer questions, collect leads, and trigger workflows."
              tips={[
                "Add a knowledge base so the bot has context to answer questions.",
                "Set a keyword trigger (e.g. 'onboard') to start a linked Workflow.",
                "Share the public /c link to embed the bot anywhere.",
                "Test the bot in-app before going live.",
              ]}
            />
            <Button onClick={() => { setCreateName("New Chatbot"); setCreateInstructions(""); }}><Plus className="mr-1 h-3.5 w-3.5" />New chatbot</Button>
          </div>
        }
      />

      {!q.isLoading && !q.data?.chatbots.length && (
        <EmptyState icon={<MessageSquare className="h-10 w-10" />} title="No chatbots yet" description="Create a bot with knowledge and share the public link." />
      )}

      {createName && (
        <Card className="mb-4 space-y-3">
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Chatbot name" autoFocus />
          <textarea className="min-h-[60px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={createInstructions} onChange={(e) => setCreateInstructions(e.target.value)} placeholder="Instructions for the chatbot" />
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (!createName.trim()) return;
              await api("/chatbots", { method: "POST", body: JSON.stringify({ name: createName, instructions: createInstructions || "You are a helpful assistant.", knowledge: "" }) });
              setCreateName(""); setCreateInstructions(""); qc.invalidateQueries({ queryKey: ["chatbots"] });
            }}>Create chatbot</Button>
            <Button variant="ghost" onClick={() => { setCreateName(""); setCreateInstructions(""); }}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(q.data?.chatbots ?? []).map((b) => {
          const publicUrl = `/c/${ws}/${b.slug}`;
          return (
            <Card key={b.id} className="group cursor-pointer transition-all hover:shadow-md hover:border-cyan-400/40" onClick={() => setOpenChat(b)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
                    <MessageSquare className="h-5 w-5 text-cyan-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{b.name}</h3>
                    <p className="line-clamp-1 text-[11px] text-ink-muted">{b.instructions}</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a href={publicUrl} target="_blank" className="flex items-center gap-1 rounded-full border border-line bg-muted/50 px-2 py-0.5 text-[10px] text-ink-muted hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <ExternalLink className="h-2.5 w-2.5" /> Public chat
                </a>
                {b.keyword && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Keyword: {b.keyword}</span>}
                {b.automation_id && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">→ Workflow</span>}
              </div>
            </Card>
          );
        })}
      </div>

      {openChat && <ChatPanel bot={openChat} onClose={() => setOpenChat(null)} />}
    </div>
  );
}

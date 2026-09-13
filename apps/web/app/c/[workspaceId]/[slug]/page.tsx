"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Send } from "lucide-react";
import { API_URL } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { cn } from "../../../../lib/utils";

type Msg = { role: "user" | "bot"; text: string };

export default function PublicChatbotPage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [bot, setBot] = useState<{ name: string; welcomeMessage?: string | null } | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<Msg[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_URL}/public/chatbots/${params.workspaceId}/${params.slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "This chatbot is unavailable.");
        setBot(d.chatbot);
        if (d.chatbot?.welcomeMessage) setLog([{ role: "bot", text: String(d.chatbot.welcomeMessage) }]);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [params.workspaceId, params.slug]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [log.length, sending]);

  const send = async () => {
    const text = msg.trim();
    if (!text || sending) return;
    setMsg("");
    setLog((l) => [...l, { role: "user", text }]);
    setSending(true);
    try {
      const r = await fetch(`${API_URL}/public/chatbots/${params.workspaceId}/${params.slug}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const d = await r.json();
      setLog((l) => [...l, { role: "bot", text: d.reply ?? d.hint ?? "The bot could not answer right now — please try again." }]);
    } catch {
      setLog((l) => [...l, { role: "bot", text: "The chat service is unreachable right now. Please try again in a moment." }]);
    } finally {
      setSending(false);
    }
  };

  if (err) {
    return (
      <main className="mx-auto mt-16 max-w-md p-4">
        <Card className="space-y-2 text-center">
          <p className="text-sm font-semibold text-danger">{err}</p>
          <p className="text-xs text-ink-muted">The link may be wrong, or the owner turned this bot private.</p>
        </Card>
      </main>
    );
  }
  if (!bot) return <main className="mx-auto mt-16 max-w-md p-4 text-sm text-ink-muted">Loading…</main>;

  return (
    <main className="mx-auto mt-8 max-w-md p-4">
      <Card className="flex h-[70vh] flex-col overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500"><Bot className="h-3.5 w-3.5 text-white" /></div>
          <h1 className="text-sm font-semibold">{bot.name}</h1>
        </div>
        <div ref={scroller} className="flex-1 space-y-3 overflow-auto p-4">
          {log.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-10" : "mr-10"}>
              <div className={cn(
                "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm",
                m.role === "user" ? "ml-auto bg-violet-600 text-white rounded-br-md" : "bg-muted rounded-bl-md",
              )}>
                {m.text}
              </div>
            </div>
          ))}
          {sending && <p className="mr-10 text-xs text-ink-muted">Thinking…</p>}
        </div>
        <div className="border-t border-line p-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message" />
            <Button type="submit" disabled={sending || !msg.trim()}><Send className="h-3.5 w-3.5" /></Button>
          </form>
        </div>
      </Card>
    </main>
  );
}

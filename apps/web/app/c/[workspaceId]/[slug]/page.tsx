"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";

export default function PublicChatbotPage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [bot, setBot] = useState<{ name: string } | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<Array<{ role: string; text: string }>>([]);

  useEffect(() => {
    fetch(`${API_URL}/public/chatbots/${params.workspaceId}/${params.slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "not found");
        setBot(d.chatbot);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [params.workspaceId, params.slug]);

  if (err) return <main className="mx-auto mt-16 max-w-md p-4 text-red-400">{err}</main>;
  if (!bot) return <main className="mx-auto mt-16 max-w-md p-4">Loading…</main>;

  return (
    <main className="mx-auto mt-16 max-w-md p-4">
      <Card className="space-y-3">
        <h1 className="text-xl font-semibold">{bot.name}</h1>
        {log.map((m, i) => (
          <p key={i} className="text-sm">
            <strong>{m.role}:</strong> {m.text}
          </p>
        ))}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch(`${API_URL}/public/chatbots/${params.workspaceId}/${params.slug}/chat`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: msg })
            });
            const d = await r.json();
            setLog((l) => [...l, { role: "you", text: msg }, { role: "bot", text: d.reply ?? "…" }]);
            setMsg("");
          }}
        >
          <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message" />
          <Button type="submit">Send</Button>
        </form>
      </Card>
    </main>
  );
}

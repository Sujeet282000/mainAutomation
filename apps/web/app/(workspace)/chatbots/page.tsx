"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type Bot = {
  id: string;
  name: string;
  slug: string;
  instructions: string;
  knowledge?: string;
  automation_id?: string | null;
  keyword?: string | null;
};

export default function ChatbotsPage() {
  const qc = useQueryClient();
  const ws = getWorkspaceId();
  const q = useQuery({ queryKey: ["chatbots"], queryFn: () => api<{ chatbots: Bot[] }>("/chatbots") });
  const autos = useQuery({
    queryKey: ["automations"],
    queryFn: () => api<{ automations: Array<{ id: string; name: string }> }>("/automations")
  });
  const [name, setName] = useState("Support bot");
  const [instructions, setInstructions] = useState("Answer from knowledge. If they say onboard, start the workflow.");
  const [knowledge, setKnowledge] = useState("We onboard new customers within one business day.");
  const [keyword, setKeyword] = useState("onboard");
  const [automationId, setAutomationId] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<Array<{ role: string; text: string }>>([]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Chatbots" description="Custom assistants with knowledge, keyword Zap buttons, and a public share link or embed via Interfaces." />
      <Card className="mb-4 space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bot name" />
        <textarea className="min-h-[80px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <textarea className="min-h-[80px] w-full rounded-lg border border-line bg-elevated p-3 text-sm" value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder="Knowledge" />
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword that starts the linked workflow" />
        <select className="w-full rounded-lg border border-line bg-elevated p-2 text-sm" value={automationId} onChange={(e) => setAutomationId(e.target.value)}>
          <option value="">Linked workflow</option>
          {(autos.data?.automations ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          onClick={async () => {
            await api("/chatbots", {
              method: "POST",
              body: JSON.stringify({ name, instructions, knowledge, keyword, automationId: automationId || undefined })
            });
            qc.invalidateQueries({ queryKey: ["chatbots"] });
          }}
        >
          Create chatbot
        </Button>
      </Card>
      {!q.data?.chatbots.length && !q.isLoading && (
        <EmptyState icon={<MessageSquare className="h-10 w-10" />} title="No chatbots yet" description="Create a bot, add knowledge, and share the public /c link." />
      )}
      {(q.data?.chatbots ?? []).map((b) => (
        <Card key={b.id} className="mb-3">
          <h3 className="font-semibold">{b.name}</h3>
          <p className="mt-1 text-sm text-ink-muted">{b.instructions}</p>
          <a className="mt-2 inline-block text-sm text-teal" href={`/c/${ws}/${b.slug}`}>
            Public chat /c/{ws}/{b.slug}
          </a>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setChatId(b.id);
              setLog([]);
            }}
          >
            Test in app
          </Button>
        </Card>
      ))}
      {chatId && (
        <Card className="space-y-2">
          {log.map((m, i) => (
            <p key={i} className="text-sm">
              <strong>{m.role}:</strong> {m.text}
            </p>
          ))}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = await api<{ reply: string }>(`/chatbots/${chatId}/chat`, {
                method: "POST",
                body: JSON.stringify({ message: msg })
              });
              setLog((l) => [...l, { role: "you", text: msg }, { role: "bot", text: d.reply }]);
              setMsg("");
            }}
          >
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message" />
            <Button type="submit">Send</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

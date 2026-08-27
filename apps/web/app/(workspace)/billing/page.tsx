"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";

type Plan = { slug: string; name: string; monthly_price_cents?: number; task_limit?: number | null };

export default function BillingPage() {
  const q = useQuery({
    queryKey: ["billing"],
    queryFn: () =>
      api<{
        plan?: string;
        stripeConfigured?: boolean;
        plans?: Plan[];
        usage?: Array<{ metric: string; quantity: string }>;
      }>("/billing")
  });
  const [msg, setMsg] = useState("");

  return (
    <div>
      <PageHeader title="Billing" description={`Current plan: ${q.data?.plan ?? "â€”"}. Checkout only runs when Stripe keys exist.`} />
      {msg && <p className="mb-3 text-sm text-warn">{msg}</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {(q.data?.usage ?? []).map((u) => (
          <Card key={u.metric}>
            <div className="text-2xl font-semibold">{u.quantity}</div>
            <div className="text-sm text-ink-muted">{u.metric} today</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(q.data?.plans ?? []).map((p) => (
          <Card key={p.slug}>
            <h3 className="font-semibold">{p.name}</h3>
            <p className="text-sm text-ink-muted">
              ${((p.monthly_price_cents ?? 0) / 100).toFixed(0)}/mo Â· {p.task_limit ?? "unlimited"} tasks
            </p>
            {p.slug !== "free" && (
              <Button
                className="mt-3"
                onClick={async () => {
                  try {
                    const d = await api<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ planSlug: p.slug }) });
                    window.location.href = d.url;
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "Checkout unavailable");
                  }
                }}
              >
                {q.data?.stripeConfigured ? "Subscribe" : "Configure Stripe to subscribe"}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

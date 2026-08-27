"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";

type Plan = { slug: string; name: string; monthly_price_cents: number; task_limit: number | null };

export default function BillingPage() {
  const [data, setData] = useState<{
    plan?: string;
    stripeConfigured?: boolean;
    plans?: Plan[];
    usage?: Array<{ metric: string; quantity: string }>;
  }>({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api("/billing")
      .then(setData)
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mb-4 text-sm text-muted">Current plan: {data.plan ?? "—"}. Usage is metered in Postgres; Stripe Checkout runs only when keys are set.</p>
      {msg && <p className="mb-3 text-sm text-amber-300">{msg}</p>}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {(data.usage ?? []).map((u) => (
          <Card key={u.metric}>
            <h3>{u.quantity}</h3>
            <div className="text-sm text-muted">{u.metric} today</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(data.plans ?? []).map((p) => (
          <Card key={p.slug}>
            <h3>{p.name}</h3>
            <p className="text-sm text-muted">${(p.monthly_price_cents / 100).toFixed(0)}/mo · {p.task_limit ?? "unlimited"} tasks</p>
            {p.slug !== "free" && (
              <Button
                className="mt-3"
                onClick={async () => {
                  try {
                    const d = await api("/billing/checkout", { method: "POST", body: JSON.stringify({ planSlug: p.slug }) });
                    window.location.href = d.url;
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "Checkout unavailable");
                  }
                }}
              >
                {data.stripeConfigured ? "Subscribe" : "Configure Stripe to subscribe"}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

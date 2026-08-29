"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCardGrid, SkeletonStatGrid } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

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
      }>("/billing"),
  });

  return (
    <div>
      <PageHeader title="Billing" description={`Current plan: ${q.data?.plan ?? "—"}. Checkout only runs when Stripe keys exist.`} />

      {q.isLoading ? (
        <>
          <SkeletonStatGrid count={3} />
          <SkeletonCardGrid count={3} />
        </>
      ) : (
        <>
          {q.isError && (
            <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-3">
              <p className="text-sm font-medium text-danger">Failed to load billing info</p>
              <p className="mt-1 text-xs text-danger/70">{(q.error as Error).message}</p>
            </div>
          )}

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
                  ${((p.monthly_price_cents ?? 0) / 100).toFixed(0)}/mo · {p.task_limit ?? "unlimited"} tasks
                </p>
                {p.slug !== "free" && (
                  <Button
                    className="mt-3"
                    onClick={async () => {
                      try {
                        const d = await api<{ url: string }>("/billing/checkout", {
                          method: "POST",
                          body: JSON.stringify({ planSlug: p.slug }),
                        });
                        window.location.href = d.url;
                      } catch (err) {
                        toast.error("Checkout unavailable", { description: err instanceof Error ? err.message : "Stripe may not be configured" });
                      }
                    }}
                  >
                    {q.data?.stripeConfigured ? "Subscribe" : "Configure Stripe to subscribe"}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

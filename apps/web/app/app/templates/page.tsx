"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";

export default function TemplatesPage() {
  const [items, setItems] = useState<Array<{ slug: string; name: string; description: string }>>([]);
  useEffect(() => {
    api("/templates")
      .then((d) => setItems(d.templates ?? []))
      .catch(() => undefined);
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Templates</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((t) => (
          <Card key={t.slug}>
            <h3>{t.name}</h3>
            <p className="mb-3 text-sm text-muted">{t.description}</p>
            <Button
              onClick={async () => {
                const d = await api(`/templates/${t.slug}/use`, { method: "POST" });
                window.location.href = `/app/automations/${d.automation.id}`;
              }}
            >
              Use template
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

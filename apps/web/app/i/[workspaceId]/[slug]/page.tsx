"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../../lib/api";
import { Card } from "../../../../components/ui/card";

type Block = { type: string; text?: string; formId?: string | null; href?: string };

export default function PublicInterfacePage() {
  const params = useParams<{ workspaceId: string; slug: string }>();
  const [page, setPage] = useState<{ name: string; pages: Block[] } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/interfaces/${params.workspaceId}/${params.slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "not found");
        setPage(d.interface);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [params.workspaceId, params.slug]);

  if (err) return <main className="mx-auto mt-16 max-w-lg p-4 text-red-400">{err}</main>;
  if (!page) return <main className="mx-auto mt-16 max-w-lg p-4">Loading…</main>;

  return (
    <main className="mx-auto mt-16 max-w-lg p-4">
      <Card className="space-y-4">
        {(Array.isArray(page.pages) ? page.pages : []).map((b, i) => {
          if (b.type === "heading") return <h1 key={i} className="text-2xl font-semibold">{b.text}</h1>;
          if (b.type === "form" && b.formId) {
            return (
              <p key={i} className="text-sm text-ink-muted">
                Form attached. Open your workspace Forms page for the public /f link.
              </p>
            );
          }
          return (
            <p key={i} className="text-sm">
              {b.text}
            </p>
          );
        })}
      </Card>
    </main>
  );
}

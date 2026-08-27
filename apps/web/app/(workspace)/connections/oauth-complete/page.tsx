"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Inner() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const connectionId = params.get("connectionId") ?? "";
    const app = params.get("app") ?? "";
    const returnTo = params.get("returnTo") || `/connections?app=${encodeURIComponent(app)}`;
    const payload = { type: "oauth-complete", connectionId, app };
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      window.close();
      return;
    }
    const url = new URL(returnTo, window.location.origin);
    if (connectionId) url.searchParams.set("connectionId", connectionId);
    if (app) url.searchParams.set("connected", app);
    router.replace(`${url.pathname}${url.search}`);
  }, [params, router]);

  return <p className="p-8 text-sm text-ink-muted">Finishing connection…</p>;
}

export default function OauthCompletePage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-ink-muted">Finishing connection…</p>}>
      <Inner />
    </Suspense>
  );
}

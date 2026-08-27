"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <p className="text-sm font-medium text-violet-700">Something went wrong</p>
      <h1 className="text-2xl font-semibold">This page could not load</h1>
      <p className="max-w-md text-sm text-ink-muted">{error.message || "An unexpected error occurred."}</p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="secondary">Home</Button>
        </Link>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { COMMANDS } from "./nav";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("av:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("av:command", onOpen);
    };
  }, []);

  const items = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [q]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="mx-auto mt-[12vh] max-w-lg overflow-hidden rounded-2xl border border-line bg-elevated shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pages and actions…"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-auto p-2">
          {items.map((c) => (
            <li key={c.href}>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setOpen(false);
                  router.push(c.href);
                }}
              >
                {c.label}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">No matches</li>}
        </ul>
        <div className="border-t border-line px-3 py-2 text-[11px] text-ink-muted">⌘K / Ctrl+K to toggle</div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * FlowShip brand mark: three stacked "automation lanes" with dots that pulse
 * in a continuous data-flow loop, a play-triangle that lights up on hover,
 * and a violet→teal gradient sweep across the wordmark.
 *
 * `compact` renders only the mark (sidebar collapsed state).
 * `href` wraps the logo in a link (marketing pages).
 */
export function Logo({ compact, href }: { compact?: boolean; href?: string }) {
  const [cycle, setCycle] = useState(0);

  // Data-flow loop: every ~1.6s advance which lane is "active", echoing the
  // editor's step-by-step test run animation.
  useEffect(() => {
    if (compact) return; // keep the collapsed rail calm
    const t = setInterval(() => setCycle((c) => (c + 1) % 3), 1600);
    return () => clearInterval(t);
  }, [compact]);

  const inner = (
    <span className="group inline-flex items-center gap-2.5" aria-label="FlowShip home">
      <span className="relative inline-flex h-9 w-9 items-center justify-center">
        {/* animated glow halo — makes the mark pop on both themes */}
        <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-violet-500/40 via-fuchsia-400/25 to-teal/30 opacity-70 blur-md transition-opacity duration-500 group-hover:opacity-100 animate-pulse-glow" />
        <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-600 via-violet-500 to-teal shadow-md shadow-violet-600/25 transition-transform duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-violet-500/30">
        {/* sheen sweep on hover */}
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          {/* three automation lanes */}
          <rect x="5" y="7.4" width="18" height="3" rx="1.5" className="fill-white/85" />
          <rect x="5" y="14.5" width="13" height="3" rx="1.5" className="fill-white/85" />
          <rect x="5" y="21.6" width="9" height="3" rx="1.5" className="fill-white/85" />
          {/* active dot travels the lanes in sequence */}
          <circle
            cx={cycle === 0 ? 25.5 : 8.5}
            cy="8.9"
            r="2.6"
            className={cn("fill-white transition-all duration-500", cycle === 0 && "drop-shadow-[0_0_4px_rgba(255,255,255,0.9)]")}
          />
          <circle
            cx={cycle === 1 ? 20.5 : 8.5}
            cy="16"
            r="2.6"
            className={cn("fill-white transition-all duration-500", cycle === 1 && "drop-shadow-[0_0_4px_rgba(255,255,255,0.9)]")}
          />
          <circle
            cx={cycle === 2 ? 16.5 : 8.5}
            cy="23.1"
            r="2.6"
            className={cn("fill-white transition-all duration-500", cycle === 2 && "drop-shadow-[0_0_4px_rgba(255,255,255,0.9)]")}
          />
          {/* play triangle — lights on hover */}
          <path d="M25 18.2l4.2 3.3-4.2 3.3z" className="fill-white opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
        </svg>
        </span>
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block bg-gradient-to-r from-violet-700 via-violet-600 to-teal bg-clip-text text-[15px] font-bold tracking-tight text-transparent transition-all duration-300 dark:from-violet-300 dark:via-violet-400 dark:to-teal">
            FlowShip
          </span>
          <span className="block text-[9px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Automation
          </span>
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        {inner}
      </Link>
    );
  }
  return inner;
}

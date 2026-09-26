import * as React from "react";
import { cn } from "../lib/cn";

/** The webclient BRAND mark: a fan-out "plan graph" glyph -- one node fanning to two, the
 * crawl / fan-out the package is built on. Uses `currentColor`, so colour it with a text
 * class (defaults to the accent). The same mark is shared, verbatim, with the Python lab. */
export function BrandMark({ size = 19, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("shrink-0 text-accent", className)}>
      <path d="M7.4 8.2 14.6 11 M7.4 15.8 14.6 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="6" cy="7" r="2.5" fill="currentColor" />
      <circle cx="6" cy="17" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** The wordmark: the mark + `webclient` + an optional muted tag (the surface -- "playground",
 * "lab"). One identity across the app, the site and the lab. */
export function Brand({ tag, size, className }: { tag?: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink", className)}>
      <BrandMark size={size} />
      <span>webclient</span>
      {tag && <span className="border-l border-line-2 pl-2 font-medium tracking-wide text-muted">{tag}</span>}
    </span>
  );
}

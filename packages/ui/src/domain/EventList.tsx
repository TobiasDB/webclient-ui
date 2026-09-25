import * as React from "react";
import { cn } from "../lib/cn";
import { TopicChip } from "./TopicChip";
import type { Event } from "../types";

const SKIP = new Set(["topic", "n", "seq", "ts", "version", "source", "document_id", "session_id", "plan_id", "node_id"]);

/** One line of an event's payload, for the list (not the JSON). */
export function briefOf(e: Event): string {
  return Object.entries(e).filter(([k, v]) => !SKIP.has(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}`).join("  ");
}

export type EventListProps = {
  events: Event[];
  cursor: number;
  onCursor: (index: number) => void;
  /** Group by document (collapsible). */
  groupByDocument?: boolean;
  className?: string;
  relativeTo?: number;
};

/** The event list that follows the scrubber: #n · topic · brief; grouped by document when
 * asked; the row at the cursor is highlighted and kept in view (story 7.1). */
export function EventList({ events, cursor, onCursor, groupByDocument, className, relativeTo }: EventListProps) {
  const active = React.useRef<HTMLLIElement>(null);
  // scroll the LIST, not the page (scrollIntoView scrolls every ancestor: the workspace would jump)
  React.useEffect(() => { const el = active.current; if (!el) return; let box: HTMLElement | null = el.parentElement; while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement; if (!box) return; const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top) box.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom; }, [cursor]);
  const t0 = relativeTo ?? events[0]?.ts ?? 0;
  const groups = React.useMemo(() => {
    if (!groupByDocument) return [{ key: "", items: events.map((e, i) => ({ e, i })) }];
    const m = new Map<string, { e: Event; i: number }[]>();
    events.forEach((e, i) => { const k = e.document_id || "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push({ e, i }); });
    return [...m].map(([key, items]) => ({ key, items }));
  }, [events, groupByDocument]);
  return (
    <div className={cn("min-w-0 overflow-auto font-mono text-[12px]", className)}>
      {groups.map((g) => (
        <details key={g.key} open className="group">
          {g.key && <summary className="sticky top-0 cursor-pointer bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{g.key} · {g.items.length}</summary>}
          <ol>
            {g.items.map(({ e, i }) => (
              <li key={i} ref={i === cursor ? active : undefined} onClick={() => onCursor(i)}
                className={cn("flex min-w-0 cursor-pointer flex-col gap-0.5 border-b border-line px-2 py-0.5 hover:bg-surface-2", i === cursor && "bg-accent-soft")}>
                {/* two lines, never wider than the column: #n · +ms · topic, then what happened (wrapped, two lines at most) */}
                <span className="flex min-w-0 items-center gap-2 text-[11px]">
                  <span className="shrink-0 text-muted">#{e.n ?? i}</span>
                  <span className="shrink-0 text-muted">{e.ts != null ? `+${Math.round((e.ts - t0) * 1000)} ms` : ""}</span>
                  <span className="min-w-0 truncate"><TopicChip topic={e.topic} /></span>
                </span>
                <span className="line-clamp-2 min-w-0 break-all text-[11px] text-ink-2" title={briefOf(e)}>{briefOf(e) || <span className="text-muted">—</span>}</span>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}

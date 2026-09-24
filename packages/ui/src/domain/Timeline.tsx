import * as React from "react";
import { cn } from "../lib/cn";
import { topicColorVar } from "./TopicChip";
import { topicRoot, type Event } from "../types";

const LANES = ["network", "dom", "action", "loop", "pipeline", "error", "snapshot", "resource", "script", "rrweb", "console", "plan"];

export type TimelineProps = {
  events: Event[];
  /** The scrubber position as an event index (into `events`), controlled. */
  cursor: number;
  onCursor: (index: number) => void;
  className?: string;
  /** Lanes to show (default: every topic present). */
  lanes?: string[];
  height?: number;
};

/** ONE axis, many lanes (UX principle 3): each event is a tick on its topic's lane at its
 * time; the scrubber is a vertical line the user drags (or ←/→); the parent moves the
 * snapshot / replay / list with it (story 7.1). */
export function Timeline({ events, cursor, onCursor, className, lanes, height = 120 }: TimelineProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const t0 = events[0]?.ts ?? 0;
  const t1 = events[events.length - 1]?.ts ?? t0 + 1;
  const span = Math.max(t1 - t0, 0.001);
  const shown = (lanes ?? LANES).filter((l) => events.some((e) => topicRoot(e.topic) === l));
  const x = (e: Event) => (((e.ts ?? t0) - t0) / span) * 100;
  const cur = events[cursor];

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !events.length) return;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = t0 + frac * span;
    let best = 0;
    events.forEach((e, i) => { if (Math.abs((e.ts ?? t0) - t) < Math.abs((events[best]?.ts ?? t0) - t)) best = i; });
    onCursor(best);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); onCursor(Math.min(events.length - 1, cursor + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); onCursor(Math.max(0, cursor - 1)); }
    if (e.key === "Home") onCursor(0);
    if (e.key === "End") onCursor(events.length - 1);
  };

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1 flex justify-between font-mono text-[10px] text-muted"><span>0 ms</span><span>{Math.round(span * 1000)} ms</span></div>
      <div ref={ref} tabIndex={0} onKeyDown={onKey} role="slider" aria-valuemin={0} aria-valuemax={events.length - 1} aria-valuenow={cursor}
        onMouseDown={(e) => { pick(e.clientX); const move = (m: MouseEvent) => pick(m.clientX); const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); }}
        className="relative cursor-col-resize rounded-md border border-line bg-surface-2 outline-none focus-visible:outline-2 focus-visible:outline-accent" style={{ height }}>
        {shown.map((lane, li) => (
          <div key={lane} className="absolute left-0 right-0 border-t border-line/60" style={{ top: `${(li / shown.length) * 100}%`, height: `${100 / shown.length}%` }}>
            <span className="absolute left-1 top-0 font-mono text-[9px] uppercase text-muted">{lane}</span>
            {events.map((e, i) => topicRoot(e.topic) === lane && (
              <span key={i} title={`#${e.n ?? i} ${e.topic}`} className={cn("absolute bottom-1 w-[3px] rounded-sm", i === cursor ? "h-3/4" : "h-1/2")}
                style={{ left: `calc(${x(e)}% - 1px)`, background: topicColorVar(e.topic), opacity: i === cursor ? 1 : 0.75 }} />
            ))}
          </div>
        ))}
        {cur && <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-ink" style={{ left: `${x(cur)}%` }}>
          <span className="absolute -top-0.5 left-1 rounded bg-ink px-1 font-mono text-[9px] text-surface">#{cur.n ?? cursor} {cur.topic}</span>
        </div>}
      </div>
    </div>
  );
}

import * as React from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { topicColorVar } from "./TopicChip";

export type ReplayPlayerProps = {
  /** The trace as rrweb events (`/traces/{id}/rrweb`): the DOM -- recorded, or synthesised
   * from snapshots for a static run -- plus every other event as an rrweb custom event
   * tagged with its topic. ONE list drives the whole replay. */
  events: Array<Record<string, unknown>>;
  /** Seek to this absolute timestamp (ms since epoch, rrweb's clock) when it changes. */
  seekTo?: number | null;
  /** The player's clock, as it plays or is scrubbed: absolute ms. The panes follow it. */
  onTime?: (ms: number) => void;
  /** A custom event (one of ours) reached during playback: its topic and wire payload. */
  onEvent?: (topic: string, payload: Record<string, unknown>) => void;
  width?: number;
  height?: number;
  className?: string;
};

/** The unified replay: rrweb-player is the master clock. It rebuilds the DOM, marks every
 * other event on its progress bar (coloured by topic) and reports the time it is at, so the
 * snapshot, network, console, loop and error panes all sit at the same instant (story 7.1). */
export function ReplayPlayer({ events, seekTo, onTime, onEvent, width = 800, height = 450, className }: ReplayPlayerProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const player = React.useRef<any>(null);
  const start = Number((events[0] as any)?.timestamp ?? 0);
  const cbs = React.useRef({ onTime, onEvent });
  cbs.current = { onTime, onEvent };
  React.useEffect(() => {
    if (!host.current || events.length < 2) return;
    host.current.innerHTML = "";
    const tags: Record<string, string> = {};
    for (const e of events) if (e.type === 5) { const tag = String((e.data as any)?.tag ?? ""); if (tag && !tags[tag]) tags[tag] = cssColour(topicColorVar(tag)); }
    const p: any = new rrwebPlayer({ target: host.current, props: { events: events as any, width, height, autoPlay: false, showController: true, speedOption: [1, 2, 4, 8], tags } as any });
    player.current = p;
    try {
      p.addEventListener("ui-update-current-time", (ev: any) => cbs.current.onTime?.(start + Number(ev?.payload ?? 0)));
      p.getReplayer?.().on("custom-event", (ev: any) => cbs.current.onEvent?.(String(ev?.data?.tag ?? ""), (ev?.data?.payload ?? {}) as Record<string, unknown>));
    } catch { /* an older player without these hooks */ }
    return () => { try { p.$destroy?.(); } catch { /* already gone */ } player.current = null; };
  }, [events, width, height, start]);
  React.useEffect(() => {
    if (seekTo == null || !player.current || !events.length) return;
    try { player.current.goto(Math.max(0, seekTo - start), false); } catch { /* not ready */ }
  }, [seekTo, events, start]);
  if (events.length < 2) return <div className={className}><span className="text-[12px] text-muted">Nothing to replay: the trace holds no document snapshot.</span></div>;
  return <div ref={host} className={className} />;
}

/** rrweb-player paints tag markers with a plain colour string; resolve our CSS variable. */
function cssColour(v: string): string {
  if (typeof window === "undefined") return v;
  const m = /var\((--[^)]+)\)/.exec(v);
  if (!m) return v;
  const got = getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim();
  return got || "#888";
}

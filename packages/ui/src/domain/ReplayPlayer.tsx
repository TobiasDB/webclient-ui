import * as React from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";

export type ReplayPlayerProps = {
  /** rrweb events (as recorded; the trace endpoint returns them flattened). */
  events: Array<Record<string, unknown>>;
  /** Seek to this absolute timestamp (ms since epoch, rrweb's clock) when it changes. */
  seekTo?: number | null;
  width?: number;
  height?: number;
  className?: string;
};

/** The DOM replay (rrweb-player) that follows the trace scrubber: the parent passes the
 * event's timestamp and the player seeks to it (story 7.1). */
export function ReplayPlayer({ events, seekTo, width = 800, height = 450, className }: ReplayPlayerProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const player = React.useRef<any>(null);
  React.useEffect(() => {
    if (!host.current || events.length < 2) return;
    host.current.innerHTML = "";
    player.current = new rrwebPlayer({ target: host.current, props: { events: events as any, width, height, autoPlay: false, showController: true, speedOption: [1, 2, 4, 8] } });
    return () => { try { player.current?.$destroy?.(); } catch { /* already gone */ } player.current = null; };
  }, [events, width, height]);
  React.useEffect(() => {
    if (seekTo == null || !player.current || !events.length) return;
    const start = Number((events[0] as any).timestamp ?? 0);
    try { player.current.goto(Math.max(0, seekTo - start), false); } catch { /* not ready */ }
  }, [seekTo, events]);
  if (events.length < 2) return <div className={className}><span className="text-[12px] text-muted">No DOM recording in this trace (rrweb records only under a trace on a browser page).</span></div>;
  return <div ref={host} className={className} />;
}

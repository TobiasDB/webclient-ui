import * as React from "react";
import { Pause, Play, Radio } from "lucide-react";
import { cn } from "../lib/cn";
import { Chip } from "../primitives/Chip";
import { Button } from "../primitives/Button";
import { TopicChip } from "./TopicChip";
import { briefOf } from "./EventList";
import { topicRoot, type Event } from "../types";

export type RunBarProps = {
  events: Event[];
  connected: boolean;
  paused: boolean;
  onPause: (paused: boolean) => void;
  tracing?: boolean;
  onTrace?: (on: boolean) => void;
  onOpen?: (e: Event) => void;
  className?: string;
  height?: number;
};

/** The persistent live stream at the bottom of every workspace (story 10.2): one line per
 * event in the topic colours, a topic filter, pause, and a "start trace" toggle. */
export function RunBar({ events, connected, paused, onPause, tracing, onTrace, onOpen, className, height = 140 }: RunBarProps) {
  const [hidden, setHidden] = React.useState<Set<string>>(new Set(["console", "dom", "rrweb", "script"]));
  const topics = [...new Set(events.map((e) => topicRoot(e.topic)))].sort();
  const list = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => { const l = list.current; if (!paused && l) l.scrollTop = l.scrollHeight; }, [events.length, paused]);  // the list, not the page
  const shown = events.filter((e) => !hidden.has(topicRoot(e.topic)));
  return (
    <div className={cn("flex shrink-0 flex-col border-t border-line bg-surface", className)} style={{ height }}>
      <div className="flex h-8 items-center gap-2 border-b border-line px-2">
        <Chip tone={connected ? "ok" : "bad"} dot>{connected ? "live" : "offline"}</Chip>
        <div className="flex flex-wrap gap-1">
          {topics.map((t) => (
            <button key={t} type="button" onClick={() => setHidden((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}
              className={cn("rounded px-1", hidden.has(t) && "opacity-40")}><TopicChip topic={t} /></button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{shown.length} / {events.length}</span>
        {onTrace && <Button size="sm" variant={tracing ? "danger" : "ghost"} onClick={() => onTrace(!tracing)}><Radio size={12} /> {tracing ? "stop trace" : "start trace"}</Button>}
        <Button size="sm" variant="ghost" onClick={() => onPause(!paused)} aria-label={paused ? "resume" : "pause"}>{paused ? <Play size={12} /> : <Pause size={12} />}</Button>
      </div>
      <ol ref={list} className="min-h-0 flex-1 overflow-auto font-mono text-[11px]">
        {shown.map((e, i) => (
          <li key={i} onClick={() => onOpen?.(e)} className="grid cursor-pointer grid-cols-[40px_150px_120px_1fr] gap-2 px-2 py-px hover:bg-surface-2">
            <span className="text-muted">#{e.n ?? ""}</span><TopicChip topic={e.topic} /><span className="truncate text-muted">{e.document_id ?? ""}</span>
            <span className="truncate text-ink-2">{briefOf(e)}</span>
          </li>
        ))}
        {!shown.length && <li className="p-2 text-muted">Nothing yet — run something and the engine's events appear here.</li>}
      </ol>
    </div>
  );
}

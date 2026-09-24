import * as React from "react";
import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { cn } from "../lib/cn";
import { topicColorVar } from "./TopicChip";
import { usePlayerState, type PlayerController } from "./PlayerController";

const SPEEDS = [0.5, 1, 2, 4, 8];

/** The replay's transport: play/pause, step to the previous/next event, a scrubber with
 * every event of the run as a topic-coloured marker, speed, skip idle. A separate widget
 * driven by a PlayerController, so it can sit anywhere -- pinned to the bottom of the
 * screen while the page above scrolls. */
export function MediaBar({ controller, className }: { controller: PlayerController; className?: string }) {
  const s = usePlayerState(controller);
  const a = controller.actions;
  const track = React.useRef<HTMLDivElement>(null);
  const onTrack = (e: React.MouseEvent) => {
    const rct = track.current?.getBoundingClientRect(); if (!rct) return;
    const f = (clientX: number) => a.seekFrac((clientX - rct.left) / rct.width);
    f(e.clientX);
    const mv = (m: MouseEvent) => f(m.clientX); const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  };
  const total = Math.max(1, s.total);
  const staticOnly = !s.live && s.markers.length === 0 && s.total <= 1;
  return (
    <div className={cn("wc-mediabar flex items-center gap-2 border-t border-line bg-surface px-2 py-1.5 text-[12px]", className)}>
      {s.live ? <span className="inline-flex items-center gap-1 text-ok"><Radio size={13} className="animate-pulse" /> live</span> : (
        <>
          <button type="button" className="wc-mb" onClick={() => a.step(-1)} title="previous event (←)"><SkipBack size={14} /></button>
          <button type="button" className="wc-mb wc-mb-primary" onClick={a.toggle} title={s.playing ? "pause (space)" : "play (space)"} disabled={staticOnly}>{s.playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <button type="button" className="wc-mb" onClick={() => a.step(1)} title="next event (→)"><SkipForward size={14} /></button>
          <span className="w-[92px] font-mono text-[11px] text-muted">{fmt(s.time)} / {fmt(total)}</span>
        </>
      )}
      <div ref={track} className="relative h-6 min-w-[120px] flex-1 cursor-pointer" onMouseDown={s.live ? undefined : onTrack}>
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-line" />
        {!s.live && <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded bg-accent" style={{ width: `${(s.time / total) * 100}%` }} />}
        {!s.live && s.markers.map((m, i) => <span key={i} className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-sm" style={{ left: `${((m.t - s.startTime) / total) * 100}%`, background: topicColorVar(m.tag), opacity: 0.85 }} title={m.tag} />)}
        {!s.live && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface" style={{ left: `${(s.time / total) * 100}%` }} />}
      </div>
      {!s.live && <>
        <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={s.speed} onChange={(e) => a.setSpeed(Number(e.target.value))}>{SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}</select>
        <label className="inline-flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={s.skip} onChange={(e) => a.setSkip(e.target.checked)} /> skip idle</label>
      </>}
      <span className="hidden font-mono text-[10px] text-muted sm:inline">{s.size.w}×{s.size.h} · {Math.round(s.scale * 100)}%</span>
    </div>
  );
}

function fmt(ms: number): string { const s = Math.max(0, ms) / 1000; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`; }

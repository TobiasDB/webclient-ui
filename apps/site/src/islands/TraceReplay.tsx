import * as React from "react";
import { Chip, EmptyState, EventList, Player, StageRail, topicRoot, type Event, type PipelineEvent, type StageInfo } from "@webclient/ui";
import { api } from "../lib/api";

/** Stories C5 / C6: a recorded run replayed at the reader's pace. ONE stream: the Player
 * (the page, the mouse, every request / action / gate as it happened) is the clock; the
 * stage rail and the event list follow it. Nothing runs live -- the trace is the demo. */
export function TraceReplay({ trace, height = 520 }: { trace: string; height?: number }) {
  const [events, setEvents] = React.useState<Event[] | null>(null);
  const [rr, setRr] = React.useState<Record<string, unknown>[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const [seek, setSeek] = React.useState<number | null>(null);
  React.useEffect(() => {
    api.traceEvents(trace).then((ev) => setEvents(ev.filter((e) => !["trace", "script", "resource"].includes(topicRoot(e.topic))))).catch((e) => setErr(String(e.message)));
    api.traceRrweb(trace).then(setRr).catch(() => setRr([]));
  }, [trace]);
  const stages = React.useMemo<StageInfo[]>(() => {
    const st = new Map<string, StageInfo>();
    for (const e of events ?? []) if (e.topic === "pipeline") { const p = e as PipelineEvent; const s = st.get(p.stage) ?? { name: p.stage, status: "pending" as const }; if (p.phase === "enter") s.status = "running"; if (p.phase === "exit") s.status = "done"; if (p.phase === "error") s.status = "failed"; if (p.phase === "gate") s.gate = p.detail.passed === false ? "failed" : "passed"; st.set(p.stage, s); }
    return [...st.values()];
  }, [events]);
  const follow = React.useCallback((ms: number) => { let best = 0; (events ?? []).forEach((e, i) => { if ((e.ts ?? 0) * 1000 <= ms) best = i; }); setCursor(best); }, [events]);
  if (err) return <EmptyState title="No recorded run to replay" hint={`${err} — the service serves traces from its traces dir; this page expects one named "${trace}".`} />;
  if (!events) return <div className="text-[12px] text-muted">loading the recording…</div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]"><Chip tone="warn">demo model</Chip><Chip>recorded · {events.length} events</Chip><span className="text-muted">press play, or step through the events</span></div>
      {stages.length > 0 && <StageRail stages={stages} />}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Player events={rr as any} seekTo={seek} onTime={follow} maxHeight={height} />
        <EventList events={events} cursor={cursor} onCursor={(i) => { setCursor(i); const e = events[i]; if (e?.ts) setSeek(e.ts * 1000); }} className="max-h-[560px] overflow-auto rounded-md border border-line" />
      </div>
    </div>
  );
}

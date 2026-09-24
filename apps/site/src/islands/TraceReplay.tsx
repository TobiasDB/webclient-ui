import * as React from "react";
import { Chip, EmptyState, EventList, ReplayPlayer, StageRail, Timeline, topicRoot, type Event, type PipelineEvent, type StageInfo } from "@webclient/ui";
import { api } from "../lib/api";

/** Stories C5 / C6: a recorded run replayed at the reader's pace. ONE stream: the rrweb
 * player (the DOM, with every event marked on its bar) is the clock; the stage rail, the
 * timeline and the event list follow it. Nothing runs live -- the trace is the demo. */
export function TraceReplay({ trace, height = 380 }: { trace: string; height?: number }) {
  const [events, setEvents] = React.useState<Event[] | null>(null);
  const [rr, setRr] = React.useState<Record<string, unknown>[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  React.useEffect(() => {
    api.traceEvents(trace).then((ev) => { setEvents(ev.filter((e) => e.topic !== "trace")); }).catch((e) => setErr(String(e.message)));
    api.traceRrweb(trace).then(setRr).catch(() => setRr([]));
  }, [trace]);
  const stages = React.useMemo<StageInfo[]>(() => {
    const st = new Map<string, StageInfo>();
    for (const e of events ?? []) if (e.topic === "pipeline") { const p = e as PipelineEvent; const s = st.get(p.stage) ?? { name: p.stage, status: "pending" as const }; if (p.phase === "enter") s.status = "running"; if (p.phase === "exit") s.status = "done"; if (p.phase === "error") s.status = "failed"; if (p.phase === "gate") s.gate = p.detail.passed === false ? "failed" : "passed"; st.set(p.stage, s); }
    return [...st.values()];
  }, [events]);
  const cur = events?.[cursor];
  const follow = React.useCallback((ms: number) => { let best = 0; (events ?? []).forEach((e, i) => { if ((e.ts ?? 0) * 1000 <= ms) best = i; }); setCursor(best); }, [events]);
  if (err) return <EmptyState title="No recorded run to replay" hint={`${err} — the service serves traces from its traces dir; this page expects one named "${trace}".`} />;
  if (!events) return <div className="text-[12px] text-muted">loading the recording…</div>;
  const topics = [...new Set(events.map((e) => topicRoot(e.topic)))];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]"><Chip tone="warn">demo model</Chip><Chip>recorded · {events.length} events</Chip><span className="text-muted">{topics.join(" · ")}</span></div>
      {stages.length > 0 && <StageRail stages={stages} />}
      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <ReplayPlayer events={rr} seekTo={cur?.ts ? cur.ts * 1000 : null} onTime={follow} width={640} height={height} />
        <div className="flex min-h-0 flex-col gap-2">
          <Timeline events={events} cursor={cursor} onCursor={setCursor} height={96} />
          <EventList events={events} cursor={cursor} onCursor={setCursor} className="max-h-72 overflow-auto rounded-md border border-line" />
        </div>
      </div>
    </div>
  );
}

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AskCard, Chip, EmptyState, Panel, StageRail, type Event, type LoopEvent, type PipelineEvent, type StageInfo } from "@webclient/ui";
import { api } from "../lib/api";

/** Loops & pipelines (stories 3.2, 5.1, 10.2): what the engine is driving right now -- every
 * loop's rounds from the live stream, and every Ask waiting for a human, answerable here. */
export function Loops({ liveEvents }: { liveEvents: Event[] }) {
  const qc = useQueryClient();
  const waiting = useQuery({ queryKey: ["loops"], queryFn: api.loops, refetchInterval: 3000 });
  const loops = React.useMemo(() => {
    const m = new Map<string, LoopEvent[]>();
    for (const e of liveEvents) if (e.topic === "loop") { const le = e as LoopEvent; if (!m.has(le.loop)) m.set(le.loop, []); m.get(le.loop)!.push(le); }
    return [...m];
  }, [liveEvents]);
  const pipelines = React.useMemo(() => {
    const m = new Map<string, PipelineEvent[]>();
    for (const e of liveEvents) if (e.topic === "pipeline") { const pe = e as PipelineEvent; if (!m.has(pe.pipeline)) m.set(pe.pipeline, []); m.get(pe.pipeline)!.push(pe); }
    return [...m];
  }, [liveEvents]);
  const stagesOf = (evs: PipelineEvent[]): StageInfo[] => {
    const order: string[] = []; const st = new Map<string, StageInfo>();
    for (const e of evs) {
      if (!st.has(e.stage)) { order.push(e.stage); st.set(e.stage, { name: e.stage, status: "pending" }); }
      const s = st.get(e.stage)!;
      if (e.phase === "enter") s.status = "running";
      if (e.phase === "exit") s.status = e.detail.stopped ? "failed" : "done";
      if (e.phase === "error") s.status = "failed";
      if (e.phase === "gate") { if (e.detail.waiting) s.status = "waiting"; else s.gate = e.detail.passed === false ? "failed" : "passed"; }
      if (e.phase === "review") s.review = typeof e.detail.review === "object" && e.detail.review ? String((e.detail.review as { verdict?: string }).verdict ?? "reviewed") : "reviewed";
    }
    return order.map((n) => st.get(n)!);
  };
  return (
    <div className="grid h-full grid-cols-[1fr_1fr] gap-3 p-3">
      <Panel title="Waiting for a decision">
        {waiting.data?.length ? waiting.data.map((w) => (
          <div key={w.id} className="mb-2"><AskCard ask={w.ask} from={w.id} kind={w.kind} onAnswer={async (a) => { await api.resume(w.id, a); qc.invalidateQueries({ queryKey: ["loops"] }); }}>
            {w.kind === "crawl" ? "Pick the edges to expand (a URL, or several)." : "Pick the next transport tier."}
          </AskCard></div>
        )) : <EmptyState title="Nothing is waiting" hint="When a driver returns an Ask (a crawl picking edges, a resolve choosing a tier) it appears here as a decision card." />}
      </Panel>
      <div className="grid min-h-0 grid-rows-2 gap-3">
        <Panel title="Loops (live)" flush>
          {loops.length ? <ul>{loops.map(([name, evs]) => { const last = evs[evs.length - 1]!; return (
            <li key={name} className="border-b border-line px-3 py-2 text-[12px]"><b>{name}</b> <Chip tone={last.phase === "waiting" ? "warn" : last.phase === "done" ? "ok" : last.phase === "error" ? "bad" : "neutral"}>{last.phase}</Chip> <span className="text-muted">round {last.round} · {evs.length} events</span>
              <div className="mt-1 flex flex-wrap gap-1">{evs.slice(-12).map((e, i) => <span key={i} className="rounded bg-surface-2 px-1 font-mono text-[10px] text-muted">{e.round}:{e.phase}</span>)}</div></li>); })}</ul>
          : <EmptyState title="No loops yet" hint="Run a crawl, a locate, an auto resolve or a query loop through the API and its rounds stream here." />}
        </Panel>
        <Panel title="Pipelines (live)">
          {pipelines.length ? pipelines.map(([name, evs]) => <div key={name} className="mb-3"><div className="mb-1 text-[12px] font-semibold">{name}</div><StageRail stages={stagesOf(evs)} /></div>)
          : <EmptyState title="No pipelines yet" hint="An onboarding run (interactive or not) shows its stage rail here." />}
        </Panel>
      </div>
    </div>
  );
}

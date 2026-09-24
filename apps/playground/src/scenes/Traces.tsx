import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, CodeBlock, EmptyState, ErrorCard, EventList, MediaBar, Player, TabPanel, Tabs, TopicChip, topicRoot, usePlayerController, type ErrorEvent, type Event } from "@webclient/ui";
import { api } from "../lib/api";

/** Traces (stories 7.1-7.3): the Player IS the trace -- the page as it changed, the mouse,
 * the scrolls, every network request / action / loop / error marked on its bar and pulsing
 * on the page as they happen. The side column is the ledger of the same events, in step. */
export function Traces() {
  const { id } = useParams();
  const nav = useNavigate();
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.traces });
  const events = useQuery({ queryKey: ["trace-events", id], queryFn: () => api.traceEvents(id!), enabled: !!id });
  const rrweb = useQuery({ queryKey: ["trace-rrweb", id], queryFn: () => api.traceRrweb(id!), enabled: !!id });
  const plan = useQuery({ queryKey: ["trace-plan", id], queryFn: () => api.tracePlan(id!).catch(() => null), enabled: !!id });
  const [cursor, setCursor] = React.useState(0);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set(["script", "resource", "trace"]));
  const [tab, setTab] = React.useState("events");
  const [seek, setSeek] = React.useState<number | null>(null);
  const controller = usePlayerController();
  const all = React.useMemo(() => (events.data ?? []).filter((e) => e.topic !== "trace"), [events.data]);
  const shown = React.useMemo(() => all.filter((e) => !hidden.has(topicRoot(e.topic))), [all, hidden]);
  const cur = shown[cursor];
  const topics = [...new Set(all.map((e) => topicRoot(e.topic)))].sort();
  const errors = all.filter((e) => e.topic === "error") as ErrorEvent[];
  const follow = React.useCallback((ms: number) => { let best = 0; shown.forEach((e, i) => { if ((e.ts ?? 0) * 1000 <= ms) best = i; }); setCursor(best); }, [shown]);
  const jump = (i: number) => { setCursor(i); const e = shown[i]; if (e?.ts) setSeek(e.ts * 1000); };

  if (!id) return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="rounded-lg border border-line">
        <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Traces</div>
        {traces.data?.length ? <ul>{traces.data.map((t) => <li key={t.id} onClick={() => nav(`/traces/${t.id}`)} className="cursor-pointer border-b border-line px-3 py-2 text-[13px] hover:bg-surface-2"><b>{t.id}</b><div className="text-muted">{t.events} events{t.finished ? "" : " · open"}</div></li>)}</ul>
          : <EmptyState title="No traces" hint="Record one: `with wc.trace('traces/<name>.jsonl'): …` next to the API, or run demo.py." />}
      </div>
      <EmptyState title="Pick a trace" hint="You'll watch the run: the page as it changed, the mouse, the scrolls, and every request, action, loop and error as it happened -- one clock." />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => nav("/traces")}>← traces</Button>
        <span className="text-[13px] font-semibold">{id}</span>
        <span className="text-[12px] text-muted">{all.length} events</span>
        <div className="ml-2 flex flex-wrap gap-1">{topics.map((t) => <button key={t} type="button" className={hidden.has(t) ? "opacity-40" : ""} onClick={() => setHidden((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}><TopicChip topic={t} /></button>)}</div>
        <div className="flex-1" />
        <Chip tone="neutral">replay · offline</Chip>
      </div>
      {!all.length ? <EmptyState title="Loading…" /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="min-w-0"><Player events={(rrweb.data ?? []) as any} seekTo={seek} onTime={follow} maxHeight={900} controls={false} controller={controller} /></div>
        <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-line">
          <Tabs items={[{ value: "events", label: "Events", count: shown.length }, { value: "event", label: "This event" }, { value: "errors", label: "Ledger", count: errors.length }, { value: "plan", label: "Plan" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
            <TabPanel value="events" className="min-h-0"><EventList events={shown} cursor={cursor} onCursor={jump} groupByDocument className="max-h-[640px] overflow-auto" /></TabPanel>
            <TabPanel value="event" className="p-2">{cur ? <pre className="max-h-[600px] overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(cur, null, 2)}</pre> : <EmptyState title="No event at the cursor" />}</TabPanel>
            <TabPanel value="errors" className="flex flex-col gap-2 p-2">
              {errors.length ? errors.map((e, i) => <ErrorCard key={i} error={e.error} raised={e.raised} when={e.ts && all[0]?.ts ? `+${Math.round((e.ts - all[0].ts) * 1000)} ms` : undefined} onJump={() => { const idx = shown.indexOf(e as Event); if (idx >= 0) jump(idx); }} />) : <span className="text-[12px] text-muted">No errors in this run.</span>}
            </TabPanel>
            <TabPanel value="plan" className="p-2">{plan.data ? <div className="flex flex-col gap-2"><CodeBlock lang="explain" code={plan.data.describe} /><CodeBlock lang="blob" code={plan.data.blob} wrap /></div> : <EmptyState title="No plan recorded" hint="Open a recording session under the trace (`wc.record()`), or pass `plan=` to `wc.trace()`." />}</TabPanel>
          </Tabs>
        </div>
      </div>}
      {/* the transport, pinned: always in reach however far the page above scrolls */}
      {all.length > 0 && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Button, Chip, EmptyState, ErrorCard, EventList, Panel, ReplayPlayer, SnapshotPane, TabPanel, Tabs, Timeline, TopicChip,
  topicRoot, type ErrorEvent, type Event, type SnapshotEvent,
} from "@webclient/ui";
import { api } from "../lib/api";

/** Traces (stories 7.1-7.3): one scrubber; snapshot, DOM replay, request and event JSON follow it. */
export function Traces() {
  const { id } = useParams();
  const nav = useNavigate();
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.traces });
  const events = useQuery({ queryKey: ["trace-events", id], queryFn: () => api.traceEvents(id!), enabled: !!id });
  const rrweb = useQuery({ queryKey: ["trace-rrweb", id], queryFn: () => api.traceRrweb(id!), enabled: !!id });
  const [cursor, setCursor] = React.useState(0);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [tab, setTab] = React.useState("snapshot");
  const all = events.data ?? [];
  // open on the first snapshot (there is something to look at), not on event #1
  React.useEffect(() => { const i = all.findIndex((e) => e.topic === "snapshot"); if (i > 0) setCursor(i); }, [events.data]);
  const shown = React.useMemo(() => all.filter((e) => !hidden.has(topicRoot(e.topic))), [all, hidden]);
  const cur = shown[cursor];
  const topics = [...new Set(all.map((e) => topicRoot(e.topic)))].sort();
  // the snapshot at (or before) the scrubber for the same document
  const snapAt = React.useMemo(() => {
    if (!cur) return null;
    for (let i = cursor; i >= 0; i--) { const e = shown[i]; if (e && e.topic === "snapshot" && (!cur.document_id || e.document_id === cur.document_id)) return e as SnapshotEvent; }
    return (shown.slice(0, cursor + 1).reverse().find((e) => e.topic === "snapshot") ?? null) as SnapshotEvent | null;
  }, [cur, cursor, shown]);
  const html = useQuery({ queryKey: ["asset", id, snapAt?.asset], queryFn: () => api.traceAsset(id!, snapAt!.asset!), enabled: !!id && !!snapAt?.asset });
  const errors = all.filter((e) => e.topic === "error") as ErrorEvent[];

  if (!id) return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-3 p-3">
      <Panel title="Traces" flush>
        {traces.data?.length ? <ul>{traces.data.map((t) => <li key={t.id} onClick={() => nav(`/traces/${t.id}`)} className="cursor-pointer border-b border-line px-3 py-2 text-[13px] hover:bg-surface-2"><b>{t.id}</b><div className="text-muted">{t.events} events{t.finished ? "" : " · open"}</div></li>)}</ul>
          : <EmptyState title="No traces" hint="Record one: `with wc.trace('traces/<name>'): …` next to the API, or run demo.py." />}
      </Panel>
      <EmptyState title="Pick a trace" hint="You'll read the run as a story: one scrubber moves the snapshot, the DOM replay and the network together." />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button size="sm" variant="ghost" onClick={() => nav("/traces")}>← traces</Button>
        <span className="text-[13px] font-semibold">{id}</span>
        <span className="text-[12px] text-muted">{all.length} events</span>
        <div className="ml-2 flex flex-wrap gap-1">{topics.map((t) => <button key={t} type="button" className={hidden.has(t) ? "opacity-40" : ""} onClick={() => setHidden((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}><TopicChip topic={t} /></button>)}</div>
        <div className="flex-1" />
        <Chip tone="neutral">replay: inspect offline</Chip>
      </div>
      {!all.length ? <EmptyState title="Loading…" /> :
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-3 p-3">
        <Timeline events={shown} cursor={cursor} onCursor={setCursor} height={120} />
        <div className="grid min-h-0 grid-cols-2 gap-3">
          <Panel title="Events" flush><EventList events={shown} cursor={cursor} onCursor={setCursor} groupByDocument className="h-full" /></Panel>
          <Panel flush className="min-h-0">
            <Tabs items={[{ value: "snapshot", label: "Snapshot" }, { value: "replay", label: "DOM replay", count: rrweb.data?.length }, { value: "event", label: "Event" }, { value: "errors", label: "Ledger", count: errors.length }]} value={tab} onValueChange={setTab} className="h-full">
              <TabPanel value="snapshot" className="p-3">{snapAt ? <SnapshotPane snapshot={snapAt} html={html.data ?? null} /> : <EmptyState title="No snapshot before this point" />}</TabPanel>
              <TabPanel value="replay" className="p-3"><ReplayPlayer events={rrweb.data ?? []} seekTo={cur?.ts ? cur.ts * 1000 : null} width={640} height={400} /></TabPanel>
              <TabPanel value="event" className="p-3"><pre className="overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(cur, null, 2)}</pre></TabPanel>
              <TabPanel value="errors" className="flex flex-col gap-2 p-3">
                {errors.length ? errors.map((e, i) => <ErrorCard key={i} error={e.error} raised={e.raised} when={e.ts && all[0]?.ts ? `+${Math.round((e.ts - all[0].ts) * 1000)} ms` : undefined} onJump={() => { const idx = shown.indexOf(e as Event); if (idx >= 0) setCursor(idx); }} />) : <span className="text-[12px] text-muted">No errors in this run.</span>}
              </TabPanel>
            </Tabs>
          </Panel>
        </div>
      </div>}
    </div>
  );
}

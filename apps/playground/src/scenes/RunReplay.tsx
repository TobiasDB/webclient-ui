/** The Run workspace's REPLAY pieces (docs/product/run-replay.md): the replay screen (the page the
 * selected item is on, the step's OWN element outlined) and the events grouped Stage ▸ Item ▸ event. */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageFrame, Player, cn, graphLib, replayLib, stagesLib, withAgent, type RunEvent } from "@webclient/ui";
import { api } from "../lib/api";

type Stage = ReturnType<typeof stagesLib.stagesOf>[number];
type Stats = ReturnType<typeof stagesLib.stageStats>;
/** what is being watched: a stage and / or an item (its index path joined, "" = the root); null = follow */
export type Pick = { stage?: string | null; item?: string | null; /** a page to watch (by its document id) */ doc?: string | null } | null;

const keyOf = (e: RunEvent) => (e.item ?? []).join(".");
const docOf = (e: RunEvent) => (e as { document_id?: string }).document_id;
const selectorOf = (e: RunEvent) => e.detail?.selector as string | undefined;

/** an event's op + selector: a plan step's (detail), an action's (the action + its args) */
const opOf = (e: RunEvent): string => String(e.detail?.op ?? (e as { action?: string }).action ?? e.topic ?? "");
const selOf = (e: RunEvent): string | undefined => (e.detail?.selector as string | undefined) ?? ((e as { args?: { selector?: string } }).args?.selector ?? undefined);
const SELECTING = new Set(["select", "select_all", "click", "write", "wait_for", "scroll", "hover", "press"]);

export const currentStep = (events: RunEvent[], stageOf: (string | null)[], at: number, pick: Pick): number => replayLib.currentStep(events, stageOf, at, pick);

type Spec = { op: string; selector?: string; fanSel?: string; local?: number; label: string };

export function ReplayScreen({ traceId, events, stageOf, stages, stats, at, pick, maxHeight }: { traceId: string | null; events: RunEvent[]; stageOf: (string | null)[]; stages: Stage[]; stats: Stats; at: number; pick: Pick; maxHeight: number }) {
  const all = React.useMemo(() => stagesLib.flatStages(stages), [stages]);
  const feeds = React.useMemo(() => stagesLib.structuralFeeds(stages), [stages]);
  const j = currentStep(events, stageOf, at, pick);
  const ev = j >= 0 ? events[j]! : null;
  // where the step is: its own page; a record's step (on an element: no page id) is on the page whose span of the
  // fan-out holds the record; anything else on its item's last page (its detail page's fetch)
  const place = React.useMemo(() => replayLib.placeOf(events, stageOf, all, (id) => stats[id]?.feed ?? feeds[id], j), [j, events, stageOf, stats, all, feeds]);
  const doc = place?.doc;

  // WHAT to outline (independent of which rendering shows the page): this step if it names a selector,
  // else the last selecting step / action of the same item
  const spec = React.useMemo<Spec | null>(() => {
    if (!ev || j < 0 || !place) return null;
    let k = j; const key = keyOf(ev);
    while (k >= 0) { const e = events[k]!; if ((e.topic === "action" || (e.topic === "plan" && e.phase === "step")) && keyOf(e) === key && (!docOf(e) || docOf(e) === doc) && selOf(e) && SELECTING.has(opOf(e))) break; k--; if (j - k > 400) { k = -1; break; } }
    // no selecting step of its own: a read straight off the record (`select_all(li).extract(text=attr("text"))`) --
    // the record itself, the item's match of the fan-out
    if (k < 0) return place.fan?.op === "select_all" && place.local != null ? { op: "select", fanSel: place.fan.arg, local: place.local, label: `${opOf(ev)}${selOf(ev) ? ` ${selOf(ev)}` : ""}` } : null;
    const step = events[k]!;
    return { op: opOf(step), selector: selOf(step), fanSel: place.fan?.op === "select_all" ? place.fan.arg : undefined, local: place.local, label: `${opOf(ev)}${selOf(ev) ? ` ${selOf(ev)}` : ""}` };
  }, [ev, j, events, place, doc]);
  const colour = ev ? stagesLib.ACTION_COLOUR[stagesLib.actionOf(opOf(ev))] : "#2563eb";

  // a BROWSER page recorded with rrweb plays its recording at this moment; any other page is its snapshot AT this moment
  const recorded = React.useMemo(() => new Set(events.filter((e) => e.topic === "rrweb").map((e) => docOf(e)).filter(Boolean) as string[]), [events]);
  const useRecording = !!doc && recorded.has(doc);
  const snapN = React.useMemo(() => { if (!doc || j < 0) return undefined; for (let k = j; k >= 0; k--) { const e = events[k]!; if (e.topic === "snapshot" && docOf(e) === doc) return (e as { n?: number }).n; } return undefined; }, [doc, j, events]);
  const page = useQuery({ queryKey: ["trace-doc", traceId, doc, snapN], queryFn: () => api.traceDocument(traceId!, doc!, snapN), enabled: !!traceId && !!doc && !useRecording, staleTime: Infinity, retry: 1 });
  const rr = useQuery({ queryKey: ["trace-rrweb", traceId, doc], queryFn: () => api.traceRrweb(traceId!, doc!), enabled: !!traceId && !!doc && useRecording, staleTime: Infinity, retry: 1 });
  // paths are computed on EXACTLY what the frame renders (scripts / widgets stripped): on the raw HTML a stripped
  // <script> shifts every later sibling, and the outline / scroll land on the wrong element or none
  const parsed = React.useMemo(() => (page.data?.content ? new DOMParser().parseFromString(withAgent(page.data.content, page.data.final_url ?? page.data.url, true), "text/html") : null), [page.data]);
  const target = React.useMemo(() => (parsed && spec ? replayLib.targetOf(parsed, spec.op, spec.selector, spec.fanSel, spec.local) : null), [parsed, spec]);
  const highlights = React.useMemo(() => {
    if (!target || !spec) return [];
    const others = target.els.filter((e) => e !== target.own);
    return [
      ...(others.length ? [{ paths: others.slice(0, 60).map(graphLib.pathOf), colour, dashed: true }] : []),
      ...(target.own ? [{ paths: [graphLib.pathOf(target.own)], colour, label: spec.label, spot: true }] : []),
    ];
  }, [target, spec, colour]);
  const scrollTo = target?.own ? graphLib.pathOf(target.own) : null;

  // the recording: its rebuilt DOM (at this moment) is where the target is looked up
  const [pDoc, setPDoc] = React.useState<Document | null>(null);
  const [tick, setTick] = React.useState(0);
  // after the seek settles -- and again later: a seek can rebuild the page, detaching what was found first
  React.useEffect(() => { const a = setTimeout(() => setTick((x) => x + 1), 120); const b = setTimeout(() => setTick((x) => x + 1), 700); return () => { clearTimeout(a); clearTimeout(b); }; }, [at, pDoc]);
  const pTarget = React.useMemo(() => { if (!useRecording || !pDoc || !spec) return null; const t = replayLib.targetOf(pDoc, spec.op, spec.selector, spec.fanSel, spec.local); return t.own && !t.own.isConnected ? null : t; }, [useRecording, pDoc, spec, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pHighlights = React.useMemo(() => {
    if (!pTarget || !spec) return [];
    const others = pTarget.els.filter((e) => e !== pTarget.own);
    return [
      ...(others.length ? [{ selector: "", els: others.slice(0, 60), colour, dashed: true, key: "others" }] : []),
      ...(pTarget.own ? [{ selector: "", els: [pTarget.own], colour, label: spec.label, key: "own", spot: true }] : []),
    ];
  }, [pTarget, spec, colour]);
  const shown = useRecording ? pTarget : target;

  const item = ev ? keyOf(ev) : "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-line px-1.5 py-0.5 text-[10px]">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">replay</span>
        {ev ? <>
          <span className="shrink-0 rounded bg-surface-2 px-1 font-mono">{item ? `item ${item}` : "root"}</span>
          <span className="min-w-0 truncate font-mono" style={{ color: colour }}>{spec?.label ?? opOf(ev)}</span>
          {shown && <span className="shrink-0 text-muted">{shown.how === "item" ? `this item's element${shown.own && !replayLib.shown(shown.own) ? " (hidden on the page)" : ""}${shown.els.length > 1 ? ` (1 of ${shown.els.length})` : ""}` : shown.els.length ? "on the page" : "not on this page"}</span>}
          <span className="shrink-0 rounded bg-surface-2 px-1 text-muted">{useRecording ? "recording" : "snapshot"}</span>
          <span className="flex-1" />
          <span className="min-w-0 truncate text-muted" title={page.data?.final_url ?? page.data?.url}>{(page.data?.final_url ?? page.data?.url ?? "").replace(/^https?:\/\//, "")}{page.data?.status_code ? ` · ${page.data.status_code}` : ""}</span>
        </> : <span className="text-muted">nothing on a page yet</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ev && traceId && <EventCard key={j} ev={ev} colour={colour} />}
        {!traceId ? <div className="p-2 text-muted">the run is not recorded: no pages to replay</div>
          : useRecording ? (rr.data?.length ? <Player events={rr.data as never} seekTo={ev?.ts ? ev.ts * 1000 : null} controls={false} pulses={false} highlights={pHighlights} scrollTo={pTarget?.own ?? null} onDocument={setPDoc} maxHeight={maxHeight} /> : <div className="p-2 text-muted">{rr.isLoading ? "loading the recording…" : "no recording of this page"}</div>)
          : page.isLoading ? <div className="p-2 text-muted">loading the page…</div>
          : page.data?.content ? <PageFrame html={page.data.content} base={page.data.final_url ?? page.data.url} stripScripts highlights={highlights} scrollTo={scrollTo} maxHeight={maxHeight} width={1180} />
          : <div className="p-2 text-muted">{doc ? "no snapshot of this page in the trace" : "…"}</div>}
      </div>
    </div>
  );
}

/** THE CURRENT EVENT as a card over the page: what the run is doing at this moment (the op and what it
 * named, the page fetched, the fan-out, the row) -- it slides in anew with every step */
function EventCard({ ev, colour }: { ev: RunEvent; colour: string }) {
  const e = ev as RunEvent & { url?: string; final_url?: string; method?: string; status_code?: number; loop?: string; round?: number; action?: string; args?: Record<string, unknown>; error?: { code?: string; message?: string } };
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const op = opOf(ev);
  const kind = e.topic === "plan" ? String(e.phase ?? "") : String(e.topic ?? "");
  const args = Array.isArray(d.args) ? (d.args as unknown[]).map((a) => (typeof a === "string" ? JSON.stringify(a) : String(a))).join(", ") : "";
  let main = e.topic === "plan" && d.op ? `${op}(${args})` : e.topic === "action" ? `${e.action ?? "action"} ${String(e.args?.selector ?? "")}` : op;
  let sub = "";
  if (e.topic === "snapshot" || String(e.topic ?? "").startsWith("network")) { main = `${String(e.method ?? "GET").toUpperCase()} ${short(String(e.final_url ?? e.url ?? ""))}`; sub = e.status_code ? `→ ${e.status_code}` : String(e.phase ?? ""); }
  else if (e.phase === "fanout") sub = `→ ${Number(d.n ?? 0).toLocaleString()} item(s)`;
  else if (e.phase === "parallel") { main = `${d.n} at once`; sub = `limit ${d.limit} · bound by ${d.bound}`; }
  else if (e.phase === "row") { main = `row ${Number(d.index ?? 0) + 1}`; sub = d.row != null ? JSON.stringify(d.row).slice(0, 140) : ""; }
  else if (e.phase === "item") sub = String(d.status ?? "");
  else if (e.topic === "loop") { main = `${e.loop} · ${e.phase}${e.round ? ` (round ${e.round})` : ""}`; sub = String(d.decision ?? d.result ?? d.error ?? ""); }
  else if (e.topic === "error") { main = String(e.error?.code ?? "error"); sub = String(e.error?.message ?? ""); }
  return (
    <div key={(ev as { n?: number }).n ?? main} className="wc-evcard pointer-events-none absolute right-2 top-2 z-20 max-w-[min(340px,70%)] rounded-md px-2 py-1 font-mono text-[10.5px] leading-snug shadow-lg" style={{ ["--c" as never]: colour }}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide opacity-75">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: colour }} /><span>{kind}</span>
        {(ev.item ?? []).length > 0 && <span>· item {keyOf(ev)}</span>}
        {(ev as { n?: number }).n != null && <span className="ml-auto">#{(ev as { n?: number }).n}</span>}
      </div>
      <div className="break-all font-semibold [overflow-wrap:anywhere]">{main}</div>
      {sub && <div className="line-clamp-2 break-all opacity-80 [overflow-wrap:anywhere]">{sub}</div>}
    </div>
  );
}

/** the events GROUPED: Stage ▸ Item ▸ events (counts, errors; only what is opened renders) */
export function EventTree({ events, stageOf, stages, at, onSeek, onPick, pick }: { events: RunEvent[]; stageOf: (string | null)[]; stages: Stage[]; at: number; onSeek: (i: number) => void; onPick: (p: Pick) => void; pick: Pick }) {
  const all = React.useMemo(() => stagesLib.flatStages(stages), [stages]);
  const groups = React.useMemo(() => {
    const byStage = new Map<string, Map<string, number[]>>();
    const n = Math.min(at, events.length);
    for (let i = 0; i < n; i++) {
      const e = events[i]!; if (e.topic === "resources") continue;
      const s = stageOf[i] ?? (docOf(e) ? "__page" : "__other");
      let m = byStage.get(s); if (!m) { m = new Map(); byStage.set(s, m); }
      const k = keyOf(e); const l = m.get(k); if (l) l.push(i); else m.set(k, [i]);
    }
    const order = [...all.map((s) => s.id), "__page", "__other"];
    return order.filter((id) => byStage.has(id)).map((id) => ({ id, stage: all.find((s) => s.id === id), items: byStage.get(id)! }));
  }, [events, stageOf, all, at]);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const line = (i: number) => {
    const e = events[i]!; const d = e.detail ?? {};
    const text = e.topic === "plan" ? `${e.phase}${d.op ? ` ${String(d.op)}` : ""}${d.selector ? ` ${String(d.selector)}` : ""}${d.n != null ? ` ×${String(d.n)}` : ""}${d.status ? ` ${String(d.status)}` : ""}`
      : e.topic === "error" ? `${(e as { error?: { code?: string; message?: string } }).error?.code ?? "error"} ${(e as { error?: { message?: string } }).error?.message ?? ""}`
      : `${e.phase ?? ""} ${String((e as { url?: string; final_url?: string }).url ?? (e as { final_url?: string }).final_url ?? "")}`;
    return <li key={i}><button type="button" onClick={() => onSeek(i + 1)} className={cn("flex w-full min-w-0 gap-1 px-1 text-left hover:bg-surface-2", i === at - 1 && "bg-accent-soft")}><span className="w-10 shrink-0 text-right text-muted">{i}</span><span className={cn("w-14 shrink-0 truncate", e.topic === "error" ? "text-bad" : e.topic === "plan" ? "text-accent" : "text-topic-network")}>{e.topic}</span><span className="min-w-0 flex-1 truncate" title={text}>{text}</span></button></li>;
  };
  return (
    <div className="min-h-0 overflow-auto font-mono text-[9.5px] leading-[14px]">
      {groups.map((g) => {
        const nEv = [...g.items.values()].reduce((a, l) => a + l.length, 0);
        const errs = [...g.items.values()].reduce((a, l) => a + l.filter((i) => events[i]!.topic === "error").length, 0);
        const label = g.stage ? `${g.stage.kind} ${g.stage.op}${g.stage.arg ? ` ${g.stage.arg}` : ""}${g.stage.column ? ` → ${g.stage.column}` : ""}` : g.id === "__page" ? "page & network" : "other";
        const isOpen = open.has(g.id);
        const keys = [...g.items.keys()];
        return (
          <div key={g.id} className="border-b border-line/60">
            <button type="button" onClick={() => { toggle(g.id); if (g.stage) onPick({ stage: g.id, item: pick?.item ?? null }); }} className={cn("flex w-full min-w-0 items-center gap-1 px-1 text-left hover:bg-surface-2", pick?.stage === g.id && "text-accent")}>
              <span className="w-3 shrink-0">{isOpen ? "▾" : "▸"}</span><span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-muted">{keys.length > 1 || keys[0] ? `${keys.length.toLocaleString()} items · ` : ""}{nEv.toLocaleString()}</span>
              {errs > 0 && <span className="shrink-0 text-bad">✕{errs}</span>}
            </button>
            {isOpen && <div className="pl-3">
              {keys.slice(0, 300).map((k) => {
                const ik = `${g.id}|${k}`; const list = g.items.get(k)!; const itemOpen = open.has(ik); const bad = list.some((i) => events[i]!.topic === "error");
                return (
                  <div key={k}>
                    <button type="button" onClick={() => { toggle(ik); onPick({ stage: g.stage ? g.id : null, item: k }); onSeek(list[list.length - 1]! + 1); }} className={cn("flex w-full min-w-0 items-center gap-1 px-1 text-left hover:bg-surface-2", pick?.item === k && "text-accent")}>
                      <span className="w-3 shrink-0">{itemOpen ? "▾" : "▸"}</span><span className="min-w-0 flex-1 truncate">{k ? `item ${k}` : "root"}</span><span className="shrink-0 text-muted">{list.length}</span>{bad && <span className="text-bad">✕</span>}
                    </button>
                    {itemOpen && <ol className="pl-3">{list.slice(0, 400).map(line)}</ol>}
                  </div>
                );
              })}
              {keys.length > 300 && <div className="px-1 text-muted">+{(keys.length - 300).toLocaleString()} more items (pick one on the graph or the lanes)</div>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

// -- what else a trace holds, as lanes of marks (docs/product/run-replay.md, phase 2) ---------------------
type AnyEv = RunEvent & { loop?: string; pipeline?: string; stage?: string; round?: number; script?: string; url?: string; method?: string; status_code?: number; count?: number; error?: { code?: string; message?: string }; raised?: boolean };
const short = (u: string) => u.replace(/^https?:\/\/[^/]+/, "").slice(0, 60) || u.slice(0, 60);

/** the non-plan activity of a trace as mark lanes: each loop's rounds (waiting spans amber), each pipeline's
 * stages (enter → exit bars, red when a gate stops it), background requests, scripts, DOM changes, errors */
export function markLanes(events: RunEvent[]): { id: string; label: string; colour: string; marks: { t: number; t2?: number; colour?: string; tip?: string; tall?: boolean }[] }[] {
  const out = new Map<string, { id: string; label: string; colour: string; marks: { t: number; t2?: number; colour?: string; tip?: string; tall?: boolean }[] }>();
  const lane = (id: string, label: string, colour: string) => { let l = out.get(id); if (!l) { l = { id, label, colour, marks: [] }; out.set(id, l); } return l; };
  const openStage = new Map<string, { t: number; name: string }>(); const waiting = new Map<string, number>();
  for (const e0 of events) {
    const e = e0 as AnyEv; const t = Number(e.ts ?? 0); if (!t) continue;
    if (e.topic === "loop" && e.loop) {
      const l = lane(`loop:${e.loop}`, `loop ${e.loop}`, "#0891b2");
      if (e.phase === "round") { const w = waiting.get(e.loop); if (w != null) { l.marks.push({ t: w, t2: t, colour: "#f59e0b", tip: "waiting for a person" }); waiting.delete(e.loop); } l.marks.push({ t, tall: true, tip: `round ${e.round ?? ""}` }); }
      else if (e.phase === "waiting") waiting.set(e.loop, t);
      else if (e.phase === "done") l.marks.push({ t, tall: true, colour: "#16a34a", tip: "done" });
      else if (e.phase === "decision") l.marks.push({ t, colour: "#94a3b8", tip: `decision ${JSON.stringify(e.detail ?? {}).slice(0, 80)}` });
    } else if (e.topic === "pipeline" && e.pipeline) {
      const l = lane(`pipe:${e.pipeline}`, `pipeline ${e.pipeline}`, "#7c3aed"); const k = `${e.pipeline}|${e.stage}`;
      if (e.phase === "enter") openStage.set(k, { t, name: String(e.stage) });
      else if (e.phase === "exit" || e.phase === "error") { const o = openStage.get(k); if (o) { l.marks.push({ t: o.t, t2: t, colour: e.phase === "error" || (e.detail as { stopped?: boolean } | undefined)?.stopped ? "#dc2626" : "#7c3aed", tip: `${o.name}${e.phase === "error" ? " failed" : ""}` }); openStage.delete(k); } }
      else if (e.phase === "gate" && (e.detail as { passed?: boolean } | undefined)?.passed === false) l.marks.push({ t, tall: true, colour: "#dc2626", tip: `${e.stage}: gate ${String((e.detail as { reason?: string }).reason ?? "")}` });
    } else if (e.topic === "network.resource" || e.topic === "resource") {
      lane("bg", "background requests", "#64748b").marks.push({ t, colour: (e.status_code ?? 200) >= 400 ? "#dc2626" : undefined, tip: `${String(e.method ?? "GET")} ${short(String(e.url ?? ""))}${e.status_code ? ` → ${e.status_code}` : ""}` });
    } else if (e.topic === "script") {
      lane("script", "scripts", "#ca8a04").marks.push({ t, tip: `${e.script ?? "script"} · ${e.phase ?? ""}` });
    } else if (e.topic === "rrweb" || e.topic === "dom" || e.topic?.startsWith("dom")) {
      lane("dom", "DOM changes", "#db2777").marks.push({ t, tall: (e.count ?? 0) > 20, tip: `${e.count ?? ""} DOM event(s)` });
    } else if (e.topic === "error") {
      lane("err", "errors", "#dc2626").marks.push({ t, tall: true, colour: e.raised === false ? "#f59e0b" : "#dc2626", tip: `${e.error?.code ?? "error"}: ${e.error?.message ?? ""}` });
    }
  }
  return [...out.values()];
}

/** a trace WITHOUT a plan (a loop, a crawl, a pipeline): what it did, as a process -- the pipelines' stages in
 * order (how long, passed / stopped), the loops (rounds, last decision), the pages it opened (click one to replay it) */
export function ProcessPanel({ events, at, pick, onPick, onSeek }: { events: RunEvent[]; at: number; pick: Pick; onPick: (p: Pick) => void; onSeek: (i: number) => void }) {
  const model = React.useMemo(() => {
    const pipes = new Map<string, { name: string; stages: Map<string, { name: string; enter: number; exit?: number; ok?: boolean; reason?: string; i: number }> }>();
    const loops = new Map<string, { name: string; rounds: number; last?: string; done?: boolean; waiting?: boolean; i: number }>();
    const pages = new Map<string, { doc: string; url: string; status?: number; tiers?: string; i: number; n: number }>();
    const n = Math.min(at, events.length);
    for (let i = 0; i < n; i++) {
      const e = events[i] as AnyEv & { final_url?: string; tiers?: string[]; document_id?: string }; const t = Number(e.ts ?? 0);
      if (e.topic === "pipeline" && e.pipeline) {
        let p = pipes.get(e.pipeline); if (!p) { p = { name: e.pipeline, stages: new Map() }; pipes.set(e.pipeline, p); }
        const k = String(e.stage); let st = p.stages.get(k);
        if (e.phase === "enter" && !st) { st = { name: k, enter: t, i }; p.stages.set(k, st); }
        if (st && e.phase === "exit") { st.exit = t; if (st.ok === undefined) st.ok = !(e.detail as { stopped?: boolean } | undefined)?.stopped; }
        if (st && e.phase === "error") { st.exit = t; st.ok = false; st.reason = String((e.detail as { error?: string } | undefined)?.error ?? "error"); }
        if (st && e.phase === "gate" && (e.detail as { passed?: boolean } | undefined)?.passed === false) { st.ok = false; st.reason = String((e.detail as { reason?: string }).reason ?? "gate"); }
      } else if (e.topic === "loop" && e.loop) {
        let l = loops.get(e.loop); if (!l) { l = { name: e.loop, rounds: 0, i }; loops.set(e.loop, l); }
        if (e.phase === "round") { l.rounds++; l.waiting = false; }
        if (e.phase === "decision") l.last = JSON.stringify((e.detail as { decision?: unknown } | undefined)?.decision ?? e.detail ?? "").slice(0, 60);
        if (e.phase === "waiting") l.waiting = true;
        if (e.phase === "done") l.done = true;
      }
      const d = e.document_id;
      if (d && (e.topic === "snapshot" || e.topic === "network.navigation")) {
        let pg = pages.get(d); if (!pg) { pg = { doc: d, url: String(e.final_url ?? e.url ?? ""), i, n: 0 }; pages.set(d, pg); }
        pg.n++; if (e.status_code) pg.status = e.status_code; if (e.tiers) pg.tiers = e.tiers.join(" → "); if (e.final_url || e.url) pg.url = String(e.final_url ?? e.url);
      }
    }
    return { pipes: [...pipes.values()], loops: [...loops.values()], pages: [...pages.values()] };
  }, [events, at]);
  const dur = (a: number, b?: number) => (b ? `${(b - a) < 1 ? `${Math.round((b - a) * 1000)}ms` : `${(b - a).toFixed(1)}s`}` : "…");
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-1.5 text-[10.5px]">
      {model.pipes.map((p) => (
        <div key={p.name}>
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted">pipeline {p.name}</div>
          <div className="flex flex-wrap items-center gap-1">{[...p.stages.values()].map((st, k) => (
            <React.Fragment key={st.name}>{k > 0 && <span className="text-muted">→</span>}
              <button type="button" onClick={() => onSeek(st.i + 1)} className={cn("rounded border-2 px-1.5 py-0.5 text-left", st.ok === false ? "border-bad" : st.exit ? "border-ok" : "border-accent")} title={st.reason ?? ""}>
                <div className="font-medium">{st.name}</div><div className="text-[9px] text-muted">{st.ok === false ? `✕ ${st.reason ?? ""}`.slice(0, 40) : st.exit ? `✓ ${dur(st.enter, st.exit)}` : "running…"}</div>
              </button></React.Fragment>))}</div>
        </div>
      ))}
      {model.loops.length > 0 && <div>
        <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted">loops</div>
        <div className="flex flex-wrap gap-1">{model.loops.map((l) => (
          <button key={l.name} type="button" onClick={() => onSeek(l.i + 1)} className={cn("rounded border-2 px-1.5 py-0.5 text-left", l.waiting ? "border-warn" : l.done ? "border-ok" : "border-accent")}>
            <div className="font-medium">{l.name}</div><div className="text-[9px] text-muted">{l.rounds} round{l.rounds === 1 ? "" : "s"}{l.waiting ? " · waiting for a person" : l.done ? " · done" : ""}{l.last ? ` · ${l.last}` : ""}</div>
          </button>))}</div>
      </div>}
      <div>
        <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted">pages · {model.pages.length}</div>
        <ul className="flex flex-col">{model.pages.map((pg) => (
          <li key={pg.doc}><button type="button" onClick={() => { onPick(pick?.doc === pg.doc ? null : { doc: pg.doc }); onSeek(pg.i + 1); }} className={cn("flex w-full min-w-0 items-center gap-1 rounded px-1 text-left hover:bg-surface-2", pick?.doc === pg.doc && "bg-accent-soft text-accent")}>
            <span className="min-w-0 flex-1 truncate font-mono" title={pg.url}>{pg.url.replace(/^https?:\/\//, "")}</span>
            {pg.tiers && <span className="shrink-0 text-muted">{pg.tiers}</span>}
            {pg.status && <span className={cn("shrink-0", pg.status >= 400 ? "text-bad" : "text-muted")}>{pg.status}</span>}
          </button></li>))}</ul>
      </div>
    </div>
  );
}

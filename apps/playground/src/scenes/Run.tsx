/** RUN: a plan, played (docs/product/run.md). The same view for a plan alone (nothing has happened yet), a
 * live run (the cursor at the end) and a recorded one (scrub it): the plan, folded over its events up to the
 * cursor. The graph is the plan materialising; the page is the item on screen's; the timeline is everything on
 * one axis; the rows and events say it in words. */
import * as React from "react";
import { Chip, DataFrame, EmptyState, RunGraph, RunTimeline, cn, planLib, runLib, type RunEvent } from "@webclient/ui";
import { useActive } from "../lib/session";
import { PageStage } from "./run/PageStage";
import { LoadMenu, PlanLoader, TraceList, TracesMenu } from "./run/sources";
import { useRunSource } from "./run/useRunSource";

export { encSpec } from "./run/sources";

type Sel = { addr: string | null; item: runLib.ItemKey | null };

export function Run() {
  const active = useActive("/run");
  const src = useRunSource(active);
  const { events, plan, planId, stepMap } = src;
  const model = React.useMemo(() => (plan ? runLib.planModel(plan, planId, stepMap) : null), [plan, planId, stepMap]);

  // the cursor: live follows the end; playing advances it; scrubbing sets it
  const [t, setT] = React.useState(0);
  const [live, setLive] = React.useState(true);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(0);
  React.useEffect(() => { if (live) setT(events.length); }, [live, events.length]);
  React.useEffect(() => { setLive(true); setPlaying(false); setSel({ addr: null, item: null }); }, [src.runId, src.traceId]);

  const nowF = React.useRef(new runLib.RunFolder()); const fullF = React.useRef(new runLib.RunFolder());
  const state = React.useMemo(() => nowF.current.at(events, model, t), [events, model, t]);
  const full = React.useMemo(() => fullF.current.at(events, model, events.length), [events, model]);

  // what is on screen: a picked item / step, else FOLLOW (the oldest item in flight)
  const [sel, setSel] = React.useState<Sel>({ addr: null, item: null });
  const [chainN, setChainN] = React.useState(1);
  const item = sel.item ?? (model ? runLib.followItem(state, model) : "");
  const focusAddr = React.useMemo(() => runLib.latestFor(state, item)?.addr ?? null, [state, item]);
  const seek = (i: number) => { setLive(false); setPlaying(false); setT(Math.max(0, Math.min(events.length, i))); };
  // step to the previous / next moment (of the item on screen when one is picked)
  const moment = React.useCallback((from: number, dir: 1 | -1) => {
    for (let i = from + (dir > 0 ? 0 : -2); i >= 0 && i < events.length; i += dir) {
      const e = events[i]!; if (!runLib.MOMENT(e)) continue;
      if (sel.item != null && sel.item !== "" && !(runLib.keyOf(e.item) === sel.item || runLib.keyOf(e.item).startsWith(`${sel.item}.`))) continue;
      return i + 1;
    }
    return dir > 0 ? events.length : 0;
  }, [events, sel.item]);
  // PLAY: step by step (one moment every 0.35s -- a run's steps are ms apart), or the recorded clock × speed
  React.useEffect(() => {
    if (!playing || !events.length) return;
    let i = t;
    if (speed === 0) { const h = setInterval(() => { i = moment(i, 1); setT(i); if (i >= events.length) setPlaying(false); }, 350); return () => clearInterval(h); }
    const ts = events.map((e) => Number(e.ts ?? 0)); let clock = ts[Math.max(0, i - 1)] || ts.find((x) => x > 0) || 0;
    const h = setInterval(() => { clock += 0.05 * speed; while (i < ts.length && (ts[i] || clock) <= clock) i++; setT(i); if (i >= ts.length) setPlaying(false); }, 50);
    return () => clearInterval(h);
  }, [playing, speed, events.length, moment]); // eslint-disable-line react-hooks/exhaustive-deps
  // keys: space plays / pauses, ← → step a moment
  React.useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === " ") { e.preventDefault(); setLive(false); if (t >= events.length) setT(0); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(moment(t, 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(moment(t, -1)); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const usePanel = (key: string, dflt = false): [boolean, (v: boolean) => void] => {
    const [v, set] = React.useState(() => { try { const x = localStorage.getItem(`wc.run2.${key}`); return x == null ? dflt : x === "1"; } catch { return dflt; } });
    return [v, (x: boolean) => { set(x); try { localStorage.setItem(`wc.run2.${key}`, x ? "1" : "0"); } catch { /* fine */ } }];
  };
  const [timeOpen, setTimeOpen] = usePanel("timeline", true);
  const [rowsOpen, setRowsOpen] = usePanel("rows");
  const [evOpen, setEvOpen] = usePanel("events");

  if (src.empty) return <div className="flex h-full flex-col items-center justify-start gap-3 overflow-auto p-6"><EmptyState title="Nothing loaded" hint="Open a plan from Author (Open in Run), paste one below, or replay a recorded run. A plan loads as its graph; Run ▶ executes it and records it." /><PlanLoader onLoad={src.load} /><TraceList onOpen={src.openTrace} /></div>;

  const running = src.status === "running" || src.status === "starting";
  // the resources at the moment on screen (the last sample up to it)
  const sample = (() => { let b: (typeof src.samples)[number] | undefined; for (const x of src.samples) { if (x.ts <= (state.t || Infinity)) b = x; else break; } return b; })();
  const maxMem = Math.max(0, ...src.samples.map((x) => x.mem_mb ?? 0)), maxCpu = Math.max(0, ...src.samples.map((x) => x.cpu_pct ?? 0));
  const errors = state.errors.filter((e) => e.raised);
  const secs = state.t && state.t0 ? (state.t - state.t0).toFixed(1) : "0.0";
  const rootUrl = src.url ?? (full.docs.values().next().value as runLib.DocRun | undefined)?.url;
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      {/* the bar: the plan's state, the transport, what is followed */}
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-2">
        {src.spec && <button type="button" data-act="run" className="rounded bg-accent px-2 py-px font-medium text-white hover:brightness-110 disabled:opacity-40" onClick={src.start} disabled={running} title="execute the plan (recorded as a trace)">{src.runId ? "Run again ▶" : "Run ▶"}</button>}
        <Chip tone={src.status === "error" ? "bad" : running ? "accent" : src.status === "done" ? "ok" : "neutral"} dot>{src.startError ? "failed to start" : src.status === "loaded" ? "the plan · not run" : src.status}</Chip>
        <span className="whitespace-nowrap text-muted">{secs}s · {state.rows.length} rows · {state.docs.size} pages · {state.requests.length} requests{errors.length ? <b className="text-bad"> · {errors.length} error{errors.length > 1 ? "s" : ""}</b> : null}</span>
        {sample && <span className="whitespace-nowrap font-mono text-[10px] text-muted" title={`at this moment (max over the run: ${Math.round(maxMem)} MB, ${Math.round(maxCpu)}% CPU)`}>{sample.mem_mb != null ? `${Math.round(sample.mem_mb)} MB` : ""}{sample.cpu_pct != null ? ` · ${Math.round(sample.cpu_pct)}% cpu` : ""}{sample.pages_total ? ` · ${sample.pages_total - (sample.pages_free ?? 0)}/${sample.pages_total} pages` : ""}</span>}
        <div className="flex items-center gap-0.5">
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => seek(0)} title="the start (the plan, nothing run)">⏮</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => seek(moment(t, -1))} title="the previous moment (←)">◀</button>
          <button type="button" data-act="play" className={cn("px-1.5 hover:text-ink", playing ? "text-accent" : "text-muted")} onClick={() => { setLive(false); if (t >= events.length) setT(0); setPlaying(!playing); }} title="play (space)">{playing ? "❚❚" : "▶"}</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => seek(moment(t, 1))} title="the next moment (→)">▶|</button>
          <select className="h-5 rounded border border-line bg-surface text-[10px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="step by step (each find / read / page / action), or the recorded clock at a speed">{[0, 0.25, 1, 4, 16].map((x) => <option key={x} value={x}>{x === 0 ? "steps" : `${x}×`}</option>)}</select>
          <input type="range" min={0} max={Math.max(1, events.length)} value={Math.min(t, events.length)} onChange={(e) => seek(Number(e.target.value))} className="w-56" aria-label="the moment" />
          <button type="button" className={cn("rounded px-1 text-[10px]", live ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")} onClick={() => { setLive(true); setPlaying(false); }} title="follow the run live / go to the end">{live ? (running ? "● live" : "end") : `${t}/${events.length}`}</button>
        </div>
        <button type="button" data-act="follow" onClick={() => setSel({ addr: null, item: null })} className={cn("rounded px-1.5 text-[10px]", sel.item != null || sel.addr ? "text-muted hover:text-ink" : "bg-accent-soft text-accent")} title="follow: the screen shows the oldest item still running">{sel.item != null || sel.addr ? `watching ${sel.item ? `item ${sel.item}` : "a step"} · follow` : `● follow${item ? ` · item ${item}` : ""}`}</button>
        <span className="flex-1" />
        <LoadMenu onLoad={src.load} />
        <TracesMenu onOpen={src.openTrace} current={src.traceId} />
      </div>
      {src.startError && <div className="px-2 py-1 text-bad">{src.startError}</div>}
      {src.error && <div className="border-b border-bad/40 bg-bad-soft/40 px-2 py-0.5"><b className="text-bad">{src.error.code}</b> {src.error.message}{src.error.hint ? <span className="text-muted"> — {src.error.hint}</span> : null}</div>}
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1">
        {/* the graph | the page */}
        {/* a chain of pages (a nested crawl) gets the room for two panes */}
        <div className="grid min-h-0 flex-1 gap-1 transition-[grid-template-columns] duration-300" style={{ gridTemplateColumns: chainN > 1 ? "minmax(0,0.9fr) minmax(0,1.6fr)" : "minmax(0,1.35fr) minmax(0,1fr)" }}>
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-line">
            <div className="flex min-w-0 items-center gap-1.5 border-b border-line px-1.5 py-0.5 text-[10px]">
              <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">plan</span>
              {plan && <span className="min-w-0 truncate font-mono text-muted" title={planLib.describe(plan)}>{planLib.describe(plan)}</span>}
            </div>
            <div className="min-h-0 flex-1">
              {model ? <RunGraph model={model} state={state} item={item} addr={sel.addr} rootUrl={rootUrl} focus={sel.addr ?? focusAddr}
                onSelect={(a) => setSel((s) => ({ ...s, addr: a === s.addr ? null : a }))} onPick={(k) => setSel((s) => ({ ...s, item: k }))} />
                : <div className="p-3 text-muted">{src.traceId ? "this recording carries no plan: its pages and requests are on the timeline and the page" : "…"}</div>}
            </div>
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-line">
            <PageStage traceId={src.traceId} events={events} model={model} state={state} full={full} addr={sel.addr} item={item} maxHeight={640} onChain={setChainN} />
          </section>
        </div>
        {/* everything on one time axis */}
        <Fold title="timeline" hint={timeOpen ? "click or drag to go to a moment" : `${full.requests.length} requests · ${full.docs.size} pages · ${full.actions.length} actions`} open={timeOpen} onToggle={() => setTimeOpen(!timeOpen)} className={timeOpen ? "max-h-[180px]" : ""}>
          {events.length ? <RunTimeline className="min-h-0 flex-1 p-1" events={events} model={model} full={full} at={t} onSeek={seek} samples={src.samples} addr={sel.addr} onLane={(a) => setSel((s) => ({ ...s, addr: a === s.addr ? null : a }))} /> : <div className="p-2 text-muted">nothing has run yet</div>}
        </Fold>
        <div className={cn("grid min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-1", (rowsOpen || evOpen) && "h-[30%] items-stretch")}>
          <Fold title="rows" hint={`${state.rows.length} projected${!live ? " so far" : ""} · click one to see where it came from`} open={rowsOpen} onToggle={() => setRowsOpen(!rowsOpen)}>
            <div className="min-h-0 flex-1 overflow-auto">{state.rows.length
              ? <DataFrame dense rows={state.rows.map((r) => ({ item: r.item, ...(r.row && typeof r.row === "object" && !Array.isArray(r.row) ? (r.row as Record<string, unknown>) : { value: r.row }) }))} selected={state.rows.findIndex((r) => r.item === item)} onRow={(i) => setSel({ addr: null, item: state.rows[i]?.item ?? null })} />
              : <div className="p-2 text-muted">{running ? "waiting for the first row…" : "no rows at this moment"}</div>}</div>
          </Fold>
          <Fold title="events" hint={`${item ? `item ${item}'s` : "the run's"}, in words · up to #${t}`} open={evOpen} onToggle={() => setEvOpen(!evOpen)}>
            <EventFeed events={events} model={model} upto={t} item={sel.item} onSeek={seek} />
          </Fold>
        </div>
      </div>
    </div>
  );
}

function Fold({ title, hint, open, onToggle, className, children }: { title: string; hint?: string; open: boolean; onToggle: () => void; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded border border-line", className)}>
      <button type="button" onClick={onToggle} className={cn("flex shrink-0 items-center gap-1 px-1.5 py-px text-left text-[9.5px] font-semibold uppercase tracking-wide text-muted hover:text-ink", open && "border-b border-line")}>{open ? "▾" : "▸"} {title}{hint && <span className="truncate font-normal normal-case">· {hint}</span>}</button>
      {open && children}
    </section>
  );
}

const KIND_TONE: Record<string, string> = { step: "text-ink", result: "text-ok", page: "text-accent", request: "text-muted", action: "text-warn", dom: "text-muted", error: "text-bad", row: "text-ink", loop: "text-muted", run: "text-ink", other: "text-muted" };

/** the events up to the moment, in words -- the picked item's (and its rows'), else the run's; newest last */
function EventFeed({ events, model, upto, item, onSeek }: { events: RunEvent[]; model: runLib.PlanModel | null; upto: number; item: runLib.ItemKey | null; onSeek: (i: number) => void }) {
  const list = React.useMemo(() => {
    const out: { i: number; e: RunEvent }[] = [];
    for (let i = Math.min(upto, events.length) - 1; i >= 0 && out.length < 300; i--) {
      const e = events[i]!; const k = runLib.keyOf(e.item);
      if (item != null && item !== "" && !(k === item || k.startsWith(`${item}.`))) continue;
      if (e.topic === "rrweb" || e.topic === "resource" || e.topic === "script") continue;
      if (e.topic === "plan" && e.phase === "row" && model?.nodes.some((n) => n.op === "project")) continue;  // said by the project step's row
      out.push({ i, e });
    }
    return out.reverse();
  }, [events, upto, item]);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { const el = end.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [list.length]);
  return (
    <div className="min-h-0 flex-1 overflow-auto font-mono text-[10px]">
      {list.map(({ i, e }) => { const told = runLib.tell(e, model); const step = (e as { step?: string }).step; return (
        <button key={i} type="button" onClick={() => onSeek(i + 1)} className="flex w-full items-baseline gap-1.5 px-1.5 text-left leading-[15px] hover:bg-surface-2" title={`#${(e as { n?: number }).n ?? i}${step ? ` · step ${step}` : ""}`}>
          <span className="w-8 shrink-0 text-right text-muted/70">{(e as { n?: number }).n ?? i}</span>
          {e.item?.length ? <span className="shrink-0 text-muted">[{runLib.keyOf(e.item)}]</span> : null}
          <span className={cn("min-w-0 break-words [overflow-wrap:anywhere]", told.bad ? "text-bad" : KIND_TONE[told.kind])}>{told.text}{told.detail ? <span className="text-muted"> — {told.detail}</span> : null}</span>
        </button>); })}
      <div ref={end} />
    </div>
  );
}

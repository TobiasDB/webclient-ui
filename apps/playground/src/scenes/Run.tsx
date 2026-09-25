import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ActivityLanes, Chip, DataFrame, EmptyState, PipelineGraph, StagePlan, cn, planLib, stagesLib, type Plan, type RunEvent } from "@webclient/ui";
import { EventTree, ReplayScreen, type Pick } from "./RunReplay";
import { api, type RunState } from "../lib/api";
import { useActive, useSession } from "../lib/session";

type Spec = { plan: Plan; url?: string; name?: string };
export const encSpec = (s: Spec) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decSpec = (s: string | null): Spec | null => { if (!s) return null; try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o?.plan?.steps ? o : null; } catch { return null; } };
const remember = (id: string, spec: Spec) => { try { localStorage.setItem(`wc.run.${id}`, JSON.stringify(spec)); } catch { /* fine */ } };
const recall = (id: string): Spec | null => { try { const t = localStorage.getItem(`wc.run.${id}`); return t ? JSON.parse(t) : null; } catch { return null; } };


/** RUN: a plan executed and watched. Left, the plan as an EXPLAIN tree of stages that realises
 * as the run goes (how many times each ran, which is active, where it failed); right, the rows as
 * they stream in, the errors, and the event log. A timeline steps back and forward through the
 * run (the stages, the rows and the log as they were at that moment); the run is recorded as a
 * trace. Author's Run ▶ opens here. */
export function Run() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/run");
  const sessionId = useSession();
  const [runId, setRunId] = React.useState<string | null>(params.get("id"));
  const [spec, setSpec] = React.useState<Spec | null>(() => decSpec(params.get("p")) ?? (params.get("id") ? recall(params.get("id")!) : null));
  const [data, setData] = React.useState<RunState | null>(null);
  const [t, setT] = React.useState(0);
  const [live, setLive] = React.useState(true);
  const [startError, setStartError] = React.useState<string | null>(null);
  const started = React.useRef<string | null>(null);

  // a plan arrives (?p=, from Author or pasted): it is LOADED, not run -- Run ▶ starts it
  const start = React.useCallback(async (sp: Spec) => {
    setStartError(null); setData(null); setT(0); setLive(true);
    try {
      const r = await api.runStart({ plan: { ...sp.plan, session_id: sessionId ?? sp.plan.session_id }, url: sp.url, name: sp.name });
      remember(r.id, sp); setSpec(sp); setRunId(r.id);
      setParams((q) => { const n = new URLSearchParams(q); n.set("id", r.id); return n; }, { replace: true });
    } catch (e) { setStartError((e as Error).message); }
  }, [sessionId, setParams]);
  React.useEffect(() => {
    if (!active) return; const p = params.get("p"); if (!p || started.current === p) return;
    const sp = decSpec(p); if (!sp) return; started.current = p; setSpec(sp);
    if (!params.get("id")) { setRunId(null); setData(null); setT(0); }
  }, [active, params]);
  const load = (sp: Spec) => { setParams(() => { const n = new URLSearchParams(); n.set("p", encSpec(sp)); return n; }); };
  React.useEffect(() => { if (!active) return; const id = params.get("id"); if (id && id !== runId) { setRunId(id); setData(null); setSpec(recall(id)); setLive(true); } }, [active, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // a RECORDED run (?trace=<id>): its events and rows (from the row events), the same views as a live one
  const traceParam = params.get("trace");
  React.useEffect(() => {
    if (!active || !traceParam) return; let on = true;
    setRunId(null); setSpec(null); setLive(false); setData(null);
    api.traceEvents(traceParam).then((evs) => {
      if (!on) return;
      const events = (evs as Record<string, unknown>[]).filter((e) => e.topic !== "trace");
      const rows = events.map((e, i) => ({ e, i })).filter(({ e }) => e.topic === "plan" && e.phase === "row" && (e.detail as { row?: unknown } | undefined)?.row !== undefined).map(({ e, i }) => ({ row: (e.detail as { row: unknown }).row, at: i + 1 }));
      const ts = events.map((e) => Number(e.ts ?? 0)).filter(Boolean);
      const err = events.find((e) => e.topic === "error" && e.raised !== false) as { error?: RunState["error"] } | undefined;
      setData({ id: traceParam, status: err ? "error" : "done", error: err?.error ?? null, started: ts[0] ?? 0, finished: ts[ts.length - 1] ?? 0, describe: "", trace: traceParam, n_rows: rows.length, n_events: events.length, rows, events });
      setT(events.length);
    }).catch((e) => setStartError((e as Error).message));
    return () => { on = false; };
  }, [active, traceParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the run: what arrived since the counts held
  React.useEffect(() => {
    if (!runId) return; let on = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const held = { rows: 0, events: 0 };
    const pull = async () => {
      try {
        const r = await api.run(runId, held.rows, held.events); if (!on) return;
        held.rows += r.rows.length; held.events += r.events.length;
        setData((d) => (d && d.id === r.id ? { ...r, rows: [...d.rows, ...r.rows], events: [...d.events, ...r.events] } : r));
        if (r.status === "running") timer = setTimeout(pull, 350);
      } catch { if (on) timer = setTimeout(pull, 1500); }
    };
    pull(); return () => { on = false; if (timer) clearTimeout(timer); };
  }, [runId]);
  const events = (data?.events ?? []) as RunEvent[];
  React.useEffect(() => { if (live) setT(events.length); }, [live, events.length]);
  const running = data?.status === "running";

  // the plan's stages (from the spec, else the trace's plan)
  const tracePlan = useQuery({ queryKey: ["run-plan", data?.trace], queryFn: async () => { const p = await api.tracePlan(data!.trace!); const ir = await api.plan({ blob: p.blob }); return ir.plan as Plan; }, enabled: !spec && !!data?.trace && data.status !== "running" });
  const plan = spec?.plan ?? tracePlan.data ?? null;
  const stages = React.useMemo(() => (plan ? stagesLib.stagesOf(plan) : []), [plan]);
  const stats = React.useMemo(() => stagesLib.stageStats(stages, events, t), [stages, events, t]);
  const resources = React.useMemo(() => stagesLib.resourcesOf(events, t), [events, t]);
  const rowsAt = React.useMemo(() => (data?.rows ?? []).filter((r) => r.at <= t || (!running && t >= events.length)).map((r) => (r.row && typeof r.row === "object" && !Array.isArray(r.row) ? (r.row as Record<string, unknown>) : { value: r.row })), [data?.rows, t, running, events.length]);
  const errors = React.useMemo(() => events.slice(0, t).map((e, i) => ({ e, i })).filter(({ e }) => e.topic === "error"), [events, t]);
  const [focusStage, setFocusStage] = React.useState<string | null>(null);
  // REPLAY (docs/product/run-replay.md): every event's stage; what is watched (null = follow the run)
  const stageOf = React.useMemo(() => (stages.length ? stagesLib.eventStages(stages, events) : []), [stages, events]);
  const [pick, setPick] = React.useState<Pick>(null);
  const lanes = React.useMemo(() => stagesLib.flatStages(stages).map((st) => ({ id: st.id, label: `${st.kind} ${st.op}${st.arg ? ` ${st.arg}` : ""}${st.column && st.column !== "(named from the page)" ? ` → ${st.column}` : ""}`, colour: stagesLib.ACTION_COLOUR[stagesLib.actionOf(st.op)] })), [stages]);
  const traceId = traceParam ?? data?.trace ?? null;
  // play: the recorded clock, at a speed
  const [playing, setPlaying] = React.useState(false); const [speed, setSpeed] = React.useState(4);
  React.useEffect(() => {
    if (!playing || !events.length) return;
    const ts = events.map((e) => Number(e.ts ?? 0)); let clock = ts[Math.max(0, Math.min(t, ts.length) - 1)] ?? ts[0] ?? 0; let i = t;
    const h = setInterval(() => {
      clock += 0.1 * speed; while (i < ts.length && (ts[i] ?? 0) <= clock) i++;
      setT(i); if (i >= ts.length) setPlaying(false);
    }, 100);
    return () => clearInterval(h);
  }, [playing, speed, events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = React.useState<"graph" | "tree">("graph");
  const [big, setBig] = React.useState(false);
  const runs = useQuery({ queryKey: ["runs", runId, data?.status], queryFn: api.runs, enabled: active });
  const step = (d: number) => { setLive(false); setT((x) => Math.max(0, Math.min(events.length, x + d))); };
  const elapsed = data ? ((data.finished ?? Date.now() / 1000) - data.started).toFixed(1) : "";

  if (!runId && !spec && !data && !traceParam) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6"><EmptyState title="No plan loaded" hint="Open one from Author (Open in Run), or paste a plan below. It loads as a pipeline graph; Run ▶ executes it: the stages realise live, rows stream in, and the run is recorded as a trace." /><PlanLoader onLoad={load} /></div>;
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      {/* the run bar: status, time, counts, the timeline */}
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-2">
        {spec && <button type="button" data-act="run" className="rounded bg-accent px-2 py-px text-[11px] font-medium text-white hover:brightness-110 disabled:opacity-40" onClick={() => start(spec)} disabled={running} title="execute the plan (recorded as a trace)">{data ? "Run again ▶" : "Run ▶"}</button>}
        <Chip tone={data?.status === "error" ? "bad" : running ? "accent" : data ? "ok" : "neutral"} dot>{data?.status ?? (startError ? "failed to start" : runId ? "starting…" : "loaded · not run")}</Chip>
        <span className="text-muted">{elapsed && `${elapsed}s`} · {data?.rows.length ?? 0} rows · {events.length} events{(() => { const miss = errors.filter(({ e }) => e.raised === false).length; const bad = errors.length - miss; return `${bad ? ` · ${bad} error${bad > 1 ? "s" : ""}` : ""}${miss ? ` · ${miss} missing` : ""}`; })()}</span>
        <div className="flex items-center gap-0.5">
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => { setLive(false); setT(0); }} title="the start">⏮</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => step(-1)} title="one event back">◀</button>
          <button type="button" data-act="play" className={cn("px-1 hover:text-ink", playing ? "text-accent" : "text-muted")} onClick={() => { setLive(false); if (t >= events.length) setT(0); setPlaying(!playing); }} title="play the run at the chosen speed">{playing ? "❚❚" : "▷"}</button>
          <select className="h-5 rounded border border-line bg-surface text-[10px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="replay speed">{[1, 4, 16, 64].map((x) => <option key={x} value={x}>{x}×</option>)}</select>
          <input type="range" min={0} max={Math.max(1, events.length)} value={Math.min(t, events.length)} onChange={(e) => { setLive(false); setT(Number(e.target.value)); }} className="w-72" />
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => step(1)} title="one event forward">▶</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => setLive(true)} title="follow the run live">⏭</button>
          <span className={cn("ml-1 rounded px-1 text-[10px]", live ? "bg-accent-soft text-accent" : "text-muted")}>{live ? "live" : `at ${t}/${events.length}`}</span>
        </div>
        <button type="button" data-act="follow" onClick={() => setPick(null)} className={cn("rounded px-1.5 text-[10px]", pick ? "text-muted hover:text-ink" : "bg-accent-soft text-accent")} title={pick ? "watching what you picked -- click to follow the run again" : "following the run: the replay shows the item that was just active"}>{pick ? `watching ${pick.item != null ? (pick.item ? `item ${pick.item}` : "root") : "a stage"} · follow` : "● follow"}</button>
        <span className="flex-1" />
        {data?.trace && !running && <a href={`/traces/${encodeURIComponent(data.trace)}`} className="text-accent underline" title="the recorded trace: replay, events, plan">trace ↗</a>}
        <LoadMenu onLoad={load} />
        {runs.data && runs.data.length > 1 && <select className="h-6 rounded border border-line bg-surface px-1 text-[10.5px]" value={runId ?? ""} onChange={(e) => setParams((q) => { const n = new URLSearchParams(q); n.set("id", e.target.value); n.delete("p"); return n; })}>{runs.data.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.status} · {r.rows} rows</option>)}</select>}
      </div>
      {startError && <div className="px-2 py-1 text-bad">{startError}</div>}
      {data?.error && <div className="border-b border-bad/40 bg-bad-soft/40 px-2 py-0.5 text-[11px]"><b className="text-bad">{data.error.code}</b> {data.error.message}{data.error.hint ? <span className="text-muted"> — {data.error.hint}</span> : null}</div>}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1 p-1" style={{ gridTemplateRows: big ? "minmax(0,1fr)" : "minmax(0,1.35fr) auto minmax(0,1fr)" }}>
        {/* TOP: the plan as a pipeline graph (or the stage tree) | the replay screen */}
        <div className="grid min-h-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-1">
          <section className="flex min-h-0 flex-col rounded border border-line">
            <div className="flex items-center gap-1 border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Pipeline
              <span className="ml-1 flex overflow-hidden rounded border border-line font-normal normal-case">{(["graph", "tree"] as const).map((v) => <button key={v} type="button" className={cn("px-1.5", view === v ? "bg-accent-soft text-accent" : "hover:text-ink")} onClick={() => setView(v)}>{v}</button>)}</span>
              {plan && <span className="ml-1 min-w-0 truncate font-mono font-normal normal-case tracking-normal" title={planLib.describe(plan)}>{planLib.describe(plan)}</span>}
              <span className="flex-1" />
              <button type="button" className="ml-1 shrink-0 whitespace-nowrap rounded border border-line px-1 font-normal normal-case hover:text-ink" onClick={() => setBig(!big)} title={big ? "show the lanes, rows and events again" : "give the graph and the replay the whole workspace"}>{big ? "⤡ restore" : "⤢ maximise"}</button></div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-0.5">{!stages.length ? <span className="p-2 text-muted">…</span> : view === "graph"
              ? <PipelineGraph stages={stages} stats={stats} resources={resources} at={t} running={running || (!live && !!data && t < events.length)} selected={pick?.stage ?? focusStage} onStage={(st) => setPick((p) => (p?.stage === st.id ? null : { stage: st.id, item: null }))} />
              : <StagePlan stages={stages} stats={stats} at={t} running={running || !live} onStage={(st) => setPick((p) => (p?.stage === st.id ? null : { stage: st.id, item: null }))} />}</div>
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-line">
            <ReplayScreen traceId={traceId} events={events} stageOf={stageOf} stages={stages} stats={stats} at={t} pick={pick} maxHeight={big ? 900 : 520} />
          </section>
        </div>
        {/* the ACTIVITY LANES: each stage over time (how many items at once), the network; scrub here */}
        {!big && <section className="flex max-h-[180px] min-h-0 flex-col rounded border border-line">
          <div className="border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Activity · each stage over time (height: items at once) · click to scrub</div>
          <ActivityLanes className="min-h-0 flex-1 p-1" lanes={lanes} events={events} stageOf={stageOf} at={t} selected={pick?.stage ?? null} onLane={(id) => setPick((p) => (p?.stage === id ? null : { stage: id, item: null }))} onSeek={(i) => { setLive(false); setPlaying(false); setT(i); }} />
        </section>}
        {/* BOTTOM: the rows as they arrived | the events grouped (stage ▸ item ▸ event) + errors */}
        <div className={cn("grid min-h-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1", big && "hidden")}>
          <section className="flex min-h-0 flex-col rounded border border-line">
            <div className="border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Output · {rowsAt.length} rows{!live ? ` (at event ${t})` : running ? " (streaming)" : ""}</div>
            <div className="min-h-0 flex-1 overflow-auto">{rowsAt.length ? <DataFrame rows={rowsAt} dense /> : <div className="p-2 text-muted">{running ? "waiting for the first row…" : traceParam && !(data?.rows.length) && events.some((e) => e.topic === "plan" && e.phase === "row") ? "this trace was recorded before rows were traced: it shows the run, not its rows" : "no rows at this point"}</div>}</div>
          </section>
          <section className="flex min-h-0 flex-col rounded border border-line">
            <div className="flex items-center border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Events · by stage ▸ item · up to #{t}{errors.length ? <span className="ml-1 normal-case text-bad">· {errors.length} error{errors.length > 1 ? "s" : ""}</span> : null}</div>
            {errors.length > 0 && <ul className="max-h-16 shrink-0 overflow-auto border-b border-line">{errors.slice(-20).map(({ e, i }) => <li key={i}><button type="button" className="w-full truncate px-1.5 py-px text-left hover:bg-surface-2" onClick={() => { setLive(false); setT(i + 1); setPick({ stage: stageOf[i] ?? null, item: (e.item ?? []).join(".") }); }}><b className={e.raised === false ? "text-warn" : "text-bad"}>{e.error?.code}</b> <span className="text-muted">#{i}{e.item ? ` · item ${e.item.join(".")}` : ""}</span> {e.error?.message}</button></li>)}</ul>}
            <EventTree events={events} stageOf={stageOf} stages={stages} at={t} pick={pick} onPick={setPick} onSeek={(i) => { setLive(false); setPlaying(false); setT(i); }} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Paste a plan: its JSON (the plan, or {plan, url}) or a blob -- validated by the API, then loaded (not run). */
function PlanLoader({ onLoad, compact }: { onLoad: (s: Spec) => void; compact?: boolean }) {
  const [text, setText] = React.useState(""); const [url, setUrl] = React.useState(""); const [err, setErr] = React.useState<string | null>(null);
  const go = async () => {
    setErr(null); const t = text.trim(); if (!t) return;
    try {
      let body: Record<string, unknown>; let u = url.trim() || undefined;
      try { const o = JSON.parse(t); if (o && o.plan) { body = { plan: o.plan }; u = u ?? o.url; } else body = { plan: o }; } catch { body = { blob: t }; }
      const r = await api.plan(body); onLoad({ plan: r.plan as Plan, url: u });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className={cn("flex flex-col gap-1 text-[11px]", compact ? "w-[420px]" : "w-[560px] max-w-full")}>
      <textarea className="h-28 rounded border border-line bg-surface p-1 font-mono text-[10.5px]" placeholder='a plan: {"root": …, "steps": […]}, {"plan": …, "url": …}, or a blob' value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-1">
        <input className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 text-[10.5px]" placeholder="url (when the plan starts from one)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="rounded bg-accent px-2 py-0.5 text-white disabled:opacity-40" disabled={!text.trim()} onClick={go}>Load</button>
      </div>
      {err && <div className="text-bad">{err}</div>}
    </div>
  );
}
function LoadMenu({ onLoad }: { onLoad: (s: Spec) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative">
      <button type="button" className="rounded border border-line px-1.5 hover:bg-surface-2" onClick={() => setOpen(!open)} title="load another plan">load plan ▾</button>
      {open && <div className="absolute right-0 top-6 z-30 rounded border border-line bg-surface p-1.5 shadow-lg"><PlanLoader compact onLoad={(s) => { setOpen(false); onLoad(s); }} /></div>}
    </span>
  );
}

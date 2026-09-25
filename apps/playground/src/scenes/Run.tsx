import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chip, DataFrame, EmptyState, PipelineGraph, StagePlan, cn, planLib, stagesLib, type Plan, type RunEvent } from "@webclient/ui";
import { api, type RunState } from "../lib/api";
import { useActive, useSession } from "../lib/session";

type Spec = { plan: Plan; url?: string; name?: string };
export const encSpec = (s: Spec) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decSpec = (s: string | null): Spec | null => { if (!s) return null; try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o?.plan?.steps ? o : null; } catch { return null; } };
const remember = (id: string, spec: Spec) => { try { localStorage.setItem(`wc.run.${id}`, JSON.stringify(spec)); } catch { /* fine */ } };
const recall = (id: string): Spec | null => { try { const t = localStorage.getItem(`wc.run.${id}`); return t ? JSON.parse(t) : null; } catch { return null; } };

const summary = (e: RunEvent): string => {
  const d = e.detail ?? {};
  if (e.topic === "plan") return `${e.phase}${d.op ? ` · ${String(d.op)}` : ""}${d.selector ? ` ${String(d.selector)}` : ""}`;
  if (e.topic === "error") return `${e.error?.code ?? "error"} · ${e.error?.message ?? ""}`;
  const url = (e.url ?? (e as { final_url?: string }).final_url) as string | undefined;
  return `${e.phase ?? ""}${url ? ` ${url}` : ""}${(e as { status_code?: number }).status_code ? ` · ${(e as { status_code?: number }).status_code}` : ""}`;
};

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
  const [view, setView] = React.useState<"graph" | "tree">("graph");
  const [big, setBig] = React.useState(false);
  const logFrom = Math.max(0, t - 80);
  const log = events.slice(logFrom, t).map((e, k) => ({ e, i: logFrom + k })).filter(({ e }) => e.topic !== "resources").filter(({ e }) => !focusStage || (e.topic === "plan" && stages.length > 0 && (() => { const st = stagesLib.flatStages(stages).find((s) => s.id === focusStage); return st && e.detail?.op === st.op && (!st.arg || e.detail?.selector === st.arg); })()));
  const runs = useQuery({ queryKey: ["runs", runId, data?.status], queryFn: api.runs, enabled: active });
  const step = (d: number) => { setLive(false); setT((x) => Math.max(0, Math.min(events.length, x + d))); };
  const elapsed = data ? ((data.finished ?? Date.now() / 1000) - data.started).toFixed(1) : "";
  const logRef = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => { const l = logRef.current; if (live && l) l.scrollTop = l.scrollHeight; }, [live, t]); // (not scrollIntoView: that scrolls the page too)

  if (!runId && !spec) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6"><EmptyState title="No plan loaded" hint="Open one from Author (Open in Run), or paste a plan below. It loads as a pipeline graph; Run ▶ executes it: the stages realise live, rows stream in, and the run is recorded as a trace." /><PlanLoader onLoad={load} /></div>;
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
          <input type="range" min={0} max={Math.max(1, events.length)} value={Math.min(t, events.length)} onChange={(e) => { setLive(false); setT(Number(e.target.value)); }} className="w-72" />
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => step(1)} title="one event forward">▶</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => setLive(true)} title="follow the run live">⏭</button>
          <span className={cn("ml-1 rounded px-1 text-[10px]", live ? "bg-accent-soft text-accent" : "text-muted")}>{live ? "live" : `at ${t}/${events.length}`}</span>
        </div>
        <span className="flex-1" />
        {data?.trace && !running && <a href={`/traces/${encodeURIComponent(data.trace)}`} className="text-accent underline" title="the recorded trace: replay, events, plan">trace ↗</a>}
        <LoadMenu onLoad={load} />
        {runs.data && runs.data.length > 1 && <select className="h-6 rounded border border-line bg-surface px-1 text-[10.5px]" value={runId ?? ""} onChange={(e) => setParams((q) => { const n = new URLSearchParams(q); n.set("id", e.target.value); n.delete("p"); return n; })}>{runs.data.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.status} · {r.rows} rows</option>)}</select>}
      </div>
      {startError && <div className="px-2 py-1 text-bad">{startError}</div>}
      {data?.error && <div className="border-b border-bad/40 bg-bad-soft/40 px-2 py-0.5 text-[11px]"><b className="text-bad">{data.error.code}</b> {data.error.message}{data.error.hint ? <span className="text-muted"> — {data.error.hint}</span> : null}</div>}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1 p-1" style={{ gridTemplateRows: big ? "minmax(0,1fr)" : "minmax(0,1.6fr) minmax(0,1fr)" }}>
        {/* the plan as a pipeline graph (or the stage tree), realising live */}
        <section className="flex min-h-0 flex-col rounded border border-line">
          <div className="flex items-center gap-1 border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Pipeline
            <span className="ml-1 flex overflow-hidden rounded border border-line font-normal normal-case">{(["graph", "tree"] as const).map((v) => <button key={v} type="button" className={cn("px-1.5", view === v ? "bg-accent-soft text-accent" : "hover:text-ink")} onClick={() => setView(v)}>{v}</button>)}</span>
            {plan && <span className="ml-1 min-w-0 truncate font-mono font-normal normal-case tracking-normal" title={planLib.describe(plan)}>{planLib.describe(plan)}</span>}
            <span className="flex-1" />{focusStage && <button type="button" className="font-normal normal-case hover:text-ink" onClick={() => setFocusStage(null)}>all events</button>}
            <button type="button" className="ml-1 shrink-0 whitespace-nowrap rounded border border-line px-1 font-normal normal-case hover:text-ink" onClick={() => setBig(!big)} title={big ? "show the rows, errors and events again" : "give the graph the whole workspace"}>{big ? "⤡ restore" : "⤢ maximise"}</button></div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-0.5">{!stages.length ? <span className="p-2 text-muted">…</span> : view === "graph"
            ? <PipelineGraph stages={stages} stats={stats} resources={resources} at={t} running={running || (!live && !!data)} selected={focusStage} onStage={(s) => setFocusStage(s.id === focusStage ? null : s.id)} />
            : <StagePlan stages={stages} stats={stats} at={t} running={running || !live} onStage={(s) => setFocusStage(s.id === focusStage ? null : s.id)} />}</div>
        </section>
        {/* the rows as they stream, then errors + the event log */}
        <div className={cn("grid min-h-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-1", big && "hidden")}>
          <section className="flex min-h-0 flex-col rounded border border-line">
            <div className="border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Output · {rowsAt.length} rows{!live ? ` (at event ${t})` : running ? " (streaming)" : ""}</div>
            <div className="min-h-0 flex-1 overflow-auto">{rowsAt.length ? <DataFrame rows={rowsAt} dense /> : <div className="p-2 text-muted">{running ? "waiting for the first row…" : "no rows at this point"}</div>}</div>
          </section>
          <div className="grid min-h-0 grid-rows-[minmax(0,0.6fr)_minmax(0,1.4fr)] gap-1">
            <section className="flex min-h-0 flex-col rounded border border-line">
              <div className="border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Errors · {errors.length}</div>
              <ul className="min-h-0 flex-1 overflow-auto">{errors.map(({ e, i }) => <li key={i}><button type="button" className="w-full px-1.5 py-px text-left hover:bg-surface-2" onClick={() => { setLive(false); setT(i + 1); }}><b className={e.raised === false ? "text-warn" : "text-bad"}>{e.error?.code}</b> <span className="text-muted">#{i}{e.raised === false ? " · missing (optional)" : ""}{e.item ? ` · item ${e.item.join(".")}` : ""}</span> {e.error?.message}</button></li>)}{!errors.length && <li className="p-1.5 text-muted">none</li>}</ul>
            </section>
            <section className="flex min-h-0 flex-col rounded border border-line">
              <div className="border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Events{focusStage ? " · this stage" : ""} · up to #{t}</div>
              <ol ref={logRef} className="min-h-0 flex-1 overflow-auto font-mono text-[9.5px] leading-[14px]">{log.map(({ e, i }) => <li key={i}><button type="button" className={cn("flex w-full gap-1 px-1 text-left hover:bg-surface-2", i === t - 1 && "bg-accent-soft")} onClick={() => { setLive(false); setT(i + 1); }}><span className="w-8 shrink-0 text-right text-muted">{i}</span><span className={cn("w-16 shrink-0 truncate", e.topic === "error" ? "text-bad" : e.topic === "plan" ? "text-accent" : "text-topic-network")}>{String(e.topic ?? "")}</span><span className="min-w-0 truncate">{summary(e)}</span></button></li>)}</ol>
            </section>
          </div>
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

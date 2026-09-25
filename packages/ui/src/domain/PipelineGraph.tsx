import * as React from "react";
import { cn } from "../lib/cn";
import { ACTION_COLOUR, actionOf, itemGroups, resourceSummary, type Action, type ItemGroups, type Resources, type Stage, type StageStat } from "../lib/stages";

export type PipelineGraphProps = {
  stages: Stage[];
  stats: Record<string, StageStat>;
  /** the event index the view is at: a stage touched in the last few events is ACTIVE */
  at: number;
  running: boolean;
  selected?: string | null;
  onStage?: (s: Stage) => void;
  /** the pool's occupancy over the run (http slots, browser pages, queued) up to `at` */
  resources?: Resources[];
  /** false: the plan only, nothing run (no resources strip, no run states in the legend) */
  live?: boolean;
  className?: string;
};

const W = 172, H = 66, PW = 82, PH = 24, GX = 26, GY = 26;
const FAN = new Set(["select_all", "paginate", "links"]);
const WHOLE = new Set(["extract", "project", "merge", "limit", "filter"]);
const ACTION_LABEL: Record<Action, string> = { network: "fetch", fanout: "fan-out", find: "find", read: "read", interact: "interact", shape: "shape" };

/** a CARD: a run of steps that happen together (select → attr → number: one op, as Dagster shows
 * an op) -- a fetch or a fan-out starts its own; the whole-collection ops (extract, merge, project)
 * are small join PILLS; a name read from the page (alias) rides on the card it names */
type Card = { id: string; stages: Stage[]; names: Stage[]; pill: boolean };
type Placed = { c: Card; x: number; y: number; w: number; h: number; parents: Placed[] };
type Flow = { c: Card; branches: Flow[]; next?: Flow };
/** a FAN-OUT LANE: the cards that run once per item of a fan-out, boxed and labelled with the
 * item count and the width -- one lane stands for all N items, so 5,000 items draw as one */
type Lane = { fan: Card; members: Placed[]; depth: number };

const alone = (s: Stage) => FAN.has(s.op) || WHOLE.has(s.op) || s.op === "resolve";
const flat = (s: Stage): Stage[] => [s, ...s.children.flatMap(flat)];
const flatHas = (s: Stage, col: string): boolean => flat(s).some((x) => x.column === col);
const lastOf = (c: Card) => c.stages[c.stages.length - 1]!;

/** a chain (the rest of a column hangs under its head, marked `chain`) as a flow of cards */
function flowOf(seq: Stage[]): Flow | undefined {
  const [head, ...rest0] = seq; if (!head) return undefined;
  const card: Card = { id: head.id, stages: [head], names: [], pill: WHOLE.has(head.op) };
  let branches = head.children.filter((c) => !c.chain); let rest = [...head.children.filter((c) => c.chain), ...rest0];
  const absorbNames = () => { const nm = branches.filter((b) => b.column === "(the name)" || flatHas(b, "(the name)")); if (lastOf(card).op === "attr" && nm.length) { card.names.push(...nm.flatMap(flat)); branches = branches.filter((b) => !nm.includes(b)); } };
  absorbNames();
  while (!alone(head) && !branches.length && rest[0] && !alone(rest[0])) {
    const nx = rest.shift()!; card.stages.push(nx);
    branches = nx.children.filter((c) => !c.chain); rest = [...nx.children.filter((c) => c.chain), ...rest]; absorbNames();
  }
  return { c: card, branches: branches.map((b) => flowOf([b])!), next: flowOf(rest) };
}

/** Lay the plan out LEFT → RIGHT: a chain along one row, an extract's columns stacked in the next
 * column (the extract centred on them), what runs after the columns joins them all (fan-in); the
 * cards that run per item of a fan-out are collected into its lane. */
function layout(stages: Stage[]): { nodes: Placed[]; lanes: Lane[]; w: number; h: number } {
  const nodes: Placed[] = []; const lanes: Lane[] = []; let row = 0; let right = 0;
  const place = (f: Flow, x: number, parents: Placed[], yFix?: number, fan?: Card, depth = 0): { me: Placed; leaves: Placed[]; end: number } => {
    const w = f.c.pill ? PW : W, h = f.c.pill ? PH : H;
    const me: Placed = { c: f.c, x, y: 0, w, h, parents }; nodes.push(me); right = Math.max(right, x + w);
    const s0 = nodes.length - 1;
    const after = x + w + GX;
    const iFan = FAN.has(lastOf(f.c).op) ? f.c : undefined; // what I fan out to is the next lane
    let res: { me: Placed; leaves: Placed[]; end: number };
    if (f.branches.length) {
      const b0 = nodes.length;
      const kids = f.branches.map((b) => place(b, after, [me], undefined, undefined, depth + (fan ? 1 : 0)));
      if (fan && f.c.pill) lanes.push({ fan, members: nodes.slice(b0), depth }); // the per-item columns of an extract
      me.y = (kids[0]!.me.y + kids[0]!.me.h / 2 + kids[kids.length - 1]!.me.y + kids[kids.length - 1]!.me.h / 2) / 2 - h / 2;
      const leaves = kids.flatMap((k) => k.leaves); const end = Math.max(...kids.map((k) => k.end));
      if (!f.next) res = { me, leaves, end };
      else { const n = place(f.next, end, leaves, me.y + h / 2, iFan, depth); res = { me, leaves: n.leaves, end: n.end }; }
    } else if (!f.next) { const mid = yFix ?? row++ * (H + GY) + H / 2; me.y = mid - h / 2; res = { me, leaves: [me], end: after }; }
    else { const n = place(f.next, after, [me], yFix, iFan, depth + (iFan ? 1 : 0)); me.y = n.me.y + n.me.h / 2 - h / 2; res = { me, leaves: n.leaves, end: n.end }; }
    // a fan-out followed by per-item steps (not a whole-collection op): those steps are its lane
    if (fan && !f.c.pill) lanes.push({ fan, members: nodes.slice(s0).filter((n) => !n.c.pill), depth });
    return res;
  };
  const root = flowOf(stages); if (root) place(root, 0, []);
  const top = Math.min(0, ...nodes.map((n) => n.y)) - 18; nodes.forEach((n) => { n.y -= top; });
  const h = Math.max(H, ...nodes.map((n) => n.y + n.h)) + GY;
  return { nodes, lanes: lanes.filter((l) => l.members.length), w: right + 12, h };
}

type St = "wait" | "run" | "done" | "fail";
const STATUS: Record<St, string> = { wait: "#cbd5e1", run: "#2563eb", done: "#16a34a", fail: "#dc2626" };
const CELL: Record<string, string> = { done: "#16a34a", missing: "#f59e0b", failed: "#dc2626", pending: "#e2e8f0" };
const TIMED = new Set(["resolve", "paginate", "click", "write", "scroll", "wait_for", "goto", "download", "hover", "press"]);

/** The run as a PIPELINE GRAPH (in the manner of Prefect / Dagster). Cards are coloured by what
 * they DO (fetch, fan-out, find, read, interact, shape) and bordered by their state (waiting,
 * running, done, failed); each fan-out's per-item cards sit in a LANE labelled with the item count
 * and how many run at once, the fan-out card showing its items as a binned strip (done / in flight
 * / waiting) so thousands of items stay one picture; the pool's occupancy (http slots, browser
 * pages, queued) runs along the top. Wheel to zoom, drag to pan. */
export function PipelineGraph({ stages, stats, at, running, selected, onStage, resources = [], live = true, className }: PipelineGraphProps) {
  const { nodes, lanes, w, h } = React.useMemo(() => layout(stages), [stages]);

  // -- pan + zoom: fitted until the person moves it ------------------------------------------
  const box = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ x: 12, y: 12, z: 1 });
  const [manual, setManual] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const fit = React.useCallback(() => {
    const el = box.current; if (!el) return; const r = el.getBoundingClientRect(); if (r.width < 20) return;
    const z = Math.max(0.2, Math.min(1.4, (r.width - 24) / w, (r.height - 60) / h));
    setView({ z, x: Math.max(12, (r.width - w * z) / 2), y: Math.max(30, (r.height - h * z) / 2) });
  }, [w, h]);
  React.useLayoutEffect(() => {
    if (manual) return; fit(); const el = box.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit()); ro.observe(el); return () => ro.disconnect();
  }, [fit, manual]);
  const zoomAt = React.useCallback((factor: number, cx?: number, cy?: number) => {
    setManual(true);
    setView((v) => { const r = box.current?.getBoundingClientRect(); const px = cx ?? (r ? r.width / 2 : 0), py = cy ?? (r ? r.height / 2 : 0); const z = Math.max(0.15, Math.min(2.5, v.z * factor)); return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z }; });
  }, []);
  React.useEffect(() => {
    const el = box.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); const r = el.getBoundingClientRect();
      // wheel / pinch zooms about the pointer; a sideways swipe pans
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      else { setManual(true); setView((v) => ({ ...v, x: v.x - e.deltaX })); }
    };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("[data-card],[data-ctl]")) return; drag.current = { x: e.clientX, y: e.clientY }; setDragging(true); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onPointerMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; drag.current = { x: e.clientX, y: e.clientY }; setManual(true); setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); };
  const onPointerUp = () => { drag.current = null; setDragging(false); };
  const pan = (dx: number, dy: number) => { setManual(true); setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); };

  // -- state ---------------------------------------------------------------------------------
  const stageState = (id: string): St => { const st = stats[id]; if (!st) return "wait"; if (st.errors.some((e) => e.raised !== false)) return "fail"; const active = st.last !== undefined && at - st.last < 15; if (running && active) return "run"; if (st.count > 0 || st.fanout > 0) return (st.expected && st.count < st.expected && running) ? "run" : "done"; return "wait"; };
  const cardState = (c: Card): St => { const all = [...c.stages, ...c.names].map((s) => stageState(s.id)); if (all.includes("fail")) return "fail"; if (all.includes("run")) return "run"; if (all.every((x) => x === "wait")) return "wait"; if (all.some((x) => x === "wait") && running) return "run"; return "done"; };
  const lead = (c: Card): StageStat => stats[lastOf(c).id] ?? { count: 0, errors: [], fanout: 0 };
  /** a lane's progress: the least-complete of its cards, as items done out of the fan-out */
  const laneDone = (l: Lane, n: number): number => {
    const r = l.members.map((m) => { const s = lead(m.c); return s.expected ? Math.min(1, s.count / s.expected) : s.count > 0 ? 1 : 0; });
    return Math.floor((r.length ? Math.min(...r) : 0) * n);
  };
  const laneOf = new Map(lanes.map((l) => [l.fan.id, l] as const));
  const res = resources.length ? resources[resources.length - 1]! : null;

  return (
    <div ref={box} tabIndex={0} onKeyDown={(e) => { const k = e.key; if (k === "+" || k === "=") zoomAt(1.2); else if (k === "-") zoomAt(1 / 1.2); else if (k === "0") { setManual(false); fit(); } else if (k.startsWith("Arrow")) { e.preventDefault(); pan(k === "ArrowLeft" ? 60 : k === "ArrowRight" ? -60 : 0, k === "ArrowUp" ? 60 : k === "ArrowDown" ? -60 : 0); } }}
      className={cn("relative h-full w-full touch-none select-none overflow-hidden bg-surface-2/40 outline-none", dragging ? "cursor-grabbing" : "cursor-grab", className)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {/* the graph */}
      <div className="absolute left-0 top-0" style={{ width: w, height: h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: "0 0" }}>
        {/* fan-out lanes, outermost first */}
        {[...lanes].sort((a, b) => a.depth - b.depth).map((l) => {
          const pad = 8; const x0 = Math.min(...l.members.map((m) => m.x)) - pad, y0 = Math.min(...l.members.map((m) => m.y)) - pad - 12;
          const x1 = Math.max(...l.members.map((m) => m.x + m.w)) + pad, y1 = Math.max(...l.members.map((m) => m.y + m.h)) + pad;
          const fs = stats[lastOf(l.fan).id]; const n = fs?.fanout ?? 0; const par = fs?.parallel;
          return (
            <div key={`lane-${l.fan.id}`} className="pointer-events-none absolute overflow-hidden rounded-lg border border-dashed" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0, borderColor: ACTION_COLOUR.fanout, background: "rgba(124,58,237,0.035)" }}>
              <div className="flex min-w-0 items-center gap-1 whitespace-nowrap px-1.5 text-[9px] leading-[14px]" style={{ color: ACTION_COLOUR.fanout }}>
                <span className="shrink-0 font-semibold">per {lastOf(l.fan).op === "paginate" ? "page" : "item"}</span>
                <span className="min-w-0 truncate">{n ? `×${n.toLocaleString()}` : "× n"}{fs?.fanouts && fs.fanouts > 1 ? ` over ${fs.fanouts} runs` : ""}{par ? ` · ${par.limit} at once (${par.bound === "page" ? "browser pages" : "http slots"})` : ""}</span>
              </div>
            </div>
          );
        })}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={w} height={h}>
          {nodes.flatMap((n) => n.parents.map((p) => ({ n, p }))).map(({ n, p }) => {
            const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = n.x, y2 = n.y + n.h / 2; const mx = (x1 + x2) / 2;
            const st = cardState(n.c); const src = lastOf(p.c); const fan = FAN.has(src.op) ? stats[src.id]?.fanout ?? 0 : 0;
            const colour = st === "wait" ? "#cbd5e1" : st === "fail" ? "#dc2626" : st === "run" ? "#2563eb" : "#94a3b8";
            const label = fan >= 1000 ? `×${(fan / 1000).toFixed(fan >= 10000 ? 0 : 1)}k` : `×${fan}`;
            return (
              <g key={`${p.c.id}-${n.c.id}`}>
                {/* a fan-out edge draws as a bundle: a few offset strands say "many" without drawing them */}
                {fan > 1 && [-3, 3].map((o) => <path key={o} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2 + o} ${x2},${y2 + o}`} fill="none" stroke={ACTION_COLOUR.fanout} strokeOpacity={0.35} strokeWidth={1} />)}
                <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={fan > 1 ? ACTION_COLOUR.fanout : colour} strokeWidth={fan > 1 ? 1.8 : 1.3} strokeDasharray={st === "run" ? "5 4" : undefined}>
                  {st === "run" && <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.6s" repeatCount="indefinite" />}
                </path>
                {fan > 0 && <g transform={`translate(${mx},${(y1 + y2) / 2})`}><rect x={-17} y={-7.5} width={34} height={15} rx={7} fill={ACTION_COLOUR.fanout} /><text textAnchor="middle" y={3.5} fontSize={9.5} fill="white" fontFamily="ui-monospace, monospace">{label}</text></g>}
              </g>
            );
          })}
        </svg>
        {nodes.map((n) => {
          const c = n.c; const s = cardState(c); const st = lead(c); const first = c.stages[0]!; const last = lastOf(c);
          const act = actionOf(first.op); const colour = ACTION_COLOUR[act];
          const errs = [...c.stages, ...c.names].reduce((k, x) => k + (stats[x.id]?.errors.filter((e) => e.raised !== false).length ?? 0), 0);
          const fan = FAN.has(last.op) ? stats[last.id]?.fanout ?? 0 : 0; const par = FAN.has(last.op) ? stats[last.id]?.parallel : undefined;
          const sel = c.stages.some((x) => x.id === selected);
          const tip = [...c.stages.map((x) => `${x.op}${x.arg ? ` ${x.arg}` : ""}${x.column ? ` → ${x.column}` : ""}: ${stats[x.id]?.count ?? 0}${stats[x.id]?.expected ? ` of ${stats[x.id]!.expected}` : ""}`), ...c.names.map((x) => `name from: ${x.op} ${x.arg ?? ""}`), fan ? `fanned out to ${fan}${par ? `, ${par.limit} at once` : ""}` : "", errs ? `${errs} errors` : ""].filter(Boolean).join("\n");
          if (c.pill) return (
            <button key={c.id} data-card="" type="button" onClick={() => onStage?.(first)} title={tip} className={cn("absolute flex min-w-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border-2 bg-surface px-1.5 font-mono text-[9.5px] shadow-sm", sel && "ring-2 ring-accent/60", live && s === "wait" && "opacity-60")} style={{ left: n.x, top: n.y, width: n.w, height: n.h, borderColor: live ? STATUS[s] : "var(--color-line)" }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: colour }} /><span className="shrink-0">{first.op}</span>{first.column ? <span className="min-w-0 truncate text-accent">→{first.column}</span> : null}
            </button>
          );
          // the items this card ran over: cells done / missing / failed / pending, grouped per parent item
          const perItem = !!st.feed || Object.keys(st.items ?? {}).some((k) => k !== "");
          // an item's state on the card is its WORST across the card's steps (a select that missed, then its attr ran on nothing)
          const RANK = { done: 0, missing: 1, failed: 2 } as const;
          const merged: Record<string, "done" | "missing" | "failed"> = {};
          for (const x of c.stages) for (const [k, v] of Object.entries(stats[x.id]?.items ?? {})) if (!merged[k] || RANK[v] > RANK[merged[k]!]) merged[k] = v;
          const ig = perItem ? itemGroups({ ...st, items: merged }, st.feed ? stats[st.feed] : undefined) : null;
          type Tally = { done: number; missing: number; failed: number; pending: number };
          const tally: Tally | null = ig ? ig.groups.reduce<Tally>((t, g) => { for (const x of g.cells) t[x] += 1; return t; }, { done: 0, missing: 0, failed: 0, pending: 0 }) : null;
          const pct = st.expected ? Math.min(1, st.count / st.expected) : s === "done" ? 1 : s === "run" ? 0.5 : 0;
          const total = tally ? tally.done + tally.missing + tally.failed + tally.pending : 0;
          const timed = TIMED.has(last.op) || TIMED.has(first.op);
          const tStat = stats[(timed && TIMED.has(first.op) ? first : last).id];
          return (
            <button key={c.id} data-card="" type="button" onClick={() => onStage?.(last)} title={tip} className={cn("absolute flex min-w-0 flex-col justify-between overflow-hidden rounded-md border-2 bg-surface py-0.5 pl-2 pr-1.5 text-left shadow-sm transition-colors", sel && "ring-2 ring-accent/60", live && s === "wait" && "opacity-60")} style={{ left: n.x, top: n.y, width: n.w, height: n.h, borderColor: live ? STATUS[s] : "var(--color-line)" }}>
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: colour }} />
              <div className="flex w-full min-w-0 items-center gap-1 whitespace-nowrap text-[9.5px]">
                <span className="shrink-0 rounded-sm px-1 text-[8px] font-semibold uppercase leading-[12px] text-white" style={{ background: colour }}>{ACTION_LABEL[act]}</span>
                {last.column && last.column !== "(named from the page)" ? <span className="min-w-0 truncate font-medium text-accent">{last.column}</span> : c.names.length ? <span className="min-w-0 truncate text-muted">named by <span className="font-mono">{c.names.filter((x) => x.arg && x.op === "select").map((x) => x.arg).join(" ") || "the page"}</span></span> : fan ? <span className="min-w-0 truncate text-muted">{fan.toLocaleString()} items{par ? ` · ${par.limit} at once` : ""}</span> : null}
                <span className="min-w-0 flex-1" />
                {s === "run" && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                {errs > 0 && <span className="shrink-0 rounded-sm bg-bad-soft px-0.5 text-[9px] text-bad">✕{errs}</span>}
                {tally && (tally.missing > 0 || tally.failed > 0) && <span className="shrink-0 font-mono text-[9px]">{tally.missing > 0 && <span style={{ color: CELL.missing }}>{tally.missing}−</span>}{tally.failed > 0 && <span style={{ color: CELL.failed }}> {tally.failed}✕</span>}</span>}
                <span className="shrink-0 font-mono tabular-nums text-ink">{tally && total ? <>{tally.done.toLocaleString()}<span className="text-muted">/{total.toLocaleString()}</span></> : <>{st.count ? st.count.toLocaleString() : s === "wait" ? "" : "·"}{st.expected ? <span className="text-muted">/{st.expected.toLocaleString()}</span> : null}</>}</span>
              </div>
              <div className="w-full min-w-0 truncate whitespace-nowrap font-mono text-[9.5px]">{c.stages.map((x, i) => <React.Fragment key={x.id}>{i ? <span className="text-muted"> · </span> : null}<span style={{ color: ACTION_COLOUR[actionOf(x.op)] }}>{x.op}</span>{x.arg ? <span className="text-ink"> {x.arg}</span> : null}</React.Fragment>)}</div>
              {ig && ig.groups.length ? <ItemStrip ig={ig} /> : <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: STATUS[s] }} /></div>}
              {timed && <Timing stat={tStat} running={running} />}
            </button>
          );
        })}
      </div>

      {!nodes.length && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">The plan has no steps yet.</div>}
      {/* resources (top left): what the run is holding now, and in-use over time */}
      {live && <div data-ctl="" className="absolute left-1 top-1 z-10 flex max-w-[calc(100%-180px)] items-center gap-2 overflow-hidden whitespace-nowrap rounded border border-line bg-surface/95 px-1.5 py-0.5 text-[9.5px]">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">resources</span>
        {res ? <>
          <Gauge label="http" used={res.httpUsed} total={res.httpTotal} colour={ACTION_COLOUR.network} />
          <Gauge label="browser pages" used={res.pagesUsed} total={res.pagesTotal} colour={ACTION_COLOUR.interact} />
          <span className={cn("shrink-0", res.waiting ? "text-warn" : "text-muted")}>queued {res.waiting}</span>
          <Spark samples={resources} />
          <Stat label="mem" unit="MB" s={resourceSummary(resources, "memMb")} title={`resident memory of the server and its browsers${res.procs ? ` (${res.procs} processes)` : ""}`} />
          <Stat label="cpu" unit="%" s={resourceSummary(resources, "cpuPct")} title="CPU of the server and its browsers, in % of one core" />
        </> : <span className="text-muted">{running ? "sampling…" : "none recorded"}</span>}
      </div>}
      {/* the zoom controls (top right) */}
      <div data-ctl="" className="absolute right-1 top-1 z-10 flex gap-0.5 rounded border border-line bg-surface px-0.5 text-[10px]">
        <button type="button" className="px-1 hover:text-ink" onClick={() => zoomAt(1 / 1.2)} title="zoom out (wheel, or -)">−</button>
        <button type="button" className="px-1 tabular-nums hover:text-ink" onClick={() => { setManual(false); fit(); }} title="fit the graph to the box (0)">{manual ? "" : "fit "}{Math.round(view.z * 100)}%</button>
        <button type="button" className="px-1 hover:text-ink" onClick={() => zoomAt(1.2)} title="zoom in (wheel, or +)">+</button>
        <button type="button" className="px-1 hover:text-ink" onClick={() => { setManual(true); setView({ x: 12, y: 30, z: 1 }); }} title="actual size">1:1</button>
      </div>
      {/* the legend (bottom left): what the colours mean */}
      <div data-ctl="" className="absolute bottom-1 left-1 z-10 flex max-w-[calc(100%-8px)] flex-wrap items-center gap-1.5 rounded border border-line bg-surface/95 px-1.5 py-0.5 text-[9px] text-muted">
        {(Object.keys(ACTION_LABEL) as Action[]).map((a) => <span key={a} className="flex items-center gap-0.5"><span className="size-2 rounded-sm" style={{ background: ACTION_COLOUR[a] }} />{ACTION_LABEL[a]}</span>)}
        {live && <span className="mx-0.5 h-3 w-px bg-line" />}
        {live && (["wait", "run", "done", "fail"] as St[]).map((k) => <span key={k} className="flex items-center gap-0.5"><span className="size-2 rounded-sm border-2 bg-surface" style={{ borderColor: STATUS[k] }} />{k === "wait" ? "waiting" : k === "run" ? "running" : k === "done" ? "done" : "failed"}</span>)}
        <span className="mx-0.5 h-3 w-px bg-line" /><span>wheel: zoom · drag: pan · arrows, +, −, 0</span>
      </div>
    </div>
  );
}

function Gauge({ label, used, total, colour }: { label: string; used: number; total: number; colour: string }) {
  const cells = Math.min(total, 16);
  return (
    <span className="flex shrink-0 items-center gap-1" title={`${label}: ${used} of ${total} in use`}>
      <span className="text-muted">{label}</span>
      <span className="flex gap-px">{Array.from({ length: cells }, (_, i) => <span key={i} className="h-2 w-1 rounded-[1px]" style={{ background: i < Math.round((used / Math.max(total, 1)) * cells) ? colour : "#e2e8f0" }} />)}</span>
      <span className="font-mono tabular-nums text-ink">{used}/{total}</span>
    </span>
  );
}

/** in-use over the run: http slots + browser pages held, as a sparkline */
function Spark({ samples }: { samples: Resources[] }) {
  if (samples.length < 2) return null;
  const pts = samples.slice(-80); const max = Math.max(1, ...pts.map((p) => Math.max(p.httpTotal, p.pagesTotal)));
  const line = (f: (r: Resources) => number) => pts.map((p, i) => `${(i / (pts.length - 1)) * 70},${14 - (f(p) / max) * 13}`).join(" ");
  return (
    <svg width={70} height={14} className="shrink-0" aria-label="in use over time">
      <polyline points={line((r) => r.httpUsed)} fill="none" stroke={ACTION_COLOUR.network} strokeWidth={1} />
      <polyline points={line((r) => r.pagesUsed)} fill="none" stroke={ACTION_COLOUR.interact} strokeWidth={1} />
    </svg>
  );
}

/** A stage's items as cells: [x][x][f][-] -- done, missing (an optional miss), failed, pending. Nested
 * fan-outs group per parent item ([[][][]] [[][][]]); past what fits, cells and groups are BINNED (a
 * bin shows its worst state: failed, then missing, then pending), so 5,000 items stay one strip. */
function ItemStrip({ ig }: { ig: ItemGroups }) {
  const worst = (xs: string[]): string => (xs.includes("failed") ? "failed" : xs.includes("missing") ? "missing" : xs.includes("pending") ? (xs.includes("done") ? "partial" : "pending") : "done");
  const colour = (k: string) => (k === "partial" ? "#86efac" : CELL[k]!);
  const bin = <T,>(xs: T[], max: number): T[][] => { if (xs.length <= max) return xs.map((x) => [x]); const out: T[][] = []; for (let b = 0; b < max; b++) out.push(xs.slice(Math.floor((b * xs.length) / max), Math.floor(((b + 1) * xs.length) / max))); return out; };
  const tally = (cells: string[]) => { const t: Record<string, number> = {}; cells.forEach((c) => { t[c] = (t[c] ?? 0) + 1; }); return Object.entries(t).map(([k, v]) => `${v} ${k}`).join(" · "); };
  const all = ig.groups.flatMap((g) => g.cells);
  const title = `${tally(all)}${ig.groups.length > 1 ? ` in ${ig.groups.length} groups` : ""}${ig.pendingGroups ? ` · ${ig.pendingGroups} groups to come` : ""}`;
  if (ig.groups.length <= 1) {
    const cells = bin(ig.groups[0]?.cells ?? [], 44);
    return <div className="flex h-2 w-full gap-px overflow-hidden" title={title}>{cells.map((b, i) => <span key={i} className="h-full min-w-[2px] flex-1 rounded-[1px]" style={{ background: colour(worst(b)) }} />)}</div>;
  }
  // grouped: each parent's items in a bracket; many groups -> each group one mini bar of its states
  const fitsCells = ig.groups.length <= 12 && all.length <= 48;
  const groups = bin(ig.groups, 30);
  return (
    <div className="flex h-2.5 w-full items-stretch gap-[2px] overflow-hidden" title={title}>
      {fitsCells ? ig.groups.map((g) => (
        <span key={g.key} className="flex flex-1 gap-px rounded-[2px] border border-line/80 p-px">{g.cells.map((c, i) => <span key={i} className="h-full min-w-[1px] flex-1 rounded-[1px]" style={{ background: CELL[c] }} />)}</span>
      )) : groups.map((gs, i) => {
        const cells = gs.flatMap((g) => g.cells); const t = cells.length || 1; const f = (k: string) => (cells.filter((c) => c === k).length / t) * 100;
        return <span key={i} className="flex min-w-[3px] flex-1 flex-col overflow-hidden rounded-[2px] border border-line/80">{(["failed", "missing", "done", "pending"] as const).map((k) => f(k) > 0 && <span key={k} style={{ height: `${f(k)}%`, background: CELL[k] }} />)}</span>;
      })}
      {ig.pendingGroups > 0 && <span className="shrink-0 self-center font-mono text-[8px] text-muted">+{ig.pendingGroups}</span>}
    </div>
  );
}

/** How long a fetch / an interaction takes: the typical time so far, and a bar for the slowest one still
 * running against it (amber past twice the typical, red past five times). */
function Timing({ stat, running }: { stat: StageStat | undefined; running: boolean }) {
  const d = [...(stat?.durations ?? [])].sort((a, b) => a - b); const live = running ? stat?.inflight ?? [] : [];
  const med = d.length ? d[Math.floor(d.length / 2)]! : 0; const slow = live.length ? Math.max(...live) : 0;
  const scale = Math.max(med * 2, 1); const pct = Math.min(1, slow / scale);
  const fmt = (x: number) => (x < 1 ? `${Math.round(x * 1000)}ms` : `${x.toFixed(1)}s`);
  const tone = slow > med * 5 && med > 0 ? "#dc2626" : slow > med * 2 && med > 0 ? "#f59e0b" : "#2563eb";
  return (
    <div className="flex w-full min-w-0 items-center gap-1 whitespace-nowrap text-[8.5px] text-muted" title={d.length ? `${d.length} done · median ${fmt(med)} · slowest ${fmt(d[d.length - 1]!)}${live.length ? ` · ${live.length} running, the longest ${fmt(slow)}` : ""}` : live.length ? `${live.length} running` : "not run yet"}>
      <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">{live.length > 0 && <span className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct * 100}%`, background: tone }} />}</span>
      <span className="shrink-0 font-mono tabular-nums">{live.length ? `${live.length}▶ ${fmt(slow)}` : ""}{d.length ? `${live.length ? " · " : ""}~${fmt(med)}` : ""}</span>
    </div>
  );
}

/** a resource's value now, with its max and average over the run so far */
function Stat({ label, unit, s, title }: { label: string; unit: string; s: { now?: number; max?: number; avg?: number }; title: string }) {
  if (s.now === undefined) return null;
  const f = (x: number) => (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(1));
  return (
    <span className="flex shrink-0 items-center gap-1" title={`${title}\nnow ${f(s.now)}${unit} · max ${f(s.max!)}${unit} · avg ${f(s.avg!)}${unit}`}>
      <span className="text-muted">{label}</span><span className="font-mono tabular-nums text-ink">{f(s.now)}{unit}</span>
      <span className="font-mono text-[8.5px] tabular-nums text-muted">max {f(s.max!)} · avg {f(s.avg!)}</span>
    </span>
  );
}

import * as React from "react";
import { cn } from "../lib/cn";
import type { Stage, StageStat } from "../lib/stages";

export type PipelineGraphProps = {
  stages: Stage[];
  stats: Record<string, StageStat>;
  /** the event index the view is at: a stage touched in the last few events is ACTIVE */
  at: number;
  running: boolean;
  selected?: string | null;
  onStage?: (s: Stage) => void;
  className?: string;
};

const KIND_COLOUR: Record<string, string> = { FETCH: "#2563eb", PAGES: "#2563eb", EACH: "#7c3aed", FIND: "#0891b2", READ: "#16a34a", CAST: "#16a34a", COLUMNS: "#ca8a04", EMIT: "#64748b", MERGE: "#64748b", ACT: "#db2777", LIMIT: "#64748b", FILTER: "#64748b" };
const W = 172, H = 48, PW = 96, PH = 24, GX = 34, GY = 8;
const FAN = new Set(["select_all", "paginate", "links"]);
const WHOLE = new Set(["extract", "project", "merge", "limit", "filter"]);
/** a CARD: a run of steps that happen together (select → attr → number: one op, as Dagster shows
 * an op) -- a fetch or a fan-out starts its own; the whole-collection ops (extract, merge, project)
 * are small join PILLS; a name read from the page (alias) rides on the card it names */
type Card = { id: string; stages: Stage[]; names: Stage[]; pill: boolean };
type Placed = { c: Card; x: number; y: number; w: number; h: number; parents: Placed[] };
type Flow = { c: Card; branches: Flow[]; next?: Flow };

const alone = (s: Stage) => FAN.has(s.op) || WHOLE.has(s.op) || s.op === "resolve";
/** a chain (the rest of a column hangs under its head, marked `chain`) as a flow of cards */
function flowOf(seq: Stage[]): Flow | undefined {
  const [head, ...rest0] = seq; if (!head) return undefined;
  const card: Card = { id: head.id, stages: [head], names: [], pill: WHOLE.has(head.op) };
  let branches = head.children.filter((c) => !c.chain); let rest = [...head.children.filter((c) => c.chain), ...rest0];
  const absorbNames = () => { const nm = branches.filter((b) => b.column === "(the name)" || flatHas(b, "(the name)")); if (card.stages[card.stages.length - 1]!.op === "attr" && nm.length) { card.names.push(...nm.flatMap(flat)); branches = branches.filter((b) => !nm.includes(b)); } };
  absorbNames();
  // fold the plain steps that follow into this card
  while (!alone(head) && !branches.length && rest[0] && !alone(rest[0])) {
    const nx = rest.shift()!; card.stages.push(nx);
    branches = nx.children.filter((c) => !c.chain); rest = [...nx.children.filter((c) => c.chain), ...rest]; absorbNames();
  }
  return { c: card, branches: branches.map((b) => flowOf([b])!), next: flowOf(rest) };
}
const flat = (s: Stage): Stage[] => [s, ...s.children.flatMap(flat)];
const flatHas = (s: Stage, col: string): boolean => flat(s).some((x) => x.column === col);

/** Lay the plan out LEFT → RIGHT: a chain along one row, an extract's columns stacked in the next
 * column (the extract centred on them), and what runs after the columns joins all of them (fan-in). */
function layout(stages: Stage[]): { nodes: Placed[]; w: number; h: number } {
  const nodes: Placed[] = []; let row = 0; let right = 0;
  const place = (f: Flow, x: number, parents: Placed[], yFix?: number): { me: Placed; leaves: Placed[]; end: number } => {
    const w = f.c.pill ? PW : W, h = f.c.pill ? PH : H;
    const me: Placed = { c: f.c, x, y: 0, w, h, parents }; nodes.push(me); right = Math.max(right, x + w);
    const after = x + w + GX;
    if (f.branches.length) {
      const kids = f.branches.map((b) => place(b, after, [me]));
      me.y = (kids[0]!.me.y + kids[0]!.me.h / 2 + kids[kids.length - 1]!.me.y + kids[kids.length - 1]!.me.h / 2) / 2 - h / 2;
      const leaves = kids.flatMap((k) => k.leaves); const end = Math.max(...kids.map((k) => k.end));
      if (!f.next) return { me, leaves, end };
      const n = place(f.next, end, leaves, me.y + h / 2); return { me, leaves: n.leaves, end: n.end };
    }
    if (!f.next) { const mid = yFix ?? row++ * (H + GY) + H / 2; me.y = mid - h / 2; return { me, leaves: [me], end: after }; }
    // a chain sits on the row of what it leads to (a branching stage centres on its columns)
    const n = place(f.next, after, [me], yFix); me.y = n.me.y + n.me.h / 2 - h / 2; return { me, leaves: n.leaves, end: n.end };
  };
  const root = flowOf(stages); if (root) place(root, 0, []);
  const top = Math.min(0, ...nodes.map((n) => n.y)); if (top < 0) nodes.forEach((n) => { n.y -= top; });
  const h = Math.max(H, ...nodes.map((n) => n.y + n.h)) + GY;
  return { nodes, w: right, h };
}

/** The run as a PIPELINE GRAPH (in the manner of Prefect / Dagster): every step a card -- its kind,
 * op and argument, how many times it has run against how many it will (the fan-out of the EACH /
 * PAGES before it), a progress bar -- coloured by state (waiting, running, done, failed); the edges
 * carry the fan-out (×20) and animate while data flows along them. */
export function PipelineGraph({ stages, stats, at, running, selected, onStage, className }: PipelineGraphProps) {
  const { nodes, w, h } = React.useMemo(() => layout(stages), [stages]);
  // zoom: FIT the graph to the box until the person zooms by hand
  const box = React.useRef<HTMLDivElement>(null);
  const [manual, setManual] = React.useState<number | null>(null);
  const [fit, setFit] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width < 10) return; setFit(Math.max(0.35, Math.min(1, (r.width - 28) / w, (r.height - 28) / h))); };
    measure(); const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null; ro?.observe(el); return () => ro?.disconnect();
  }, [w, h]);
  const zoom = manual ?? fit;
  const setZoom = (f: (z: number) => number) => setManual(f(zoom));
  type St = "wait" | "run" | "done" | "fail";
  const stageState = (id: string): St => { const st = stats[id]; if (!st) return "wait"; if (st.errors.length) return "fail"; const active = st.last !== undefined && at - st.last < 15; if (running && active) return "run"; if (st.count > 0 || st.fanout > 0) return (st.expected && st.count < st.expected && running) ? "run" : "done"; return "wait"; };
  const RANK: Record<St, number> = { wait: 0, done: 1, run: 2, fail: 3 };
  const cardState = (c: Card): St => { const all = [...c.stages, ...c.names].map((s) => stageState(s.id)); if (all.includes("fail")) return "fail"; if (all.includes("run")) return "run"; if (all.every((x) => x === "wait")) return "wait"; if (all.some((x) => x === "wait") && running) return "run"; return all.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "wait" as St); };
  const lead = (c: Card): StageStat => stats[c.stages[c.stages.length - 1]!.id] ?? { count: 0, errors: [], fanout: 0 };
  const COL: Record<St, string> = { wait: "#cbd5e1", run: "#2563eb", done: "#16a34a", fail: "#dc2626" };
  const label = (s: Stage) => <><span className="text-muted">{s.op}</span>{s.arg ? <span className="text-ok"> {s.arg}</span> : null}</>;
  return (
    <div ref={box} className={cn("relative h-full w-full overflow-auto bg-surface-2/40", className)}>
      <div className="sticky left-full top-1 z-10 mr-1 flex w-max gap-0.5 rounded border border-line bg-surface px-0.5 text-[10px]" style={{ marginBottom: -20 }}>
        <button type="button" className="px-1 hover:text-ink" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))}>−</button>
        <button type="button" className="px-1 hover:text-ink" onClick={() => setManual(manual === null ? 1 : null)} title={manual === null ? "fitted to the box -- click for 100%" : "click to fit the box"}>{manual === null ? "fit " : ""}{Math.round(zoom * 100)}%</button>
        <button type="button" className="px-1 hover:text-ink" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}>+</button>
      </div>
      <div className="relative p-3" style={{ width: w * zoom + 24, height: h * zoom + 24 }}>
        <div className="relative" style={{ width: w, height: h, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={w} height={h}>
            {nodes.flatMap((n) => n.parents.map((p) => ({ n, p }))).map(({ n, p }) => {
              const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = n.x, y2 = n.y + n.h / 2; const mx = (x1 + x2) / 2;
              const st = cardState(n.c); const src = p.c.stages[p.c.stages.length - 1]!; const fan = FAN.has(src.op) ? stats[src.id]?.fanout ?? 0 : 0;
              const colour = st === "wait" ? "#cbd5e1" : st === "fail" ? "#dc2626" : st === "run" ? "#2563eb" : "#94a3b8";
              return (
                <g key={`${p.c.id}-${n.c.id}`}>
                  <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={colour} strokeWidth={fan > 1 ? 2.2 : 1.3} strokeDasharray={st === "run" ? "5 4" : undefined}>
                    {st === "run" && <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.6s" repeatCount="indefinite" />}
                  </path>
                  {fan > 0 && <g transform={`translate(${mx},${(y1 + y2) / 2})`}><rect x={-15} y={-7.5} width={30} height={15} rx={7} fill="#7c3aed" /><text textAnchor="middle" y={3.5} fontSize={9.5} fill="white" fontFamily="ui-monospace, monospace">×{fan}</text></g>}
                </g>
              );
            })}
          </svg>
          {nodes.map((n) => {
            const c = n.c; const s = cardState(c); const st = lead(c); const first = c.stages[0]!; const last = c.stages[c.stages.length - 1]!;
            const errs = [...c.stages, ...c.names].reduce((k, x) => k + (stats[x.id]?.errors.length ?? 0), 0);
            const fan = c.stages.reduce((k, x) => k + (FAN.has(x.op) ? stats[x.id]?.fanout ?? 0 : 0), 0);
            const sel = c.stages.some((x) => x.id === selected);
            const tip = [...c.stages.map((x) => `${x.op}${x.arg ? ` ${x.arg}` : ""}${x.column ? ` → ${x.column}` : ""}: ${stats[x.id]?.count ?? 0}${stats[x.id]?.expected ? ` of ${stats[x.id]!.expected}` : ""}`), ...c.names.map((x) => `name from: ${x.op} ${x.arg ?? ""}`), fan ? `fanned out to ${fan}` : "", errs ? `${errs} errors` : ""].filter(Boolean).join("\n");
            if (c.pill) return (
              <button key={c.id} type="button" onClick={() => onStage?.(first)} title={tip} className={cn("absolute flex items-center justify-center gap-1 rounded-full border-2 bg-surface px-1 font-mono text-[9.5px] shadow-sm", sel && "ring-2 ring-accent/60", s === "wait" && "opacity-60")} style={{ left: n.x, top: n.y, width: n.w, height: n.h, borderColor: COL[s] }}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOUR[first.kind] ?? "#64748b" }} /><span className="truncate">{first.op}</span>{first.column ? <span className="truncate text-accent">→{first.column}</span> : null}
              </button>
            );
            const pct = st.expected ? Math.min(1, st.count / st.expected) : s === "done" ? 1 : s === "run" ? 0.5 : 0;
            return (
              <button key={c.id} type="button" onClick={() => onStage?.(last)} title={tip} className={cn("absolute flex flex-col justify-between rounded-md border-2 bg-surface px-1.5 py-0.5 text-left shadow-sm transition-colors", sel && "ring-2 ring-accent/60", s === "wait" && "opacity-60")} style={{ left: n.x, top: n.y, width: n.w, height: n.h, borderColor: COL[s] }}>
                <div className="flex min-w-0 items-center gap-1 text-[9.5px]">
                  <span className="shrink-0 rounded-sm px-1 text-[8px] font-semibold leading-[12px] text-white" style={{ background: KIND_COLOUR[first.kind] ?? "#64748b" }}>{first.kind}</span>
                  {last.column && last.column !== "(named from the page)" ? <span className="truncate font-medium text-accent">{last.column}</span> : c.names.length ? <span className="truncate text-muted">named by <span className="font-mono">{c.names.filter((x) => x.arg && x.op === "select").map((x) => x.arg).join(" ") || "the page"}</span></span> : fan ? <span className="truncate text-muted">fans out to {fan}</span> : null}
                  <span className="flex-1" />
                  {s === "run" && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                  {errs > 0 && <span className="shrink-0 rounded-sm bg-bad-soft px-0.5 text-[9px] text-bad">✕{errs}</span>}
                  <span className="shrink-0 font-mono tabular-nums text-ink">{st.count || (s === "wait" ? "" : "·")}{st.expected ? <span className="text-muted">/{st.expected}</span> : null}</span>
                </div>
                <div className="min-w-0 truncate font-mono text-[9.5px]">{c.stages.map((x, i) => <React.Fragment key={x.id}>{i ? <span className="text-muted"> · </span> : null}{label(x)}</React.Fragment>)}</div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: COL[s] }} /></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

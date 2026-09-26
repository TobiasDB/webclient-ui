import * as React from "react";
import { cn } from "../../lib/cn";
import { ACTION_COLOUR, actionOf, type RunEvent } from "../../lib/stages";
import type { PlanModel } from "../../lib/run/plan";
import type { RunState } from "../../lib/run/state";

export type RunTimelineProps = {
  events: RunEvent[];
  model: PlanModel | null;
  /** the WHOLE run (every event folded): the lanes show all of it; the cursor is at `at` */
  full: RunState;
  at: number;
  onSeek: (index: number) => void;
  /** a step selected: its lane is outlined */
  addr?: string | null;
  onLane?: (addr: string) => void;
  /** resource samples (memory MB, CPU %) while it ran: drawn as lanes */
  samples?: { ts: number; mem_mb?: number; cpu_pct?: number }[];
  className?: string;
};

const LANE = 10, GAP = 2, LABEL = 150;
const NET = { navigation: "#2563eb", request: "#ea580c", asset: "#94a3b8" } as const;
type M = { t: number; t2?: number; colour?: string; tall?: boolean; tip: string; i: number };
type MarkLane = { id: string; label: string; colour: string; items: M[]; tall?: boolean };

/** ONE TIME AXIS for everything the run did: a lane per plan step (each pixel shaded by how many of its items
 * ran then -- a fan-out is a band as tall as its parallelism, red where items failed), then the pages opened,
 * every network request (navigations blue, background requests orange, assets grey, failures red), the actions,
 * the DOM changes and the errors. A cursor at the moment on screen; click or drag to go there. */
export function RunTimeline({ events, model, full, at, onSeek, addr, onLane, samples = [], className }: RunTimelineProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(700);
  React.useLayoutEffect(() => { const el = box.current; if (!el) return; const f = () => setW(Math.max(200, el.clientWidth - LABEL - 10)); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, []);
  const ts = React.useMemo(() => events.map((e) => e.ts ?? 0), [events]);
  const t0 = full.t0 || ts.find((x) => x > 0) || 0; const t1 = Math.max(t0 + 0.001, full.t);
  const X = (t: number) => ((t - t0) / (t1 - t0)) * w;
  const px = Math.max(1, Math.round(w));

  const steps = React.useMemo(() => {
    if (!model) return [];
    return model.nodes.filter((n) => full.nodes.get(n.addr)?.insts.size).map((n) => {
      const run = new Float32Array(px), fail = new Float32Array(px); let max = 0;
      for (const inst of full.nodes.get(n.addr)!.insts.values()) {
        const a = Math.max(0, Math.floor(X(inst.t0))), b = Math.min(px - 1, Math.max(a, Math.floor(X(inst.t1 ?? inst.t0))));
        for (let k = a; k <= b; k++) { run[k]! += 1; if (inst.state === "failed") fail[k]! += 1; }
      }
      for (let k = 0; k < px; k++) max = Math.max(max, run[k]!);
      return { n, run, fail, max, colour: ACTION_COLOUR[actionOf(n.op)] };
    });
  }, [model, full, px, t0, t1]); // eslint-disable-line react-hooks/exhaustive-deps

  const marks = React.useMemo(() => {
    const pages = [...full.docs.values()].map((d) => { const e = events[d.snaps[0]?.i ?? d.first]; return { t: e?.ts ?? 0, tip: `${d.url ?? d.id}${d.status ? ` · ${d.status}` : ""}${d.tier ? ` · ${d.tier}` : ""}`, i: d.snaps[0]?.i ?? d.first }; });
    const net = full.requests.map((r) => ({ t: r.t, t2: r.ms ? r.t + r.ms / 1000 : undefined, colour: r.failed ? "#dc2626" : NET[r.kind], tall: r.kind === "navigation", tip: `${r.method} ${r.url}${r.status ? ` → ${r.status}` : ""}${r.ms ? ` · ${r.ms.toFixed(0)} ms` : ""}`, i: r.i }));
    const acts = full.actions.map((i) => { const e = events[i] as RunEvent & { action?: string; args?: { selector?: string } }; return { t: e.ts ?? 0, tip: `${e.action} ${e.args?.selector ?? ""}`, i }; });
    const dom = events.map((e, i) => (e.topic === "rrweb" ? { t: e.ts ?? 0, tip: "DOM changes", i } : null)).filter(Boolean) as { t: number; tip: string; i: number }[];
    const errs = full.errors.map((x) => ({ t: x.t, tip: `${x.code}: ${x.message}`, i: x.i }));
    const lanes: MarkLane[] = [
      { id: "pages", label: "pages", colour: "#2563eb", items: pages, tall: true },
      { id: "net", label: "network", colour: "#ea580c", items: net },
      { id: "act", label: "actions", colour: "#0f766e", items: acts, tall: true },
      { id: "dom", label: "DOM changes", colour: "#7c3aed", items: dom },
      { id: "err", label: "errors", colour: "#dc2626", items: errs, tall: true },
    ];
    return lanes.filter((l) => l.items.length);
  }, [full, events]);

  // resources: a lane each, the value as an area (scaled to its max over the run)
  const gauges = React.useMemo(() => ([["mem_mb", "memory", "#0ea5e9", "MB"], ["cpu_pct", "CPU", "#f59e0b", "%"]] as const).map(([k, label, colour, unit]) => {
    const pts = samples.filter((x) => typeof x[k] === "number").map((x) => ({ t: x.ts, v: x[k] as number }));
    const max = Math.max(1, ...pts.map((p) => p.v));
    return { k, label, colour, unit, pts, max };
  }).filter((g) => g.pts.length > 1), [samples]);
  const H = (steps.length + marks.length + gauges.length) * (LANE + GAP) + 14;
  const cursor = at > 0 ? X(ts[Math.min(at, ts.length) - 1] ?? t0) : 0;
  const seekX = (x: number) => {
    if (!ts.length) return; const t = t0 + (Math.max(0, Math.min(w, x)) / w) * (t1 - t0);
    let lo = 0, hi = ts.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if ((ts[mid] ?? 0) < t) lo = mid + 1; else hi = mid; }
    onSeek(lo + 1);
  };
  const drag = React.useRef(false);
  const toX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left;

  return (
    <div ref={box} className={cn("overflow-y-auto overflow-x-hidden font-mono text-[9px]", className)}>
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL }}>
          {steps.map((s) => (
            <button key={s.n.addr} type="button" onClick={() => onLane?.(s.n.addr)} title={`${s.n.label} · up to ${s.max} at once`}
              className={cn("flex w-full items-center gap-1 truncate pr-1 text-left leading-none", addr === s.n.addr ? "text-accent" : "text-muted hover:text-ink")} style={{ height: LANE, marginBottom: GAP, paddingLeft: 2 + s.n.depth * 6 }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.colour }} /><span className="truncate">{s.n.label}</span>
            </button>
          ))}
          {gauges.map((g) => (
            <div key={g.k} className="flex items-center gap-1 truncate pr-1 font-sans font-medium uppercase leading-none tracking-wide text-muted" style={{ height: LANE, marginBottom: GAP }} title={`max ${Math.round(g.max)} ${g.unit}`}>
              <span className="size-1.5 shrink-0 rounded-sm" style={{ background: g.colour }} />{g.label} <span className="font-mono normal-case text-muted/70">≤{Math.round(g.max)}{g.unit}</span>
            </div>
          ))}
          {marks.map((l) => (
            <div key={l.id} className="flex items-center gap-1 truncate pr-1 font-sans font-medium uppercase leading-none tracking-wide text-muted" style={{ height: LANE, marginBottom: GAP }}>
              <span className="size-1.5 shrink-0 rounded-sm" style={{ background: l.colour }} />{l.label} <span className="font-mono normal-case text-muted/70">{l.items.length}</span>
            </div>
          ))}
        </div>
        <svg width={w} height={H} className="shrink-0 cursor-crosshair touch-none select-none"
          onPointerDown={(e) => { drag.current = true; (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId); seekX(toX(e)); }}
          onPointerMove={(e) => { if (drag.current) seekX(toX(e)); }} onPointerUp={() => { drag.current = false; }}>
          {steps.map((s, li) => {
            const y0 = li * (LANE + GAP); const cols: React.ReactNode[] = [];
            for (let k = 0; k < px;) {
              const c = s.run[k]!; if (!c) { k++; continue; }
              const hh = Math.max(2, Math.round((c / Math.max(1, s.max)) * LANE)); const f = s.fail[k]! > 0;
              let e = k + 1; while (e < px && s.run[e]! && Math.max(2, Math.round((s.run[e]! / Math.max(1, s.max)) * LANE)) === hh && (s.fail[e]! > 0) === f) e++;
              cols.push(<rect key={k} x={k} y={y0 + LANE - hh} width={Math.max(1, e - k)} height={hh} fill={f ? "#dc2626" : s.colour} opacity={0.85} />);
              k = e;
            }
            return <g key={s.n.addr}>{addr === s.n.addr && <rect x={0} y={y0 - 1} width={w} height={LANE + 2} fill="#2457e6" opacity={0.08} />}<line x1={0} x2={w} y1={y0 + LANE} y2={y0 + LANE} stroke="#e2e8f0" />{cols}</g>;
          })}
          {gauges.map((g, gi) => {
            const y0 = (steps.length + gi) * (LANE + GAP);
            const d = g.pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${(y0 + LANE - (p.v / g.max) * LANE).toFixed(1)}`).join(" ");
            const last = g.pts[g.pts.length - 1]!, first = g.pts[0]!;
            return <g key={g.k}><line x1={0} x2={w} y1={y0 + LANE} y2={y0 + LANE} stroke="#e2e8f0" />
              <path d={`${d} L${X(last.t).toFixed(1)},${y0 + LANE} L${X(first.t).toFixed(1)},${y0 + LANE} Z`} fill={g.colour} opacity={0.25} />
              <path d={d} fill="none" stroke={g.colour} strokeWidth={1} /></g>;
          })}
          {marks.map((l, mi) => {
            const y0 = (steps.length + gauges.length + mi) * (LANE + GAP);
            return <g key={l.id}><line x1={0} x2={w} y1={y0 + LANE} y2={y0 + LANE} stroke="#e2e8f0" />
              {l.items.slice(0, 5000).map((m, i) => {
                const x1 = X(m.t); const x2 = m.t2 != null ? Math.max(x1 + 1.5, X(m.t2)) : x1 + 1.5;
                const h = (m.tall ?? l.tall) ? LANE : LANE - 4;
                return <rect key={i} x={x1} y={y0 + LANE - h} width={x2 - x1} height={h} rx={0.5} fill={m.colour ?? l.colour} opacity={0.9}><title>{m.tip}</title></rect>;
              })}</g>;
          })}
          {Array.from({ length: 6 }, (_, i) => <text key={i} x={Math.min(w - 26, (i / 5) * w + 2)} y={H - 2} fill="#94a3b8" fontSize={8}>{`${((t1 - t0) * (i / 5)).toFixed(t1 - t0 < 5 ? 2 : 1)}s`}</text>)}
          <line x1={cursor} x2={cursor} y1={0} y2={H} stroke="#2457e6" strokeWidth={1.5} style={{ transition: "x1 80ms linear, x2 80ms linear" }} />
        </svg>
      </div>
    </div>
  );
}

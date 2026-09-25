import * as React from "react";
import { cn } from "../lib/cn";
import type { RunEvent } from "../lib/stages";

export type Lane = { id: string; label: string; colour: string };
/** a lane of MARKS (not stage runs): ticks at a moment, or bars over a span -- loops' rounds, pipeline stages,
 * background requests, scripts, DOM changes, errors */
export type Mark = { t: number; t2?: number; colour?: string; tip?: string; tall?: boolean };
export type MarkLane = { id: string; label: string; colour: string; marks: Mark[]; tip?: string };

export type ActivityLanesProps = {
  lanes: Lane[];
  events: RunEvent[];
  /** each event's stage (lane id), by index -- see `stagesLib.eventStages` */
  stageOf: (string | null)[];
  /** the event index the run is at (a cursor line there) */
  at: number;
  onSeek?: (index: number) => void;
  /** a lane selected (outlined) */
  selected?: string | null;
  onLane?: (id: string) => void;
  /** lanes of marks, after the stage lanes (see `Mark`) */
  extra?: MarkLane[];
  className?: string;
};

const LANE_H = 9, GAP = 2, LABEL_W = 140;

/** ACTIVITY LANES (a Gantt of the run): one lane per stage -- when it ran, for how many items at once
 * (each pixel of time shaded by how many of its items were running then: a fan-out shows as a band,
 * its height its parallelism; red where items failed) -- and a network lane (each page fetched, each
 * retry). Scales to any number of items (it draws pixels, not bars). A cursor at the run's moment;
 * click or drag to scrub. */
export function ActivityLanes({ lanes, events, stageOf, at, onSeek, selected, onLane, extra = [], className }: ActivityLanesProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(800);
  React.useLayoutEffect(() => { const el = box.current; if (!el) return; const f = () => setW(Math.max(200, el.clientWidth - LABEL_W - 8)); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, []);
  const ts = React.useMemo(() => events.map((e) => e.ts ?? 0), [events]);
  const t0 = ts.find((x) => x > 0) ?? 0; const t1 = Math.max(t0 + 0.001, ...ts.slice(-50));
  const x = (t: number) => ((t - t0) / (t1 - t0)) * w;

  // per lane: runs (item key -> [start, end, failed]) -> per-pixel concurrency
  const model = React.useMemo(() => {
    const runs = new Map<string, Map<string, [number, number, boolean]>>();
    const net: { t: number; kind: "fetch" | "retry" | "error" }[] = [];
    events.forEach((e, i) => {
      const t = e.ts ?? 0; if (!t) return;
      if (e.topic === "snapshot" || e.topic === "network.navigation") net.push({ t, kind: "fetch" });
      else if (e.topic === "loop" && e.phase === "round" && Number((e as { round?: number }).round ?? 1) > 1) net.push({ t, kind: "retry" });
      else if (e.topic === "error") net.push({ t, kind: "error" });
      const s = stageOf[i]; if (!s) return;
      const key = (e.item ?? []).join(".");
      let m = runs.get(s); if (!m) { m = new Map(); runs.set(s, m); }
      const r = m.get(key); const failed = e.topic === "error" && (e as { raised?: boolean }).raised !== false;
      if (!r) m.set(key, [t, t, failed]); else { r[1] = Math.max(r[1], t); r[2] = r[2] || failed; }
    });
    const px = Math.max(1, Math.round(w));
    const hist = new Map<string, { run: Float32Array; fail: Float32Array; n: number; max: number }>();
    for (const [s, m] of runs) {
      const run = new Float32Array(px), fail = new Float32Array(px);
      for (const [, [a, b, f]] of m) { const i0 = Math.max(0, Math.floor(x(a))), i1 = Math.min(px - 1, Math.max(i0, Math.floor(x(b)))); for (let k = i0; k <= i1; k++) { run[k]! += 1; if (f) fail[k]! += 1; } }
      let max = 0; for (let k = 0; k < px; k++) max = Math.max(max, run[k]!);
      hist.set(s, { run, fail, n: m.size, max });
    }
    return { hist, net, px };
  }, [events, stageOf, w, t0, t1]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = lanes.filter((l) => model.hist.has(l.id));
  const marks = extra.filter((l) => l.marks.length);
  const H = (shown.length + marks.length + 1) * (LANE_H + GAP) + 12;
  const cursor = at > 0 ? x(ts[Math.min(at, ts.length) - 1] ?? t0) : 0;
  const seekAtX = (px: number) => {
    if (!onSeek || !ts.length) return; const t = t0 + (Math.max(0, Math.min(w, px)) / w) * (t1 - t0);
    let lo = 0, hi = ts.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if ((ts[mid] ?? 0) < t) lo = mid + 1; else hi = mid; }
    onSeek(lo + 1);
  };
  const drag = React.useRef(false);
  const toX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left;

  return (
    <div ref={box} className={cn("relative overflow-y-auto overflow-x-hidden font-mono text-[9.5px]", className)}>
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_W }}>
          {shown.map((l) => (
            <button key={l.id} type="button" onClick={() => onLane?.(l.id)} className={cn("flex w-full items-center gap-1 truncate pr-1 text-left text-[8.5px] leading-none", selected === l.id ? "text-accent" : "text-muted hover:text-ink")} style={{ height: LANE_H, marginBottom: GAP }} title={`${l.label} · ${model.hist.get(l.id)!.n.toLocaleString()} item run(s) · up to ${model.hist.get(l.id)!.max} at once`}>
              <span className="size-2 shrink-0 rounded-sm" style={{ background: l.colour }} /><span className="truncate">{l.label}</span>
            </button>
          ))}
          {marks.map((l) => (
            <div key={l.id} className="flex w-full items-center gap-1 truncate pr-1 text-[8.5px] leading-none text-muted" style={{ height: LANE_H, marginBottom: GAP }} title={l.tip ?? `${l.label} · ${l.marks.length.toLocaleString()}`}>
              <span className="size-2 shrink-0 rounded-sm" style={{ background: l.colour }} /><span className="truncate">{l.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 pr-1 text-[8.5px] leading-none text-muted" style={{ height: LANE_H }}><span className="size-2 shrink-0 rounded-sm bg-slate-400" />page fetches</div>
        </div>
        <svg width={w} height={H} className="shrink-0 cursor-crosshair touch-none select-none"
          onPointerDown={(e) => { drag.current = true; (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId); seekAtX(toX(e)); }}
          onPointerMove={(e) => { if (drag.current) seekAtX(toX(e)); }} onPointerUp={() => { drag.current = false; }}>
          {shown.map((l, li) => {
            const hgt = model.hist.get(l.id)!; const y0 = li * (LANE_H + GAP);
            const cols: React.ReactNode[] = [];
            // run-length: consecutive pixels of the same height / state are one rect
            for (let k = 0; k < model.px;) {
              const c = hgt.run[k]!; if (!c) { k++; continue; }
              const hh = Math.max(2, Math.round((c / Math.max(1, hgt.max)) * LANE_H)); const f = hgt.fail[k]! > 0;
              let e = k + 1; while (e < model.px && hgt.run[e]! && Math.max(2, Math.round((hgt.run[e]! / Math.max(1, hgt.max)) * LANE_H)) === hh && (hgt.fail[e]! > 0) === f) e++;
              cols.push(<rect key={k} x={k} y={y0 + LANE_H - hh} width={e - k} height={hh} fill={f ? "#dc2626" : l.colour} opacity={0.85} />);
              k = e;
            }
            return <g key={l.id}>{selected === l.id && <rect x={0} y={y0 - 1} width={w} height={LANE_H + 2} fill="none" stroke="#2563eb" strokeWidth={1} />}<line x1={0} x2={w} y1={y0 + LANE_H} y2={y0 + LANE_H} stroke="#e2e8f0" />{cols}</g>;
          })}
          {/* mark lanes: bars over spans, ticks at moments (a <title> says what each is) */}
          {marks.map((l, mi) => {
            const y0 = (shown.length + mi) * (LANE_H + GAP);
            return <g key={l.id}><line x1={0} x2={w} y1={y0 + LANE_H} y2={y0 + LANE_H} stroke="#e2e8f0" />{l.marks.slice(0, 4000).map((m, i) => {
              const x1 = x(m.t); const x2 = m.t2 != null ? Math.max(x1 + 2, x(m.t2)) : x1 + (m.tall ? 2 : 1.5);
              const h = m.t2 != null ? LANE_H - 4 : m.tall ? LANE_H : LANE_H - 5;
              return <rect key={i} x={x1} y={y0 + (LANE_H - h)} width={x2 - x1} height={h} rx={m.t2 != null ? 2 : 0} fill={m.colour ?? l.colour} opacity={0.9}>{m.tip ? <title>{m.tip}</title> : null}</rect>;
            })}</g>;
          })}
          {/* network: a tick per page fetched; retries amber; errors red */}
          {(() => { const y0 = (shown.length + marks.length) * (LANE_H + GAP); return model.net.map((n, i) => <rect key={i} x={x(n.t)} y={y0 + (n.kind === "fetch" ? 3 : 0)} width={1} height={n.kind === "fetch" ? LANE_H - 3 : LANE_H} fill={n.kind === "retry" ? "#f59e0b" : n.kind === "error" ? "#dc2626" : "#94a3b8"} />); })()}
          {/* the time axis */}
          {Array.from({ length: 6 }, (_, i) => { const xx = (i / 5) * w; return <text key={i} x={Math.min(w - 24, xx + 2)} y={H - 2} fill="#94a3b8" fontSize={8}>{`${((t1 - t0) * (i / 5)).toFixed(1)}s`}</text>; })}
          <line x1={cursor} x2={cursor} y1={0} y2={H} stroke="#2563eb" strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  );
}

import * as React from "react";
import { cn } from "../../lib/cn";
import type { PlanModel } from "../../lib/run/plan";
import type { Lease, PoolAt } from "../../lib/run/pool";

export type PoolPanelProps = {
  /** the pool at the moment on screen */
  now: PoolAt;
  /** the pool over the whole run (its history strip) */
  whole: PoolAt;
  model: PlanModel | null;
  /** the moment's time (seconds, epoch) and the run's span */
  t: number; t0: number; t1: number;
  /** a slot clicked: go to the step + item that holds it, at the moment it took it */
  onPick?: (l: Lease) => void;
  className?: string;
};

const KIND_LABEL: Record<string, string> = { page: "browser pages", http: "http clients" };

/** CONCURRENCY: what the run holds of the engine's pool at the moment -- per kind, held against its limit and how
 * many are queued; per held browser page, the step (and item) that holds it, how long, and the page it rendered.
 * The strip under it is the whole run: held (solid) and queued (warm) against the limit, the moment marked. */
export function PoolPanel({ now, whole, model, t, t0, t1, onPick, className }: PoolPanelProps) {
  const kinds = ["page", "http"].filter((k) => whole.kinds.has(k)).map((k) => ({ now: now.kinds.get(k), whole: whole.kinds.get(k)!, kind: k }));
  if (!kinds.length) return <div className={cn("p-2 text-[10px] text-muted", className)}>no pool activity recorded (a run from before lease events)</div>;
  const stepLabel = (step?: string) => {
    if (!step) return "the run";
    const node = model?.byAddr.get(step); const col = /kw:([^/]+)/.exec(step)?.[1];
    return `${node?.op ?? step}${col ? ` · ${col}` : ""}`;
  };
  return (
    <div className={cn("flex min-h-0 flex-col gap-1 overflow-auto p-1 text-[10px]", className)} data-testid="pool">
      {kinds.map(({ kind, now: k, whole: w }) => {
        const limit = w.limit || k?.limit || 0; const held = now.held.filter((l) => l.kind === kind);
        const waiting = k?.waiting ?? 0; const maxQ = whole.maxWaiting.get(kind) ?? 0;
        const slots = kind === "page" ? Math.max(limit, held.length) : 0;
        return (
          <div key={kind} className="flex flex-col gap-0.5" data-testid={`pool-${kind}`}>
            <div className="flex items-center gap-1.5">
              <span className="w-[76px] shrink-0 font-semibold text-muted">{KIND_LABEL[kind] ?? kind}</span>
              <span className="font-mono" data-testid={`pool-${kind}-held`}>{held.length}/{limit || "?"} held</span>
              <span className={cn("rounded px-1 font-mono", waiting ? "bg-warn-soft text-warn" : "text-muted")} title="leases waiting for a free one right now">{waiting} queued</span>
              <span className="text-muted" title="over the whole run">· max {maxQ} queued · {whole.all.filter((l) => l.kind === kind).length} leases in all</span>
              <Strip hist={whole.history.get(kind) ?? []} limit={limit} t={t} t0={t0} t1={t1} />
            </div>
            {slots > 0 && (
              <div className="flex flex-wrap gap-1 pl-[82px]">
                {Array.from({ length: slots }, (_, s) => {
                  const l = held[s];
                  if (!l) return <span key={s} className="h-[30px] w-[150px] rounded border border-dashed border-line" title="a free page" />;
                  const age = Math.max(0, t - l.t);
                  return (
                    <button key={l.id} type="button" onClick={() => onPick?.(l)} data-testid="pool-slot"
                      className="flex h-[30px] w-[150px] flex-col justify-center rounded border border-accent/50 bg-accent-soft/50 px-1 text-left leading-[12px] hover:border-accent"
                      title={`${l.id} · held by ${stepLabel(l.step)}${l.item ? ` for item ${l.item}` : ""} · ${age.toFixed(1)}s${l.waited ? ` · queued ${l.waited.toFixed(2)}s first` : ""}${l.url ? `\n${l.url}` : ""}`}>
                      <span className="truncate font-mono"><b>{stepLabel(l.step)}</b>{l.item ? ` · #${l.item}` : ""}</span>
                      <span className="truncate text-muted">{age.toFixed(1)}s{l.url ? ` · ${l.url.replace(/^https?:\/\/[^/]+/, "")}` : " · opening…"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** held and queued over the run against the limit; the moment marked */
function Strip({ hist, limit, t, t0, t1 }: { hist: { t: number; held: number; waiting: number }[]; limit: number; t: number; t0: number; t1: number }) {
  const W = 220, H = 16; const span = Math.max(0.001, t1 - t0);
  const top = Math.max(1, limit, ...hist.map((h) => h.held + h.waiting));
  const x = (ts: number) => ((ts - t0) / span) * W; const y = (v: number) => H - (v / top) * H;
  const step = (key: "held" | "sum") => {
    let d = `M0,${H}`; let prev = 0;
    for (const h of hist) { const v = key === "held" ? h.held : h.held + h.waiting; d += ` L${x(h.t).toFixed(1)},${y(prev).toFixed(1)} L${x(h.t).toFixed(1)},${y(v).toFixed(1)}`; prev = v; }
    return `${d} L${W},${y(prev).toFixed(1)} L${W},${H} Z`;
  };
  if (!hist.length) return null;
  return (
    <svg width={W} height={H} className="ml-auto shrink-0 rounded-sm bg-surface-2" aria-label="held and queued over the run">
      <path d={step("sum")} className="fill-warn/50" />
      <path d={step("held")} className="fill-accent/60" />
      {limit > 0 && <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} className="stroke-muted" strokeDasharray="2 2" strokeWidth={0.8} />}
      <line x1={x(t)} x2={x(t)} y1={0} y2={H} className="stroke-ink" strokeWidth={1} />
    </svg>
  );
}

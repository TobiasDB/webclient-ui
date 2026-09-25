import * as React from "react";
import { cn } from "../../lib/cn";
import { CARD_H, CARD_W, layoutOf, type Layout } from "../../lib/run/layout";
import type { PlanModel } from "../../lib/run/plan";
import { expectedOf, type Inst, type ItemKey, type RunState } from "../../lib/run/state";
import { StepCard } from "./StepCard";

export type RunGraphProps = {
  model: PlanModel;
  state: RunState;
  /** the item on screen ("" = the root / none) and the step selected */
  item: ItemKey;
  addr?: string | null;
  onSelect?: (addr: string | null) => void;
  onPick?: (item: ItemKey) => void;
  rootUrl?: string;
  /** the step on screen: the view glides to keep it in sight */
  focus?: string | null;
  className?: string;
};

/** THE PLAN, MATERIALISING: every step of the plan at its fixed place (see `layoutOf`), each as the object it
 * made (`StepCard`). At t=0 it is the plan (dashed, "a page", "its matches"); as the run goes, cards fill with
 * what each step made for the item on screen, fan-outs fill with their items' cells, the edges into running
 * steps flow, and the columns flow into the table. Pan by dragging, zoom with the wheel. */
export function RunGraph({ model, state, item, addr, onSelect, onPick, rootUrl, focus, className }: RunGraphProps) {
  const L = React.useMemo(() => layoutOf(model), [model]);
  // a Collection's cells are ITS items: each item's state across the steps that run per item of it
  const itemsOf = React.useMemo(() => {
    const out = new Map<string, Map<ItemKey, Inst>>();
    for (const n of model.nodes) {
      if (!n.per) continue;
      const nr = state.nodes.get(n.addr); if (!nr) continue;
      let m = out.get(n.per); if (!m) { m = new Map(); out.set(n.per, m); }
      for (const inst of nr.insts.values()) {
        const k = inst.item;  // a step run per item of this collection is keyed by its items
        const cur = m.get(k);
        // an item is running while any of its steps is, failed once any failed, else done
        const st = !cur ? inst.state : cur.state === "failed" || inst.state === "failed" ? "failed" : cur.state === "running" || inst.state === "running" ? "running" : "done";
        m.set(k, { ...(cur ?? inst), item: k, state: st, last: Math.max(cur?.last ?? 0, inst.last) });
      }
    }
    return out;
  }, [model, state]);
  const fanTotal = (a: string) => { let t = 0, any = false; for (const [k, n] of state.fanN) if (k.startsWith(`${a}|`)) { t += n; any = true; } return any ? t : undefined; };
  const instFor = (a: string): Inst | undefined => {
    const nr = state.nodes.get(a); if (!nr) return undefined;
    const own = nr.insts.get(item); if (own) return own;
    for (const [k, v] of nr.insts) if (item && k.startsWith(`${item}.`)) return v;
    const parts = item ? item.split(".") : [];
    for (let i = parts.length - 1; i >= 0; i--) { const v = nr.insts.get(parts.slice(0, i).join(".")); if (v) return v; }
    return undefined;
  };
  const columns = model.columns.map((c) => c.name);

  // -- pan / zoom ------------------------------------------------------------------
  const box = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ k: 1, x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  // FIT: the whole plan when it is legible so; else legible (>= 0.62) and anchored left -- pan across the rest
  const fit = React.useCallback(() => {
    const el = box.current; if (!el) return;
    const whole = Math.min((el.clientWidth - 16) / L.width, (el.clientHeight - 16) / L.height);
    const k = Math.min(1.05, Math.max(0.62, whole, Math.min(1, (el.clientHeight - 16) / L.height) * (whole < 0.62 ? 1 : 0)));
    setView({ k, x: L.width * k < el.clientWidth ? (el.clientWidth - L.width * k) / 2 : 8, y: 8 });
  }, [L]);
  React.useLayoutEffect(() => { fit(); }, [fit]);
  const [glide, setGlide] = React.useState(false);
  // keep the step on screen in sight: glide there when it is out of view (not while the person drags)
  React.useEffect(() => {
    const el = box.current; const p = focus != null ? L.pos.get(focus) : undefined; if (!el || !p || drag.current) return;
    setView((v) => {
      const x0 = v.x + p.x * v.k, x1 = x0 + CARD_W * v.k, y0 = v.y + p.y * v.k, y1 = y0 + CARD_H * v.k;
      let { x, y } = v;
      if (x0 < 8) x += 8 - x0 + 40; else if (x1 > el.clientWidth - 8) x -= x1 - el.clientWidth + 8 + 40;
      if (y0 < 8) y += 8 - y0 + 20; else if (y1 > el.clientHeight - 8) y -= y1 - el.clientHeight + 8 + 20;
      if (x === v.x && y === v.y) return v;
      setGlide(true); setTimeout(() => setGlide(false), 320);
      return { ...v, x, y };
    });
  }, [focus, L]);
  React.useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey) {
        setView((v) => { const k = Math.min(2.5, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015))); return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }; });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel);
  }, []);

  return (
    <div ref={box} className={cn("relative h-full w-full touch-none select-none overflow-hidden bg-surface-2/60", className)}
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest(".wc-step")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
      onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) onSelect?.(null); }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: L.width, height: L.height, transition: glide ? "transform 300ms ease-out" : undefined }}>
        <Edges L={L} model={model} state={state} />
        {L.lanes.map((l) => { const p = L.pos.get(l.first); return p ? <div key={l.lane} className="absolute font-mono text-[10px] font-medium text-muted" style={{ left: p.x, top: p.y - 13 }}>{l.label}</div> : null; })}
        <StepCard node={null} item={item} active={false} selected={addr === ""} rootUrl={rootUrl} onSelect={() => onSelect?.("")}
          style={{ left: L.pos.get("")!.x, top: L.pos.get("")!.y, width: CARD_W, height: CARD_H }} />
        {model.nodes.map((n) => {
          const p = L.pos.get(n.addr); if (!p) return null;
          const nr = state.nodes.get(n.addr); const inst = instFor(n.addr);
          const docId = inst?.result?.document_id ?? undefined;
          return (
            <StepCard key={n.addr} node={n} run={nr} expected={n.per ? expectedOf(state, model, n.addr) : undefined} item={item} inst={inst}
              doc={docId ? state.docs.get(docId) : undefined}
              items={n.type === "Collection" ? itemsOf.get(n.addr) : undefined} itemsExpected={n.type === "Collection" ? fanTotal(n.addr) : undefined}
              parallel={state.parallel.get(n.addr) ?? [...state.parallel.entries()].find(([k]) => model.byAddr.get(k)?.per === n.addr)?.[1]}
              active={(nr?.running ?? 0) > 0} selected={addr === n.addr}
              rowsCount={n.op === "project" || n.op === "merge" ? state.rows.length : undefined} columns={n.op === "project" || n.op === "merge" ? columns : undefined}
              onSelect={() => onSelect?.(n.addr)} onPick={onPick}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }} />
          );
        })}
      </div>
      <div className="absolute bottom-1.5 right-1.5 flex gap-1 rounded border border-line bg-surface/90 p-0.5 text-[10px] shadow-sm">
        <button type="button" className="rounded px-1.5 hover:bg-surface-2" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}>−</button>
        <button type="button" className="rounded px-1.5 hover:bg-surface-2" onClick={fit}>fit</button>
        <button type="button" className="rounded px-1.5 hover:bg-surface-2" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>+</button>
      </div>
    </div>
  );
}

function Edges({ L, model, state }: { L: Layout; model: PlanModel; state: RunState }) {
  const path = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2; const dx = Math.max(24, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={L.width} height={L.height}>
      <defs><marker id="wc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" /></marker></defs>
      {L.edges.map((e) => {
        const a = L.pos.get(e.from), b = L.pos.get(e.to); if (!a || !b) return null;
        const nr = state.nodes.get(e.to); const ran = !!nr?.insts.size; const active = (nr?.running ?? 0) > 0; const failed = (nr?.failed ?? 0) > 0;
        return <g key={`${e.from}>${e.to}`}>
          <path d={path(a, b)} fill="none" stroke={failed ? "#dc2626" : ran ? "#64748b" : "#cbd5e1"} strokeWidth={ran ? 1.6 : 1.2} strokeDasharray={ran ? undefined : "4 3"} markerEnd="url(#wc-arrow)" style={{ transition: "stroke 200ms" }} />
          {active && <path d={path(a, b)} fill="none" stroke="#2457e6" strokeWidth={2.4} className="wc-edge-flow" />}
        </g>;
      })}
      {L.outputs.map((o) => {
        const a = L.pos.get(o.from), b = L.pos.get(o.to); if (!a || !b) return null;
        const filled = !!state.nodes.get(o.from)?.done;
        return <path key={`${o.from}>${o.to}`} d={path(a, b)} fill="none" stroke={filled ? "#0f172a" : "#cbd5e1"} strokeOpacity={filled ? 0.55 : 1} strokeWidth={1.2} strokeDasharray="2 3" markerEnd="url(#wc-arrow)" />;
      })}
      {void model}
    </svg>
  );
}

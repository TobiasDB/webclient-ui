import * as React from "react";
import { cn } from "../../lib/cn";
import type { Inst, ItemKey } from "../../lib/run/state";

export type ItemStripProps = {
  /** this step's runs, by item */
  insts: Map<ItemKey, Inst> | undefined;
  /** how many items it will run for (the fan-out's count), when known */
  expected?: number;
  selected?: ItemKey | null;
  onPick?: (item: ItemKey) => void;
  /** above this many cells: one density bar instead */
  max?: number;
  className?: string;
};

const TONE = { done: "bg-ok", failed: "bg-bad", running: "bg-accent wc-cell-run", pending: "bg-surface-3" } as const;

/** THE ITEMS of a step: a cell per item (done / failed / running / not yet), grouped by the item they belong to
 * when nested (a record's table rows), the selected one ringed. At scale, a density bar with the same colours.
 * Click a cell to pick its item. */
export function ItemStrip({ insts, expected, selected, onPick, max = 160, className }: ItemStripProps) {
  const all = React.useMemo(() => [...(insts?.values() ?? [])].sort((a, b) => cmp(a.item, b.item)), [insts]);
  const count = Math.max(expected ?? 0, all.length);
  if (!count) return null;
  const tally = { done: 0, failed: 0, running: 0 };
  for (const i of all) tally[i.state]++;
  const pending = Math.max(0, count - all.length);
  if (count > max) {
    const pct = (n: number) => `${(n / count) * 100}%`;
    const selIndex = selected != null ? all.findIndex((i) => i.item === selected || i.item.startsWith(`${selected}.`)) : -1;
    return (
      <div className={cn("relative h-2 w-full overflow-hidden rounded-sm bg-surface-3", className)} title={`${tally.done} done · ${tally.failed} failed · ${tally.running} running · ${pending} to go`}>
        <div className="absolute inset-y-0 left-0 flex w-full">
          <div className="h-full bg-ok transition-[width] duration-200" style={{ width: pct(tally.done) }} />
          <div className="h-full bg-bad transition-[width] duration-200" style={{ width: pct(tally.failed) }} />
          <div className="wc-cell-run h-full bg-accent transition-[width] duration-200" style={{ width: pct(tally.running) }} />
        </div>
        {selIndex >= 0 && <div className="absolute inset-y-[-1px] w-[2px] bg-ink" style={{ left: pct(selIndex) }} />}
      </div>
    );
  }
  // groups: by the parent item (all but the last index) -- one group when the step runs once per top item
  const groups = new Map<string, Inst[]>();
  for (const i of all) { const g = i.item.includes(".") ? i.item.slice(0, i.item.lastIndexOf(".")) : ""; (groups.get(g) ?? groups.set(g, []).get(g)!).push(i); }
  const nested = groups.size > 1 || (groups.size === 1 && !groups.has(""));
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-[3px]", className)}>
      {[...groups.entries()].map(([g, items]) => (
        <span key={g} className={cn("inline-flex flex-wrap gap-[2px]", nested && "rounded-sm px-[2px] ring-1 ring-line", nested && selected != null && (selected === g || selected.startsWith(`${g}.`)) && "ring-ink/60")}>
          {items.map((i) => <Cell key={i.item} inst={i} sel={selected === i.item} onPick={onPick} />)}
        </span>
      ))}
      {!nested && pending > 0 && Array.from({ length: Math.min(pending, max - all.length) }, (_, k) => <span key={`p${k}`} className={cn("size-[7px] rounded-[1.5px]", TONE.pending)} />)}
    </div>
  );
}

function Cell({ inst, sel, onPick }: { inst: Inst; sel: boolean; onPick?: (item: ItemKey) => void }) {
  const title = `item ${inst.item}${inst.result?.preview !== undefined ? ` · ${short(inst.result.preview)}` : ""}${inst.result?.error ? ` · ${inst.result.error}` : ""}${inst.t1 ? ` · ${((inst.t1 - inst.t0) * 1000).toFixed(0)} ms` : ""}`;
  return <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onPick?.(inst.item); }}
    className={cn("size-[7px] rounded-[1.5px] transition-colors duration-200", TONE[inst.state], sel && "outline outline-[1.5px] outline-offset-1 outline-ink")} />;
}

const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };
const cmp = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; };

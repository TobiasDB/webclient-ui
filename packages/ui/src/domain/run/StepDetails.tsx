import * as React from "react";
import { ACTION_COLOUR, actionOf } from "../../lib/stages";
import type { PNode } from "../../lib/run/plan";
import type { DocRun, Inst, ItemKey, NodeRun } from "../../lib/run/state";

export type StepDetailsProps = {
  node: PNode;
  run?: NodeRun;
  expected?: number;
  /** the item on screen and its run of this step */
  item: ItemKey;
  inst?: Inst;
  doc?: DocRun;
  outputs?: string[];
  /** what it runs once for (the fan-out's label) */
  perLabel?: string;
  onPick?: (item: ItemKey) => void;
  onClose: () => void;
};

/** A STEP, IN DETAIL (a card clicked): what it is, what it runs for, how its runs went (done / failed / running of
 * how many, how long), what it made for the item on screen, the columns it fills, and its failures (click one: go
 * to its item). */
export function StepDetails({ node, run, expected, item, inst, doc, outputs, perLabel, onPick, onClose }: StepDetailsProps) {
  const insts = [...(run?.insts.values() ?? [])];
  const ms = insts.filter((i) => i.t1 != null).map((i) => (i.t1! - i.t0) * 1000).sort((a, b) => a - b);
  const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]! : 0);
  const failed = insts.filter((i) => i.state === "failed");
  const res = inst?.result;
  const colour = ACTION_COLOUR[actionOf(node.op)];
  const row = (k: string, v: React.ReactNode) => <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{k}</span><span className="min-w-0 break-words [overflow-wrap:anywhere]">{v}</span></div>;
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 z-20 flex max-h-[70%] w-[340px] flex-col overflow-hidden rounded-lg border border-line bg-surface text-[11px] shadow-xl" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1" style={{ background: `color-mix(in srgb, ${colour} 10%, transparent)` }}>
        <span className="size-2 rounded-full" style={{ background: colour }} />
        <span className="min-w-0 flex-1 truncate font-mono font-semibold" title={node.label}>{node.label}</span>
        <button type="button" className="rounded px-1 text-muted hover:text-ink" onClick={onClose} title="close">✕</button>
      </div>
      <div className="flex min-h-0 flex-col gap-1 overflow-auto p-2 font-mono text-[10.5px]">
        {row("step", <>{node.addr} <span className="text-muted">· makes {node.type === "Collection" ? "a list" : `a ${node.type}`}</span></>)}
        {row("runs", node.per ? <>once for each item of <b>{perLabel ?? node.per}</b></> : "once")}
        {row("done", <>{run?.done ?? 0}{expected != null ? ` of ${expected}` : ""}{run?.running ? <span className="text-accent"> · {run.running} running</span> : null}{failed.length ? <span className="text-bad"> · {failed.length} failed</span> : null}</>)}
        {ms.length > 0 && row("took", `${Math.round(pct(0.5))} ms typical · ${Math.round(pct(0.95))} ms p95 · ${Math.round(ms[ms.length - 1]!)} ms max`)}
        {outputs && outputs.length > 0 && row("output", outputs.map((o) => <span key={o} className="mr-1 rounded-full bg-ink px-1.5 text-surface">→ {o}</span>))}
        <div className="my-1 border-t border-line" />
        {row((inst?.item ?? item) ? `item ${inst?.item ?? item}` : "result", res ? (res.ok === false ? <span className="text-bad">✕ {res.error}{res.message ? ` — ${res.message}` : ""}</span>
          : res.kind === "Collection" ? `${res.n} ${String(res.of ?? "item").toLowerCase()}${res.n === 1 ? "" : "s"}`
          : res.kind === "Document" ? <>{doc?.url ?? res.url}{doc?.status ? ` · ${doc.status}` : ""}{doc?.tier ? ` · ${doc.tier}` : ""}</>
          : res.kind === "Reference" ? res.url ?? String(res.preview ?? "")
          : res.kind === "Element" ? "the element"
          : JSON.stringify(res.preview)) : inst ? <span className="text-accent">running…</span> : <span className="text-muted">not run for it (yet)</span>)}
        {inst?.t1 != null && row("", <span className="text-muted">{Math.round((inst.t1 - inst.t0) * 1000)} ms</span>)}
        {failed.length > 0 && <>
          <div className="my-1 border-t border-line" />
          <div className="text-muted">failures</div>
          {failed.slice(0, 8).map((f) => (
            <button key={f.item} type="button" className="text-left text-bad hover:underline" onClick={() => onPick?.(f.item)} title="show this item">item {f.item || "—"}: {f.result?.error}{f.result?.message ? ` — ${f.result.message.slice(0, 80)}` : ""}</button>
          ))}
          {failed.length > 8 && <span className="text-muted">+{failed.length - 8} more</span>}
        </>}
      </div>
    </div>
  );
}

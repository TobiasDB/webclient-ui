import * as React from "react";
import { cn } from "../../lib/cn";
import { ACTION_COLOUR, actionOf } from "../../lib/stages";
import type { PNode } from "../../lib/run/plan";
import type { DocRun, Inst, ItemKey, NodeRun } from "../../lib/run/state";
import { ItemStrip } from "./ItemStrip";

export const TYPE_COLOUR: Record<string, string> = { Reference: "#64748b", Document: "#2563eb", Element: "#0891b2", Collection: "#7c3aed", Value: "#16a34a", Rows: "#0f172a", Row: "#0f172a" };

export type StepCardProps = {
  /** the step (null: the plan's root object, the Reference it starts from) */
  node: PNode | null;
  run?: NodeRun;
  expected?: number;
  /** the item on screen: its run of this step is what the card shows */
  item: ItemKey;
  /** the run of this step for that item (or the one it belongs to) */
  inst?: Inst;
  /** the page it is / is on (for that item) */
  doc?: DocRun;
  /** items of the collection this step fans out to (a Collection's cells are its items) */
  items?: Map<ItemKey, Inst>;
  itemsExpected?: number;
  parallel?: { n: number; limit: number; bound: string };
  /** running now (at the cursor) */
  active: boolean;
  selected: boolean;
  rootUrl?: string;
  rowsCount?: number;
  columns?: string[];
  /** the output columns this step fills: marked on the card */
  outputs?: string[];
  onSelect?: () => void;
  onPick?: (item: ItemKey) => void;
  style?: React.CSSProperties;
};

/** ONE STEP of the plan, as the OBJECT it produced (the Author graph's grammar: the op on top, the object below).
 * Before it runs it is the plan (dashed, faint); running, it pulses; done, it shows what it made for the item
 * on screen -- the page (host/path, status, tier), the element, the N items (cells), the value read -- and how
 * many items it has run for. Failed items turn it red. */
export function StepCard({ node, run, expected, item, inst, doc, items, itemsExpected, parallel, active, selected, rootUrl, rowsCount, columns, outputs, onSelect, onPick, style }: StepCardProps) {
  const type = node ? node.type : "Reference";
  const colour = node ? ACTION_COLOUR[actionOf(node.op)] : TYPE_COLOUR.Reference!;
  const ran = !node || !!run?.insts.size;
  const failed = run?.failed ?? 0;
  const perItem = !!node?.per;
  const total = expected ?? run?.insts.size ?? 0;
  const res = inst?.result;
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(); }} style={style}
      className={cn("wc-step absolute flex flex-col overflow-visible rounded-md border bg-surface text-[10.5px] leading-tight shadow-sm outline-none transition-[opacity,box-shadow,border-color] duration-200",
        ran ? "opacity-100" : "border-dashed opacity-60",
        failed ? "border-bad" : selected ? "border-accent" : "border-line-2",
        selected && "ring-2 ring-accent/40", active && "wc-step-active")}>
      {/* the op */}
      <div className="flex min-w-0 items-center gap-1 border-b border-line px-1.5 py-[3px]" style={{ background: `color-mix(in srgb, ${colour} 10%, transparent)` }}>
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: colour }} />
        <span className="min-w-0 truncate font-mono font-medium text-ink" title={node?.label ?? rootUrl}>{node ? node.label : "Reference"}</span>
        <span className="flex-1" />
        {perItem && total > 0 && <span className="shrink-0 font-mono text-[9.5px] text-muted" title="items run / expected">{(run?.done ?? 0) + failed}/{total}</span>}
        {failed > 0 && <span className="shrink-0 rounded bg-bad px-1 font-mono text-[9px] text-white" title={`${failed} item(s) failed`}>{failed}✕</span>}
      </div>
      {outputs && outputs.length > 0 && (
        <div className="absolute -right-1 -top-2 flex max-w-[90%] gap-0.5" title="an OUTPUT of the plan: this step's value fills these columns of every row">
          {outputs.map((o) => <span key={o} className="truncate rounded-full bg-ink px-1.5 font-mono text-[9px] leading-[15px] text-surface shadow">→ {o}</span>)}
        </div>
      )}
      {/* the object it made */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-1.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 rounded px-1 text-[9px] font-semibold tracking-wide text-white" style={{ background: TYPE_COLOUR[type] ?? "#64748b" }} title={type === "Collection" ? `a list of ${memberOf(node, res)}s` : undefined}>{type === "Rows" ? "TABLE" : type === "Collection" ? `${memberOf(node, res).toUpperCase()}[]` : type.toUpperCase()}</span>
          <ObjectLine type={type} node={node} res={res} doc={doc} rootUrl={rootUrl} rowsCount={rowsCount} ran={ran} />
        </div>
        {type === "Collection" && items != null && (
          <div className="flex min-w-0 items-center gap-1">
            <ItemStrip insts={items} expected={itemsExpected} selected={item || null} onPick={onPick} max={84} className="min-w-0 flex-1" />
          </div>
        )}
        {type !== "Collection" && perItem && run && <ItemStrip insts={run.insts} expected={expected} selected={item || null} onPick={onPick} max={84} />}
        {type === "Collection" && parallel && parallel.limit > 1 && <span className="font-mono text-[9px] text-muted" title={`up to ${parallel.limit} run at once (bound by the ${parallel.bound} pool)`}>×{parallel.limit} at once · {parallel.bound}</span>}
        {(type === "Rows" || type === "Row") && columns && <div className="flex flex-wrap gap-1">{columns.map((c) => <span key={c} className="rounded bg-surface-2 px-1 font-mono text-[9.5px]">{c}</span>)}</div>}
        {type === "Document" && doc && doc.actions.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1" title="what was done on this page">
            {doc.actions.slice(-3).map((a) => <span key={a.i} className="max-w-full truncate rounded bg-[#fff1e6] px-1 font-mono text-[9px] text-[#c2410c]">{a.action}{a.selector ? ` ${a.selector}` : ""}</span>)}
            {doc.actions.length > 3 && <span className="text-[9px] text-muted">+{doc.actions.length - 3}</span>}
          </div>
        )}
        {res && res.ok === false && <span className="truncate font-mono text-[9.5px] text-bad" title={res.message ?? res.error}>✕ {res.error}{res.message ? ` · ${res.message}` : ""}</span>}
      </div>
    </div>
  );
}

function ObjectLine({ type, node, res, doc, rootUrl, rowsCount, ran }: { type: string; node: PNode | null; res?: Inst["result"]; doc?: DocRun; rootUrl?: string; rowsCount?: number; ran: boolean }) {
  const muted = "min-w-0 truncate text-muted";
  if (!node) return <span className={cn(muted, "font-mono")} title={rootUrl}>{shortUrl(rootUrl)}</span>;
  if (!ran) return <span className={muted} title={node.per ? "runs once for each item of the fan-out it follows" : undefined}>{node.per ? `${EXPECT_EACH[type] ?? EXPECT[type] ?? ""}, for each` : EXPECT[type] ?? ""}</span>;
  if (type === "Document") {
    const url = doc?.url ?? res?.url;
    return <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate font-mono" title={url}>{shortUrl(url)}</span>
      {doc?.status != null && <span className={cn("shrink-0 font-mono text-[9px]", doc.status >= 400 ? "text-bad" : "text-ok")}>{doc.status}</span>}
      {doc?.tier && <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] text-muted">{doc.tier}</span>}
    </span>;
  }
  if (type === "Collection") { const m = memberOf(node, res).toLowerCase(); return <span className={muted}>{res?.n != null ? `${res.n.toLocaleString()} ${m}${res.n === 1 ? "" : "s"}` : "…"}</span>; }
  if (type === "Reference" && res?.url) return <span className="min-w-0 truncate rounded bg-surface-2 px-1 font-mono text-ink" title={res.url}>{res.url.replace(/^https?:\/\/[^/]+/, "") || res.url}</span>;
  if (type === "Value" || type === "Reference") return <span className="min-w-0 truncate rounded bg-ok-soft px-1 font-mono text-ink" title={String(res?.preview ?? "")}>{res?.preview !== undefined ? fmt(res.preview) : "…"}</span>;
  if (type === "Element") return <span className={muted}>{res ? "the element" : "…"}</span>;
  if (type === "Rows" || type === "Row") return <span className={muted}>{rowsCount != null ? `${rowsCount.toLocaleString()} row${rowsCount === 1 ? "" : "s"}` : ""}</span>;
  return null;
}

/** what a collection holds: what the step says (the package's result), else what the op gives (select_all:
 * elements -- parts of the page; paginate: pages; links: links) */
function memberOf(node: PNode | null, res?: Inst["result"]): string {
  if (res?.of) return res.of;
  return node?.op === "paginate" ? "Document" : node?.op === "links" ? "Reference" : node?.op === "extract" ? "Row" : "Element";
}

const EXPECT_EACH: Record<string, string> = { Document: "its page", Element: "its element", Value: "its value", Reference: "its link", Collection: "its matches" };
const EXPECT: Record<string, string> = { Document: "a page", Collection: "a list of its matches", Element: "an element", Value: "a value", Reference: "a link", Rows: "rows", Row: "a row" };
const shortUrl = (u?: string) => (u ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "") || "—";
const fmt = (v: unknown) => { const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v); return s && s.length > 48 ? `${s.slice(0, 45)}…` : s; };

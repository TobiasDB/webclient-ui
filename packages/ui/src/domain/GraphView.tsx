import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { children, lit, removeNode, setMod, updateNode, type GNode, type Graph, type NodeType } from "../lib/graph";
import { fieldColour } from "./Player";

export type GraphViewProps = {
  graph: Graph;
  selected: string;
  onSelect: (id: string) => void;
  onChange?: (g: Graph) => void;
  /** a short sample of each node's value on its page (×20, “A Light in…”, page) */
  samples?: Record<string, string>;
  /** page nodes held live */
  live?: Set<string>;
  readOnly?: boolean;
  className?: string;
};

export const TYPE_COLOUR: Record<NodeType, string> = { Reference: "#64748b", Document: "#2563eb", Element: "#0891b2", Collection: "#7c3aed", Value: "#16a34a" };
const TYPE_SHORT: Record<NodeType, string> = { Reference: "REF", Document: "DOC", Element: "EL", Collection: "EACH", Value: "VAL" };

/** The builder's GRAPH: the objects as nodes (Reference → Document → Element / Collection →
 * Value), each made by an op of its parent's surface. Click a node: it is the scope -- its page
 * opens and new ops hang off it. Name a node to make its value an OUTPUT column (or name it
 * from the page). Pages carry their pager, collections their limit. Edit the op's argument in
 * place; × removes the node and what hangs off it. */
export function GraphView({ graph, selected, onSelect, onChange, samples = {}, live, readOnly, className }: GraphViewProps) {
  const outs = Object.values(graph.nodes).filter((n) => n.output || n.alias).map((n) => n.id);
  const render = (n: GNode, depth: number): React.ReactNode => (
    <li key={n.id}>
      <NodeRow n={n} graph={graph} depth={depth} selected={selected === n.id} onSelect={() => onSelect(n.id)} onChange={readOnly ? undefined : onChange} sample={samples[n.id]} live={!!live?.has(n.id)} colour={outs.includes(n.id) ? fieldColour(outs.indexOf(n.id)) : undefined} />
      {children(graph, n.id).length > 0 && <ul className="ml-3 border-l border-line pl-1">{children(graph, n.id).map((c) => render(c, depth + 1))}</ul>}
    </li>
  );
  return <ul className={cn("wc-graph flex flex-col gap-0.5 text-[12px]", className)}>{render(graph.nodes[graph.root]!, 0)}</ul>;
}

function NodeRow({ n, graph, selected, onSelect, onChange, sample, live, colour }: { n: GNode; graph: Graph; depth: number; selected: boolean; onSelect: () => void; onChange?: (g: Graph) => void; sample?: string; live: boolean; colour?: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const a0 = n.op?.args[0];
  const editable = !!onChange && !!n.op && a0 && !a0.plan && ["select", "select_all", "attr", "write", "click", "wait_for", "scroll", "limit"].includes(n.op.name);
  const setArg = (value: string) => onChange?.(updateNode(graph, n.id, { op: { ...n.op!, args: n.op!.args.map((a, i) => (i === 0 ? lit(value) : a)) } }));
  const isPage = n.type === "Document" && n.op?.name === "resolve";
  const pager = n.mods?.find((m) => m.name === "paginate"); const limit = n.mods?.find((m) => m.name === "limit");
  return (
    <div className={cn("group flex cursor-pointer flex-wrap items-center gap-1 rounded border px-1 py-0.5", selected ? "border-accent bg-accent-soft" : "border-transparent hover:border-line")} onClick={(e) => { stop(e); onSelect(); }} style={colour ? { boxShadow: `inset 3px 0 0 ${colour}` } : undefined}>
      <span className="shrink-0 rounded px-1 font-mono text-[9px] font-semibold text-white" style={{ background: TYPE_COLOUR[n.type] }} title={n.type}>{TYPE_SHORT[n.type]}</span>
      {!n.op ? <span className="truncate font-mono text-[11px]" title={graph.url}>{graph.url || "the URL"}</span> : <>
        <span className="font-mono text-[11px] text-ink-2">{n.op.name === "resolve" ? "open" : n.op.name}</span>
        {editable ? <input className="h-5 max-w-full rounded border border-line bg-surface px-1 font-mono text-[10px]" size={Math.max(4, Math.min(30, String(a0!.value ?? "").length + 1))} value={String(a0!.value ?? "")} onChange={(e) => setArg(e.target.value)} onClick={stop} title={String(a0!.value ?? "")} />
          : a0 && !a0.plan ? <code className="truncate font-mono text-[10px] text-muted">{String(a0.value)}</code> : null}
        {n.op.name === "resolve" && <span className="text-[10px] text-muted">{n.op.kwargs.browser?.value === true ? "browser" : n.op.kwargs.browser?.value === "auto" ? "auto" : "static"}</span>}
      </>}
      {live && <span className="rounded bg-ok-soft px-1 text-[9px] text-ok">live</span>}
      {sample && <span className="max-w-[140px] truncate rounded bg-surface-2 px-1 font-mono text-[10px] text-muted" title={sample}>{sample}</span>}
      {isPage && pager && <span className="rounded bg-topic-network/10 px-1 text-[10px] text-topic-network" title="pages">pages · {pager.kwargs.next?.value ? "next link" : String(pager.kwargs.by?.value ?? "rel=next")} ×{String(pager.kwargs.max_pages?.value ?? 20)}{onChange && <button type="button" className="ml-0.5" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "paginate")); }}>×</button>}</span>}
      {limit && <span className="rounded bg-surface-2 px-1 text-[10px]">first {String(limit.args[0]?.value)}{onChange && <button type="button" className="ml-0.5" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "limit")); }}>×</button>}</span>}
      <span className="flex-1" />
      {(n.output !== undefined || n.alias) ? (
        n.alias ? <span className="rounded px-1 text-[10px] text-white" style={{ background: colour }} title="the column's name is read off the page">→ name from page</span>
          : <span className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-white" style={{ background: colour }}>→<input className="h-4 w-20 bg-transparent text-[10px] text-white outline-none" value={n.output} onChange={(e) => onChange?.(updateNode(graph, n.id, { output: e.target.value }))} onClick={stop} readOnly={!onChange} /></span>
      ) : onChange && n.op && <button type="button" className="hidden rounded border border-line px-1 text-[10px] text-muted group-hover:inline hover:text-ink" onClick={(e) => { stop(e); onChange(updateNode(graph, n.id, { output: suggest(n) })); }} title="make this node's value an output column">+ output</button>}
      {onChange && n.op && <button type="button" className="text-muted opacity-0 group-hover:opacity-100 hover:text-bad" onClick={(e) => { stop(e); onChange(removeNode(graph, n.id)); }} title="remove this node and what hangs off it"><X size={11} /></button>}
    </div>
  );
}
function suggest(n: GNode): string {
  if (n.op?.name === "resolve") return "detail";
  const a = String(n.op?.args[0]?.value ?? n.op?.name ?? "field"); const leaf = a.split(/\s*[> ~+]\s*/).filter(Boolean).pop() ?? a;
  const m = /[.#]([a-zA-Z0-9_-]+)/.exec(leaf); return (m?.[1] ?? leaf).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

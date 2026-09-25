import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { children, lit, removeNode, setMod, updateNode, type GNode, type Graph, type NodeType } from "../lib/graph";
import { fieldColour } from "./Player";

export type Edge = { label: string; hint?: string; onAdd: () => void; tone?: "io" | "data" };
export type GraphViewProps = {
  graph: Graph;
  selected: string;
  onSelect: (id: string) => void;
  onChange?: (g: Graph) => void;
  /** a short sample of each node's value on its page (×20, “A Light in…”) */
  samples?: Record<string, string>;
  /** page nodes held live */
  live?: Set<string>;
  /** the edges the FOCUSED node offers (the ops of its object's surface) */
  edges?: Edge[];
  /** the focused node's own argument is being picked (its input is rendered) */
  editing?: boolean;
  onEditArg?: (id: string) => void;
  readOnly?: boolean;
  className?: string;
};

export const TYPE_COLOUR: Record<NodeType, string> = { Reference: "#64748b", Document: "#2563eb", Element: "#0891b2", Collection: "#7c3aed", Value: "#16a34a" };
const SELECTOR_OPS = new Set(["select", "select_all", "click", "write", "wait_for"]);
export const needsArg = (n: GNode) => !!n.op && (SELECTOR_OPS.has(n.op.name) || n.op.name === "attr") && !String(n.op.args[0]?.value ?? "").trim();

/** The graph as a LITERAL PLAN: `Reference("…")`, then each object's ops indented under it --
 * `.resolve()`, `.select_all("li")`, `.select("h3 a")`, `.attr("title") → title` -- one line per
 * object, typed. Click a line: it is the FOCUS (the page renders it; new selectors root there)
 * and its edges -- the ops of its surface -- appear under it. Arguments edit in place; an empty
 * one waits for a shift-click on the page or a suggestion. */
export function GraphView({ graph, selected, onSelect, onChange, samples = {}, live, edges = [], editing, onEditArg, readOnly, className }: GraphViewProps) {
  const outs = Object.values(graph.nodes).filter((n) => n.output || n.alias).map((n) => n.id);
  // a CHAIN (one child after another) reads on one level, like a method chain; only a BRANCH indents
  const line = (n: GNode) => <Line key={n.id} n={n} graph={graph} selected={selected === n.id} editing={selected === n.id && !!editing} onSelect={() => onSelect(n.id)} onChange={readOnly ? undefined : onChange} onEditArg={onEditArg} sample={samples[n.id]} live={!!live?.has(n.id)} colour={outs.includes(n.id) ? fieldColour(outs.indexOf(n.id)) : undefined} />;
  const render = (n: GNode): React.ReactNode => {
    const run: GNode[] = [n]; let kids = children(graph, n.id);
    while (kids.length === 1) { run.push(kids[0]!); kids = children(graph, kids[0]!.id); }
    return (
      <li key={n.id}>
        {run.map(line)}
        {kids.length > 0 && <ul className="ml-1.5 border-l border-line/60 pl-1 [&>li+li]:mt-px [&>li+li]:border-t [&>li+li]:border-dashed [&>li+li]:border-line/60">{kids.map(render)}</ul>}
      </li>
    );
  };
  return <ul className={cn("wc-graph flex flex-col font-mono text-[10.5px] leading-[18px]", className)}>{render(graph.nodes[graph.root]!)}</ul>;
}

function Line({ n, graph, selected, editing, onSelect, onChange, onEditArg, sample, live, colour }: { n: GNode; graph: Graph; selected: boolean; editing: boolean; onSelect: () => void; onChange?: (g: Graph) => void; onEditArg?: (id: string) => void; sample?: string; live: boolean; colour?: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const setArg = (i: number, value: unknown) => onChange?.(updateNode(graph, n.id, { op: { ...n.op!, args: n.op!.args.map((a, j) => (j === i ? lit(value) : a)) } }));
  const missing = needsArg(n);
  const pager = n.mods?.find((m) => m.name === "paginate"); const limit = n.mods?.find((m) => m.name === "limit");
  const kw = n.op ? Object.entries(n.op.kwargs) : [];
  return (
    <div className={cn("group flex cursor-pointer items-center gap-x-1 overflow-hidden whitespace-nowrap rounded px-1 py-px", selected ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2", missing && "ring-1 ring-bad/50")} onClick={(e) => { stop(e); onSelect(); }} title={n.output ? `output: ${n.output}` : n.alias ? "output (named from the page / a column)" : undefined}>
      {!n.op ? <span className="min-w-0 truncate">Reference(<Str v={graph.url} onChange={onChange ? (v) => onChange({ ...graph, url: v }) : undefined} />)</span> : <span className="min-w-0 truncate rounded-sm px-0.5" style={colour ? { boxShadow: `inset 0 0 0 1px ${colour}`, background: `${colour}14` } : undefined}>
        .{n.op.name}(
        {n.op.args.map((a, i) => <React.Fragment key={i}>{i > 0 && ", "}{a.plan ? "…" : typeof a.value === "string" ? <Str v={a.value} placeholder={missing && i === 0 ? "click the page" : i === 1 && n.op!.name === "attr" ? "pattern" : ""} bad={missing && i === 0} editing={editing && i === 0} onFocus={() => onEditArg?.(n.id)} onChange={onChange ? (v) => setArg(i, v) : undefined} /> : a.value && typeof a.value === "object" ? <button type="button" className="text-topic-network underline decoration-dotted" title="edit (JSON)" onClick={(e) => { stop(e); const t = window.prompt("the mapping, as JSON", JSON.stringify(a.value)); if (t) { try { setArg(i, JSON.parse(t)); } catch { window.alert("not JSON"); } } }}>{JSON.stringify(a.value).slice(0, 40)}</button> : <span className="text-topic-network">{JSON.stringify(a.value)}</span>}</React.Fragment>)}
        {n.op.name === "attr" && n.op.args.length < 2 && onChange && <button type="button" className="hidden text-[10px] text-muted group-hover:inline hover:text-accent" onClick={(e) => { stop(e); onChange(updateNode(graph, n.id, { op: { ...n.op!, args: [...n.op!.args, lit("(\\d+)")] } })); }} title="read the value through a regex (its first group)">, +pattern</button>}
        {kw.map(([k, a], i) => <span key={k}>{n.op!.args.length || i ? ", " : ""}<span className="text-muted">{k}=</span><span className="text-topic-network">{a.plan ? "…" : JSON.stringify(a.value)}</span></span>)}
        )
      </span>}
      {pager && <span className="text-topic-network">.paginate({pager.kwargs.next?.value ? `next="${String(pager.kwargs.next.value)}", ` : ""}max_pages={String(pager.kwargs.max_pages?.value ?? 20)}){onChange && <button type="button" className="ml-0.5 text-muted hover:text-bad" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "paginate")); }}>×</button>}</span>}
      {limit && <span className="text-topic-network">.limit({String(limit.args[0]?.value)}){onChange && <button type="button" className="ml-0.5 text-muted hover:text-bad" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "limit")); }}>×</button>}</span>}
      <span className="flex-1" />
      {live && <span className="rounded bg-ok-soft px-1 font-sans text-[9px] text-ok">live</span>}
      {sample && <span className="max-w-[80px] truncate text-[9.5px] text-muted" title={sample}>{sample}</span>}
      {onChange && n.op && <button type="button" className="text-muted opacity-0 group-hover:opacity-100 hover:text-bad" onClick={(e) => { stop(e); onChange(removeNode(graph, n.id)); }} title="remove this and what hangs off it"><X size={11} /></button>}
    </div>
  );
}
function Str({ v, onChange, placeholder, bad, editing, onFocus }: { v: string; onChange?: (v: string) => void; placeholder?: string; bad?: boolean; editing?: boolean; onFocus?: () => void }) {
  if (!onChange) return <span className="text-ok">"{v}"</span>;
  return <span className={cn(bad ? "text-bad" : "text-ok")}>"<input className={cn("bg-transparent outline-none", editing && "rounded bg-warn-soft")} size={Math.max(2, Math.min(30, (v || placeholder || "").length + 1))} style={{ fieldSizing: "content", maxWidth: "26ch" } as React.CSSProperties} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()} onFocus={onFocus} title={v} />"</span>;
}
/** a default output name for a node (from its selector / attribute) */
export function outputName(n: GNode): string {
  if (n.op?.name === "resolve") return "detail";
  if (n.op?.name === "attr") return String(n.op.args[0]?.value ?? "value").replace(/[^a-z0-9]+/gi, "_");
  const a = String(n.op?.args[0]?.value ?? n.op?.name ?? "field"); const leaf = a.split(/\s*[> ~+]\s*/).filter(Boolean).pop() ?? a;
  const m = /[.#]([a-zA-Z0-9_-]+)/.exec(leaf); return (m?.[1] ?? leaf).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

import * as React from "react";
import type { Problem } from "../lib/check";
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
  /** what the plan check found on a line (it matches nothing, reads nothing, was not checked) */
  problems?: Record<string, Problem>;
  /** a keyword argument clicked: edit the op's parameters */
  onEditParams?: (id: string) => void;
  readOnly?: boolean;
  className?: string;
};

export const TYPE_COLOUR: Record<NodeType, string> = { Reference: "#64748b", Document: "#2563eb", Element: "#0891b2", Collection: "#7c3aed", Value: "#16a34a" };
const SELECTOR_OPS = new Set(["select", "select_all", "click", "write", "wait_for"]);
/** a plan line's problem: `error` (it would fail: matches nothing), `warn` (reads nothing), `info` (not checked) */
export type { Problem } from "../lib/check";
export const needsArg = (n: GNode) => !!n.op && (SELECTOR_OPS.has(n.op.name) || n.op.name === "attr") && !String(n.op.args[0]?.value ?? "").trim();

/** The graph as a LITERAL PLAN: `Reference("…")`, then each object's ops indented under it --
 * `.resolve()`, `.select_all("li")`, `.select("h3 a")`, `.attr("title") → title` -- one line per
 * object, typed. Click a line: it is the FOCUS (the page renders it; new selectors root there)
 * and its edges -- the ops of its surface -- appear under it. Arguments edit in place; an empty
 * one waits for a shift-click on the page or a suggestion. */
export function GraphView({ graph, selected, onSelect, onChange, samples = {}, live, edges = [], editing, onEditArg, onEditParams, problems = {}, readOnly, className }: GraphViewProps) {
  const outs = Object.values(graph.nodes).filter((n) => n.output || n.alias).map((n) => n.id);
  // a CHAIN (one child after another) reads on one level, like a method chain; only a BRANCH indents
  const line = (n: GNode) => <Line key={n.id} n={n} graph={graph} selected={selected === n.id} editing={selected === n.id && !!editing} onSelect={() => onSelect(n.id)} onChange={readOnly ? undefined : onChange} onEditArg={onEditArg} onEditParams={onEditParams} problem={problems[n.id]} sample={samples[n.id]} live={!!live?.has(n.id)} colour={outs.includes(n.id) ? fieldColour(outs.indexOf(n.id)) : undefined} />;
  const [folded, setFolded] = React.useState<Set<string>>(new Set());
  const count = (id: string): number => children(graph, id).reduce((a, c) => a + 1 + count(c.id), 0);
  const render = (n: GNode): React.ReactNode => {
    const run: GNode[] = [n]; let kids = children(graph, n.id);
    while (kids.length === 1) { run.push(kids[0]!); kids = children(graph, kids[0]!.id); }
    const last = run[run.length - 1]!; const shut = folded.has(last.id);
    const toggle = () => setFolded((f) => { const nx = new Set(f); nx.has(last.id) ? nx.delete(last.id) : nx.add(last.id); return nx; });
    return (
      <li key={n.id}>
        {run.map((x) => (x === last && kids.length > 0 ? <div key={x.id} className="flex items-center"><button type="button" className="w-2.5 shrink-0 text-[9px] leading-none text-muted hover:text-ink" onClick={toggle} title={shut ? "expand" : "collapse"}>{shut ? "▸" : "▾"}</button><div className="min-w-0 flex-1">{line(x)}</div>{shut && <span className="shrink-0 px-0.5 text-[9px] text-muted">+{count(last.id)}</span>}</div> : line(x)))}
        {kids.length > 0 && !shut && <ul className="ml-1 border-l border-line/60 pl-0.5 [&>li+li]:border-t [&>li+li]:border-dashed [&>li+li]:border-line/50">{kids.map(render)}</ul>}
      </li>
    );
  };
  return <ul className={cn("wc-graph flex flex-col font-mono text-[10px] leading-[15px]", className)}>{render(graph.nodes[graph.root]!)}</ul>;
}

function Line({ n, graph, selected, editing, onSelect, onChange, onEditArg, onEditParams, problem, sample, live, colour }: { n: GNode; graph: Graph; selected: boolean; editing: boolean; onSelect: () => void; onChange?: (g: Graph) => void; onEditArg?: (id: string) => void; onEditParams?: (id: string) => void; problem?: Problem; sample?: string; live: boolean; colour?: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const setArg = (i: number, value: unknown) => onChange?.(updateNode(graph, n.id, { op: { ...n.op!, args: n.op!.args.map((a, j) => (j === i ? lit(value) : a)) } }));
  const missing = needsArg(n);
  const pager = n.mods?.find((m) => m.name === "paginate"); const limit = n.mods?.find((m) => m.name === "limit");
  const kw = n.op ? Object.entries(n.op.kwargs) : [];
  return (
    <div className={cn("group flex cursor-pointer items-center gap-x-1 overflow-hidden whitespace-nowrap rounded-sm px-0.5", selected ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2", missing && "ring-1 ring-bad/50")} onClick={(e) => { stop(e); onSelect(); }} title={n.output ? `output: ${n.output}` : n.alias ? "output (named from the page / a column)" : undefined}>
      {!n.op ? <span className="min-w-0 truncate">Reference(<Str v={graph.url} max={40} />)</span> : <span className="min-w-0 truncate rounded-sm px-0.5" style={colour ? { boxShadow: `inset 0 0 0 1px ${colour}`, background: `${colour}14` } : undefined}>
        .{n.op.name}(
        {n.op.args.map((a, i) => <React.Fragment key={i}>{i > 0 && ", "}{a.plan ? "…" : typeof a.value === "string" ? <Str v={a.value} placeholder={missing && i === 0 ? "click the page" : ""} bad={missing && i === 0} editing={editing && i === 0} onEdit={onChange && onEditArg ? () => onEditArg(n.id) : undefined} /> : a.value && typeof a.value === "object" ? <button type="button" className="text-topic-network underline decoration-dotted" title="edit (JSON)" onClick={(e) => { stop(e); const t = window.prompt("the mapping, as JSON", JSON.stringify(a.value)); if (t) { try { setArg(i, JSON.parse(t)); } catch { window.alert("not JSON"); } } }}>{JSON.stringify(a.value).slice(0, 40)}</button> : <span className="text-topic-network">{JSON.stringify(a.value)}</span>}</React.Fragment>)}
        {n.op.name === "attr" && n.op.args.length < 2 && onChange && <button type="button" className="hidden text-[10px] text-muted group-hover:inline hover:text-accent" onClick={(e) => { stop(e); onChange(updateNode(graph, n.id, { op: { ...n.op!, args: [...n.op!.args, lit("(\\d+)")] } })); }} title="read the value through a regex (its first group)">, +pattern</button>}
        {kw.filter(([k]) => k !== "optional").map(([k, a], i) => <span key={k} className={cn(onEditParams && "cursor-pointer rounded-sm hover:bg-accent-soft")} title={onEditParams ? "edit the parameters" : undefined} onClick={onEditParams ? (e) => { stop(e); onEditParams(n.id); } : undefined}>{n.op!.args.length || i ? ", " : ""}<span className="text-muted">{k}=</span><span className="text-topic-network">{a.plan ? "…" : JSON.stringify(a.value)}</span></span>)}
        {onEditParams && <button type="button" className="hidden px-0.5 text-[9px] text-muted group-hover:inline hover:text-accent" onClick={(e) => { stop(e); onEditParams(n.id); }} title="edit the parameters">⚙</button>}
        )
      </span>}
      {pager && <span className="text-topic-network">.paginate({pager.kwargs.next?.value ? `next="${String(pager.kwargs.next.value)}", ` : ""}max_pages={String(pager.kwargs.max_pages?.value ?? 20)}){onChange && <button type="button" className="ml-0.5 text-muted hover:text-bad" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "paginate")); }}>×</button>}</span>}
      {limit && <span className="text-topic-network">.limit({String(limit.args[0]?.value)}){onChange && <button type="button" className="ml-0.5 text-muted hover:text-bad" onClick={(e) => { stop(e); onChange(setMod(graph, n.id, null, "limit")); }}>×</button>}</span>}
      <span className="flex-1" />
      {problem && <span className={cn("shrink-0 rounded-sm px-0.5 font-sans text-[9px]", problem.level === "error" ? "bg-bad-soft text-bad" : problem.level === "warn" ? "bg-warn-soft text-warn" : "text-muted")} title={problem.message}>{problem.level === "error" ? "✕" : problem.level === "warn" ? "!" : "?"} {problem.short}</span>}
      {live && <span className="rounded bg-ok-soft px-1 font-sans text-[9px] text-ok">live</span>}
      {sample && (() => {
        // a select under a collection: "4/5" of the records have it -- red when not all do and it is not optional (the run would fail); click toggles optional
        const m = /^(\d+)\/(\d+)$/.exec(sample); const opt = !!n.op?.kwargs.optional?.value;
        if (m && n.op?.name === "select") { const partial = m[1] !== m[2]; return <button type="button" className={cn("shrink-0 rounded-sm px-0.5 text-[9px]", partial && !opt ? "bg-bad-soft text-bad" : "text-muted hover:text-ink")} title={`${m[1]} of ${m[2]} records have it${opt ? " — optional (a missing one reads null)" : partial ? " — click to make it optional (else the run fails on the others)" : ""}`} onClick={(e) => { stop(e); if (!onChange || !n.op) return; const kw = { ...n.op.kwargs }; if (opt) delete kw.optional; else kw.optional = lit(true); onChange(updateNode(graph, n.id, { op: { ...n.op, kwargs: kw } })); }}>{sample}{opt ? " opt" : ""}</button>; }
        return <span className="max-w-[70px] truncate text-[9px] text-muted" title={sample}>{sample}</span>;
      })()}
      {onChange && n.op && <button type="button" className="text-muted opacity-0 group-hover:opacity-100 hover:text-bad" onClick={(e) => { stop(e); onChange(removeNode(graph, n.id)); }} title="remove this and what hangs off it"><X size={11} /></button>}
    </div>
  );
}
/** An argument as TEXT: truncated to fit, the whole value on hover; a click opens it for
 * editing in the selector panel (where it is picked, suggested or typed). */
function Str({ v, placeholder, bad, editing, onEdit, max = 22 }: { v: string; placeholder?: string; bad?: boolean; editing?: boolean; onEdit?: () => void; max?: number }) {
  const shown = v ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : placeholder ?? "";
  return <span className={cn(bad ? "text-bad" : "text-ok", onEdit && "cursor-text rounded-sm hover:bg-accent-soft hover:text-accent", editing && "bg-warn-soft")} title={v ? `${v}${onEdit ? " — click to edit" : ""}` : placeholder} onClick={onEdit ? (e) => { e.stopPropagation(); onEdit(); } : undefined}>"{shown}"</span>;
}
/** a default output name for a node (from its selector / attribute) */
export function outputName(n: GNode): string {
  if (n.op?.name === "resolve") return "detail";
  if (n.op?.name === "attr") return String(n.op.args[0]?.value ?? "value").replace(/[^a-z0-9]+/gi, "_");
  const a = String(n.op?.args[0]?.value ?? n.op?.name ?? "field"); const leaf = a.split(/\s*[> ~+]\s*/).filter(Boolean).pop() ?? a;
  const m = /[.#]([a-zA-Z0-9_-]+)/.exec(leaf); return (m?.[1] ?? leaf).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

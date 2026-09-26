/** The BUILDER GRAPH: the objects of the package as nodes, the ops of their surfaces as edges.
 *
 * A node is an object -- a Reference, a Document (a page, static or live), an Element (what a
 * `select` gave), a Collection (what a `select_all` / `links` / `paginate` gave: its children
 * run on EACH element), or a Value (text, a count, an href). An edge is the op that made it,
 * applied to its parent. The graph is a tree rooted at the Reference of the URL you start from.
 *
 * OUTPUTS are marked on nodes (a column name, or a name read off the page: `alias`). The
 * graph COMPILES to the plan IR the service runs: the path down to where the outputs branch
 * is the chain; a node whose children carry several outputs becomes an `extract` of those
 * columns (per element when it is a Collection → rows); a single deep output flattens into
 * its column. A plan DECOMPILES back into a graph, so a saved / imported / traced plan opens
 * in the builder. */

import { calls, mapValue, pyRegex, toNumber, toWhen, type Arg, type Plan, type Step } from "./plan";

export type NodeType = "Reference" | "Document" | "Element" | "Collection" | "Value";
export type Op = { name: string; args: Arg[]; kwargs: Record<string, Arg> };
/** a modifier on a node: an op that shapes it in place (paginate on a page; limit / filter on a collection) */
export type Mod = Op;
export type GNode = {
  id: string;
  parent: string | null;
  /** the op that made this node from its parent (none on the root) */
  op?: Op;
  type: NodeType;
  mods?: Mod[];
  /** this node's value is an output column: its name */
  output?: string;
  /** …or its name is read off the enclosing element: these steps (relative to it) give the name */
  alias?: Step[];
  /** a nested output (a page's dict, a collection's rows / merged dict): merge its keys into the parent row */
  flatten?: boolean;
  /** a branch FORKED AWAY from: kept (switch back to it), but not part of the plan */
  off?: boolean;
};
export type Graph = { url: string; root: string; nodes: Record<string, GNode> };
export type OpReturns = Record<string, string>;  // op name -> "Document" | "Collection" | "Value" | "Reference" | "Value|Reference"

let seq = 0;
export const newId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;
export const lit = (v: unknown): Arg => ({ value: v });
export const opOf = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Op => ({ name, args: args.map(lit), kwargs: Object.fromEntries(Object.entries(kwargs).filter(([, x]) => x !== undefined).map(([k, x]) => [k, lit(x)])) });
const v = (a: Arg | undefined) => a?.value;
const RESOLVABLE = new Set(["href", "src", "action"]);

export function emptyGraph(url: string): Graph { const id = "root"; return { url, root: id, nodes: { [id]: { id, parent: null, type: "Reference" } } }; }
export const children = (g: Graph, id: string): GNode[] => Object.values(g.nodes).filter((n) => n.parent === id);
export function ancestors(g: Graph, id: string): GNode[] { const out: GNode[] = []; let n: GNode | undefined = g.nodes[id]; while (n) { out.unshift(n); n = n.parent ? g.nodes[n.parent] : undefined; } return out; }
export function subtree(g: Graph, id: string): string[] { const out = [id]; for (const c of children(g, id)) out.push(...subtree(g, c.id)); return out; }
/** the node's nearest Document ancestor (itself when a page): the page its view shows */
export function pageOf(g: Graph, id: string): GNode | null { for (const n of ancestors(g, id).reverse()) if (n.type === "Document" && n.op?.name === "resolve") return n; return null; }
/** is `id` evaluated once per element of some Collection ancestor (below the page)? */
export function eachOf(g: Graph, id: string): GNode | null { const path = ancestors(g, id); const page = pageOf(g, id); const from = page ? path.findIndex((n) => n.id === page.id) : 0; for (let i = path.length - 2; i >= from; i--) if (path[i]!.type === "Collection") return path[i]!; return null; }

/** The type an op yields from a parent of `parent` type (the catalogue's `returns` decides; a few rules refine it). */
export function typeAfter(parent: NodeType, op: Op, returns: OpReturns = {}): NodeType {
  const n = op.name;
  if (parent === "Reference") return n === "resolve" ? "Document" : "Reference";
  if (n === "select") return "Element";
  if (n === "select_all" || n === "links" || n === "paginate") return "Collection";
  if (n === "attr") return RESOLVABLE.has(String(v(op.args[0]))) ? "Reference" : "Value";
  if (n === "resolve") return "Document";
  if (n === "number" || n === "map" || n === "date" || n === "datetime") return "Value";
  if (n === "link") return "Reference";  // a URL written as text, made a link (resolvable)
  if (["click", "write", "scroll", "wait_for", "goto", "reload"].includes(n)) return parent === "Element" ? "Element" : "Document";
  const r = returns[n] ?? "Value";
  if (r === "Document") return parent === "Element" ? "Element" : "Document";
  if (r === "Collection") return "Collection";
  if (r === "Reference") return "Reference";
  return "Value";
}

export function addNode(g: Graph, parent: string, op: Op, returns?: OpReturns, extra: Partial<GNode> = {}): { graph: Graph; id: string } {
  // the same op under the same parent is the same object: reuse it
  const same = children(g, parent).find((c) => c.op && JSON.stringify(c.op) === JSON.stringify(op));
  if (same) return { graph: extra.output || extra.alias ? updateNode(g, same.id, extra) : g, id: same.id };
  const id = newId(); const p = g.nodes[parent]!;
  return { graph: { ...g, nodes: { ...g.nodes, [id]: { id, parent, op, type: typeAfter(p.type, op, returns), ...extra } } }, id };
}
export function updateNode(g: Graph, id: string, patch: Partial<GNode>): Graph { return { ...g, nodes: { ...g.nodes, [id]: { ...g.nodes[id]!, ...patch } } }; }
export function removeNode(g: Graph, id: string): Graph { if (id === g.root) return g; const drop = new Set(subtree(g, id)); return { ...g, nodes: Object.fromEntries(Object.entries(g.nodes).filter(([k]) => !drop.has(k))) }; }
export function setMod(g: Graph, id: string, mod: Mod | null, name?: string): Graph { const n = g.nodes[id]!; const others = (n.mods ?? []).filter((m) => m.name !== (mod?.name ?? name)); return updateNode(g, id, { mods: mod ? [...others, mod] : others }); }
export function outputs(g: Graph): GNode[] { return Object.values(g.nodes).filter((n) => (n.output || n.alias) && !isOff(g, n.id)); }
/** whether a node sits on a branch forked away from (it or an ancestor is `off`) */
export function isOff(g: Graph, id: string): boolean { let n: GNode | undefined = g.nodes[id]; while (n) { if (n.off) return true; n = n.parent ? g.nodes[n.parent] : undefined; } return false; }
/** the page ACTIONS: each one is a step of its page -- a state with its own snapshot */
export const ACTIONS = new Set(["click", "write", "scroll", "wait_for", "hover", "press", "select_option", "goto"]);
/** the STATE a node is evaluated on: the nearest page (resolve) or action at or above it */
export function stateOf(g: Graph, id: string): GNode | null { for (const n of ancestors(g, id).reverse()) { if (n.op && (n.op.name === "resolve" || ACTIONS.has(n.op.name))) return n; } return null; }
/** a page's STEPS: the page, then its chain of actions (the active branch), in order */
export function stepsOfPage(g: Graph, pageId: string): GNode[] {
  const out: GNode[] = []; let cur: GNode | undefined = g.nodes[pageId];
  while (cur) { out.push(cur); cur = children(g, cur.id).find((c) => !c.off && c.op && ACTIONS.has(c.op.name)); }
  return out;
}
/** evaluate a node on the snapshot of its STATE (the page, or the page after its last action) */
export function evalAt(g: Graph, id: string, stateDoc: Document | null): unknown {
  if (!stateDoc) return undefined;
  const st = stateOf(g, id); if (!st) return undefined; if (st.id === id) return stateDoc;
  const path = ancestors(g, id); const from = path.findIndex((n) => n.id === st.id);
  let cur: unknown = stateDoc;
  for (const n of path.slice(from + 1)) { if (!n.op) continue; cur = applyOp(cur, n.op); for (const m of n.mods ?? []) if (m.name === "limit") cur = applyOp(cur, m); if (cur === undefined) return undefined; }
  return cur;
}

// -- compile: graph -> plan IR -------------------------------------------------------------
const get = (name: string): Step => ({ kind: "get", name });
const callStep = (op: Op): Step => ({ kind: "call", name: op.name, args: op.args, kwargs: op.kwargs });
const stepsOf = (n: GNode): Step[] => [...(n.op ? [get(n.op.name), callStep(n.op)] : []), ...(n.mods ?? []).flatMap((m) => [get(m.name), callStep(m)])];
const bearing = (g: Graph, id: string): boolean => { const n = g.nodes[id]!; if (n.off) return false; return !!(n.output || n.alias) || children(g, id).some((c) => bearing(g, c.id)); };
type Col = { name: string; alias?: Step[]; steps: Step[]; flatten?: boolean };
const autoName = (n: GNode) => { const a = String(v(n.op?.args[0]) ?? n.op?.name ?? "field"); const leaf = a.split(/\s*[> ~+]\s*/).filter(Boolean).pop() ?? a; const m = /[.#]([a-zA-Z0-9_-]+)/.exec(leaf); return (m?.[1] ?? leaf.replace(/[^a-z0-9]+/gi, "_")).toLowerCase().replace(/^_+|_+$/g, "") || "field"; };

/** The columns a node's output-bearing children make (relative to the node's value). */
function colsOf(g: Graph, id: string): Col[] {
  const out: Col[] = [];
  for (const c of children(g, id)) {
    if (!bearing(g, c.id)) continue;
    const inner = children(g, c.id).some((x) => bearing(g, x.id)) ? colsOf(g, c.id) : [];
    const own = stepsOf(c);
    if (!inner.length) { out.push({ name: c.output ?? autoName(c), alias: c.alias, steps: [...own, ...(c.type === "Collection" && c.op?.name === "select_all" ? [get("attr"), callStep(opOf("attr", ["text"]))] : [])] }); continue; }
    // a value / a link read cannot hold columns (no extract on a Reference): its own output is a
    // column, and what hangs off it (a page it opens) is the parent's columns beside it
    if (c.type === "Reference" || c.type === "Value") { if (c.output || c.alias) out.push({ name: c.output ?? autoName(c), alias: c.alias, steps: own }); for (const x of inner) out.push({ ...x, steps: [...own, ...x.steps] }); continue; }
    // an element: its outputs are the parent's columns (the select is cheap to repeat)
    if (!c.output && !c.alias && c.type === "Element") { for (const x of inner) out.push({ ...x, steps: [...own, ...x.steps] }); continue; }
    // a page crossed (resolve) or a collection: ONE nested column (a dict / a list of rows), so the page is fetched once
    out.push({ name: c.output ?? (c.type === "Document" ? "detail" : autoName(c)), alias: c.alias, flatten: c.flatten, steps: [...own, ...wrap(c.type, inner)] });
  }
  return out;
}
/** extract(columns) + its terminal: rows (project), or one dict when every column is named from the page over a collection (merge) */
function wrap(type: NodeType, cols: Col[]): Step[] {
  const args: Arg[] = []; const kwargs: Record<string, Arg> = {}; const taken = new Set<string>();
  for (const c of cols) {
    if (c.alias) args.push({ plan: { root: "Document", steps: [...c.steps, get("alias"), { kind: "call", name: "alias", args: [{ plan: { root: "Document", steps: c.alias } }], kwargs: {} }] } });
    else { let nm = c.name; let i = 2; while (taken.has(nm)) nm = `${c.name}_${i++}`; taken.add(nm); kwargs[nm] = { plan: { root: "Document", steps: c.steps } }; }
  }
  // one dict when, over a collection, every column is aliased (a named one spent as a name counts)
  const spent = new Set(cols.map((c) => (c.alias && c.alias.length === 2 && c.alias[0]!.name === "field" ? String(c.alias[1]!.args?.[0]?.value ?? "") : "")).filter(Boolean));
  const term = type === "Collection" && args.length && Object.keys(kwargs).every((k) => spent.has(k)) ? "merge" : "project";
  const flat = term === "project" ? cols.filter((c) => c.flatten && !c.alias).map((c) => c.name) : [];
  return [get("extract"), { kind: "call", name: "extract", args, kwargs }, get(term), { kind: "call", name: term, args: [], kwargs: flat.length ? { flatten: { value: flat } } : {} }];
}

/** The plan the graph means. `upTo` compiles only the path to that node (a preview of one object). */
export function compile(g: Graph, upTo?: string): Plan {
  if (upTo) return { root: "Reference", steps: ancestors(g, upTo).flatMap(stepsOf) };
  const steps: Step[] = [];
  let n = g.nodes[g.root]!;
  steps.push(...stepsOf(n));
  for (;;) {
    const kids = children(g, n.id).filter((c) => bearing(g, c.id));
    if (!kids.length) break;
    // the spine continues while there is ONE way on and nothing is output here: resolve, actions, pages, the records
    const k = kids[0]!;
    if (kids.length === 1 && !n.output && !k.output && !k.alias && n.type !== "Collection" && (k.type === "Document" || k.type === "Collection") && children(g, k.id).some((x) => bearing(g, x.id))) { n = k; steps.push(...stepsOf(n)); continue; }
    steps.push(...wrap(n.type, colsOf(g, n.id)));
    break;
  }
  return { root: "Reference", steps };
}

// -- decompile: plan IR -> graph -------------------------------------------------------------
const MODS: Record<string, NodeType[]> = { paginate: ["Document"], limit: ["Collection"], filter: ["Collection"] };
/** Rebuild a graph from a plan (the reverse of compile, for plans the builder or a person wrote). */
export function decompile(p: Plan, url: string, returns: OpReturns = {}): Graph {
  let g = emptyGraph(url);
  const walk = (steps: Step[], from: string, output?: { name?: string; alias?: Step[] }) => {
    const cs = calls({ root: "Document", steps }); let cur = from;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!; const node = g.nodes[cur]!;
      if (c.name === "project" || c.name === "merge") {
        const fl = c.kwargs.flatten?.value; const names = Array.isArray(fl) ? fl.map(String) : [];
        if (names.length) for (const id of subtree(g, cur)) { const nn = g.nodes[id]!; if (nn.output && names.includes(nn.output)) g = updateNode(g, id, { flatten: true }); }
        continue;
      }
      if (c.name === "alias") continue;
      if (MODS[c.name]?.includes(node.type)) { g = setMod(g, cur, { name: c.name, args: c.args, kwargs: c.kwargs }); continue; }
      if (c.name === "extract") {
        if (output && cur !== from) g = updateNode(g, cur, output.alias ? { alias: output.alias } : { output: output.name });  // a nested column: this node is its name
        for (const a of c.args) if (a.plan) { const ac = calls(a.plan); const al = ac.find((x) => x.name === "alias"); const aliasPlan = al?.args[0]; walk(a.plan.steps.slice(0, al ? al.index : a.plan.steps.length), cur, { alias: aliasPlan?.plan?.steps, name: typeof aliasPlan?.value === "string" ? aliasPlan.value : undefined }); }
        for (const [k, a] of Object.entries(c.kwargs)) {
          if (!a.plan) continue;  // a literal column: skipped
          const al = calls(a.plan).find((x) => x.name === "alias");
          if (al) { const ap = al.args[0]; walk(a.plan.steps.slice(0, al.index), cur, { alias: ap?.plan?.steps, name: typeof ap?.value === "string" ? ap.value : undefined }); }
          else walk(a.plan.steps, cur, { name: k });
        }
        const pj = cs[i + 1]; const fl = pj?.name === "project" ? pj.kwargs.flatten?.value : undefined;  // project(flatten=[…]) after it
        if (Array.isArray(fl)) for (const id of subtree(g, cur)) { const nn = g.nodes[id]!; if (nn.output && fl.map(String).includes(nn.output) && nn.parent !== null) g = updateNode(g, id, { flatten: true }); }
        return;
      }
      const r = addNode(g, cur, { name: c.name, args: c.args, kwargs: c.kwargs }, returns); g = r.graph; cur = r.id;
    }
    if (output && cur !== from) g = updateNode(g, cur, output.alias ? { alias: output.alias } : { output: output.name });
  };
  walk(p.steps, g.root);
  return g;
}

// -- local evaluation: a node's value on the rebuilt page ------------------------------------
// the page lives in an iframe (another realm), where an instance check against this window's
// Element is false: test the node type instead
export const isEl = (x: unknown): x is Element => !!x && typeof x === "object" && (x as Node).nodeType === 1;
export const isDoc = (x: unknown): x is Document => !!x && typeof x === "object" && (x as Node).nodeType === 9;
const textOf = (el: Element) => (el.textContent || "").trim();
export function attrOf(el: Element, name: string, pattern?: string): unknown {
  let val: unknown = name === "text" ? textOf(el) : name === "text:own" ? [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent?.trim()).join(" ").trim()
    : name === "html" ? el.innerHTML : name === "count" ? el.children.length : el.getAttribute(name);
  if (pattern && typeof val === "string") { try { const m = pyRegex(pattern).exec(val); val = m ? (m[1] ?? m[0]) : null; } catch { /* keep */ } }
  return val;
}
/** Apply one op to a value locally (fanning out over a list); IO ops stop (undefined). */
function applyOp(cur: unknown, op: Op): unknown {
  if (Array.isArray(cur) && !["limit", "count"].includes(op.name)) return cur.map((x) => applyOp(x, op));
  const a0 = v(op.args[0]);
  if (op.name === "number") return toNumber(cur, v(op.args[0]) ?? null);
  if (op.name === "date" || op.name === "datetime") return toWhen(cur, { dayfirst: !!v(op.kwargs.dayfirst), time: op.name === "datetime" });
  if (op.name === "map") return mapValue(cur, (a0 ?? {}) as Record<string, unknown>, v(op.args[1]) ?? null);
  if (op.name === "link") { if (cur == null || cur === "") return null; try { return new URL(String(cur).trim(), typeof a0 === "string" ? a0 : undefined).href; } catch { return String(cur).trim(); } }
  if (cur == null) return null;
  if (op.name === "limit") return Array.isArray(cur) ? cur.slice(0, Number(a0)) : cur;
  if (op.name === "count") return Array.isArray(cur) ? cur.length : isEl(cur) ? cur.children.length : 0;
  if (!isEl(cur) && !isDoc(cur)) return undefined;
  const el = isEl(cur) ? cur : (cur as Document).body;
  try {
    if (op.name === "select") return el.querySelector(String(a0));
    if (op.name === "select_all") { const all = [...el.querySelectorAll(String(a0))]; const lim = v(op.kwargs.limit); return typeof lim === "number" ? all.slice(0, lim) : all; }
    if (op.name === "links") return [...el.querySelectorAll("a[href]")].map((x) => x.getAttribute("href"));
  } catch { return null; }
  if (op.name === "attr") return attrOf(el, String(a0), v(op.args[1]) as string | undefined);
  if (op.name === "text") return textOf(el);
  if (op.name === "html") return el.innerHTML;
  if (["click", "write", "scroll", "wait_for"].includes(op.name)) return el;  // on a capture: the page as it is
  return undefined;
}
/** The node's value evaluated on its page (`doc` = the Document of pageOf(node)); undefined past an IO hop. */
export function evalNode(g: Graph, id: string, doc: Document | null): unknown {
  if (!doc) return undefined;
  const page = pageOf(g, id); if (!page) return undefined;
  const path = ancestors(g, id); const from = path.findIndex((n) => n.id === page.id);
  let cur: unknown = doc;
  for (const n of path.slice(from + 1)) { if (!n.op) continue; cur = applyOp(cur, n.op); for (const m of n.mods ?? []) if (m.name === "limit") cur = applyOp(cur, m); if (cur === undefined) return undefined; }
  return cur;
}
/** The elements a node stands for on its page (flattened), for outlining. */
export function elementsOf(value: unknown): Element[] {
  const out: Element[] = []; const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (isEl(x)) out.push(x); }; walk(value); return out;
}
/** A short sample of a value for the node's badge / preview. */
export function sample(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "∅";
  if (Array.isArray(value)) return `×${value.length}`;
  if (isEl(value)) return `<${value.tagName.toLowerCase()}>`;
  if (isDoc(value)) return "page";
  const s = String(value); return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
/** The href a Reference node points at, for opening its page: the first element's value, resolved against `base`. */
export function hrefOf(g: Graph, id: string, doc: Document | null, base: string): string | null {
  const val = evalNode(g, id, doc); const first = Array.isArray(val) ? val.flat(Infinity)[0] : val;
  if (typeof first !== "string" || !first) return null;
  try { return new URL(first, base).toString(); } catch { return first; }
}
export const describeOp = (n: GNode): string => !n.op ? "Reference" : `${n.op.name}(${[...n.op.args.map((a) => (a.plan ? "…" : JSON.stringify(a.value))), ...Object.entries(n.op.kwargs).map(([k, a]) => `${k}=${a.plan ? "…" : JSON.stringify(a.value)}`)].join(", ")})`;

// -- focus: what a node renders, where selectors are rooted ------------------------------------
/** The element a node's OWN selector is rooted in (its parent's value: the first element of a
 * collection), or null for the page. */
export function inputOf(g: Graph, id: string, doc: Document | null): Element | null {
  const n = g.nodes[id]; if (!n?.parent || !doc) return null;
  const p = g.nodes[n.parent]!; if (p.type === "Document" || p.type === "Reference") return null;
  const v = evalNode(g, p.id, doc); return elementsOf(v)[0] ?? null;
}
/** The element a node's CHILDREN are rooted in (its own value), or null for the page. `index`
 * picks a record of a collection. */
export function outputOf(g: Graph, id: string, doc: Document | null, index = 0): Element | null {
  const n = g.nodes[id]; if (!n || !doc || n.type === "Document" || n.type === "Reference") return null;
  const els = elementsOf(evalNode(g, id, doc)); return els[Math.min(index, Math.max(0, els.length - 1))] ?? null;
}
/** The structural path of an element (child indices from <html>) and back. */
export function pathOf(el: Element): number[] { const p: number[] = []; let n: Element | null = el; while (n && n.parentElement) { p.unshift([...n.parentElement.children].indexOf(n)); n = n.parentElement; } return p; }
export function byPath(doc: Document, p: number[]): Element | null { let el: Element | null = doc.documentElement; for (const i of p) { el = el?.children[i] ?? null; if (!el) return null; } return el; }
/** Nodes whose required argument is still empty (the plan cannot run yet). */
export function incomplete(g: Graph): GNode[] { return Object.values(g.nodes).filter((n) => n.op && ["select", "select_all", "attr", "click", "write", "wait_for"].includes(n.op.name) && !String(n.op.args[0]?.value ?? "").trim()); }

/** alias steps naming a column from a column already extracted beside it: `field("x")` */
export const fieldAlias = (name: string): Step[] => [{ kind: "get", name: "field" }, { kind: "call", name: "field", args: [{ value: name }], kwargs: {} }];
export const aliasField = (steps: Step[] | undefined): string | null => (steps && steps.length === 2 && steps[0]!.name === "field" && typeof steps[1]!.args?.[0]?.value === "string" ? (steps[1]!.args![0]!.value as string) : null);

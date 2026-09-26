/** THE PLAN, as a run sees it: every step of the plan and of its sub-plans, by ADDRESS -- the same
 * address the package stamps on every event a step causes (`Event.step`, docs/product/run.md):
 *
 *   "0"               step 0 of the plan (the `get` of a get+call pair)
 *   "4/kw:title/2"    step 2 of the `title=` column of the extract at step 4
 *   "4/arg:0/0"       step 0 of the sub-plan in the first positional arg of step 4
 *
 * Each step is an OP applied to an INPUT object, yielding an object of a TYPE (the Author graph's grammar:
 * objects are nodes, ops are edges). A step after a Collection that is not a whole-collection op runs once
 * PER ITEM of it (the executor fans out); so does every column of an extract over a Collection. */

import { calls, type Arg, type Plan } from "../plan";

export type ObjType = "Reference" | "Document" | "Element" | "Collection" | "Value" | "Rows" | "Row";

export type PNode = {
  addr: string;
  op: string;
  /** the main argument (a selector, an attribute name) when it is a literal */
  arg?: string;
  /** literal args / kwargs (a sub-plan shows as its own nodes) */
  args: unknown[];
  kwargs: Record<string, unknown>;
  /** the node whose output this op is applied to ("" = the plan's root object) */
  input: string;
  type: ObjType;
  /** the fan-out whose ITEMS this runs once for (its addr), null = once */
  per: string | null;
  /** yields many: its items are what `per` of later steps refers to */
  fans: boolean;
  /** at most this many items (a limit(n) between the fan-out and this step) */
  cap?: number;
  /** a filter between the fan-out and this step: its items are numbered among what it KEPT (its result maps them back) */
  filtered?: string;
  /** this step's output fills an output column */
  column?: string;
  /** the step whose arg this sub-plan sits in, and which arg (`kw:title`) */
  host?: string;
  seg?: string;
  /** nesting of sub-plans (0 = the main chain) */
  depth: number;
  /** a short signature: `select_all("ol.row li")` */
  label: string;
  /** the SAME step as another (the same op, args and input, per the same items -- e.g. the `select("h3 a")` two
   * columns each start with): shown as that one node, its runs merged; the address it is shown as */
  same?: string;
};

export type PlanModel = {
  /** the plan's id (the package's `Plan.id`), when known: events stamped with ANOTHER plan's id are not this run's */
  planId?: string;
  /** only this plan's events are its run: the stream carries its id (a trace of a script that ran the plan among
   * other things -- the other things are not the plan's run) */
  strict?: boolean;
  /** a recording's recorded steps (an event's `step`: "@n3") and where they are in this plan ("4/kw:title/2") */
  stepMap?: Record<string, string>;
  rootType: ObjType;
  nodes: PNode[];
  byAddr: Map<string, PNode>;
  /** the projected columns and the node each is filled from */
  columns: { name: string; from: string }[];
  /** a shown node's addresses: itself and the steps that are the same (see `PNode.same`) */
  members: Map<string, string[]>;
};

/** the address a step is SHOWN as (itself, or the step it is the same as) */
export const shownAs = (m: PlanModel, addr: string): string => m.byAddr.get(addr)?.same ?? addr;

/** ops acting on a Collection AS A WHOLE (the executor's `_COLL_OPS`); anything else after a Collection runs per item */
export const COLL_OPS = new Set(["extract", "filter", "project", "limit", "documents", "merge"]);
const FANS = new Set(["select_all", "links", "paginate"]);
/** steps a collection's items pass THROUGH (still the fan-out's items): a limit, a filter, the shaping */
const PASS = new Set(["limit", "filter", "extract", "project", "merge"]);
const RESOLVABLE = new Set(["href", "src", "action"]);
const ACTIONS = new Set(["click", "write", "scroll", "wait_for", "goto", "reload", "hover", "press", "step"]);

/** the type an op yields from an input of type `t` */
export function typeAfter(t: ObjType, op: string, args: Arg[]): ObjType {
  if (op === "resolve" || op === "fetch") return "Document";
  if (t === "Reference") return "Reference";
  if (op === "select") return "Element";
  if (FANS.has(op)) return "Collection";
  if (op === "attr") return RESOLVABLE.has(String(args[0]?.value)) ? "Reference" : "Value";
  if (op === "link") return "Reference";
  if (ACTIONS.has(op)) return t === "Element" ? "Element" : "Document";
  if (op === "extract") return t === "Collection" ? "Collection" : "Row";
  if (op === "project") return "Rows";
  if (op === "merge") return "Row";
  if (op === "filter" || op === "limit") return t;
  if (op === "documents") return "Collection";
  return "Value";
}

const short = (x: unknown) => { const s = typeof x === "string" ? JSON.stringify(x) : String(x); return s.length > 40 ? `${s.slice(0, 37)}…"` : s; };

export function planModel(plan: Plan, planId?: string, stepMap?: Record<string, string>, strict = false): PlanModel {
  const nodes: PNode[] = [];
  const columns: { name: string; from: string }[] = [];
  const rootType: ObjType = plan.root === "Reference" ? "Reference" : "Document";

  const capOf = (a: string): number | undefined => { const n = nodes.find((x) => x.addr === a); return n?.op === "limit" && typeof n.args[0] === "number" ? (n.args[0] as number) : undefined; };
  let inheritCap: number | undefined; let inheritFiltered: string | undefined;
  // the fan-out a collection's items are the items of: through a limit (the first n) and the shaping of them
  // (extract / project / merge keep one row per item)
  // (and through a filter: its items are the fan-out's that it kept -- `filterOf` says which filter, to map them back)
  const filterOf = (a: string): string | undefined => { let n = nodes.find((x) => x.addr === a); while (n && PASS.has(n.op) && n.input) { if (n.op === "filter") return n.addr; n = nodes.find((x) => x.addr === n!.input); } return undefined; };
  const fanBase = (a: string): string => { let n = nodes.find((x) => x.addr === a); while (n && PASS.has(n.op) && n.input) { const up = nodes.find((x) => x.addr === n!.input); if (!up) break; n = up; } return n?.addr ?? a; };
  /** walk a (sub-)plan: `prefix` its address, applied to `input` (of `type`, run per `per`) */
  const walk = (p: Plan, prefix: string[], input: string, type: ObjType, per: string | null, depth: number, host?: string, seg?: string, column?: string): { last: string; type: ObjType } => {
    let cur = input, t = type, each = per; let cap = per ? inheritCap : undefined; let filtered = per ? inheritFiltered : undefined;
    let first = true; let lastNode: PNode | null = null;
    for (const c of calls(p)) {
      const addr = [...prefix, String(c.index)].join("/");
      if (c.name === "alias") {
        // the column's NAME: a literal, or read off the element (its own steps, at <alias>/arg:0)
        const a = c.args[0];
        if (lastNode) lastNode.column = a?.plan ? "(named from the page)" : String(a?.value ?? column ?? "");
        if (a?.plan) walk(a.plan, [...prefix, String(c.index), "arg:0"], input, type, per, depth + 1, addr, "arg:0", "(the name)");
        continue;
      }
      // after a Collection, an element op runs once per item: the executor fans the chain out
      // (through a limit: it keeps the items' positions, so its items ARE its input fan-out's first n)
      // (a whole-collection op -- extract / limit / project over it -- still runs per item of it: its rows ARE its items)
      if (t === "Collection") { each = fanBase(cur); cap = capOf(cur); filtered = filterOf(cur); }
      const nt = typeAfter(t, c.name, c.args);
      const lits = c.args.filter((a) => !a.plan).map((a) => a.value);
      const kw = Object.fromEntries(Object.entries(c.kwargs).filter(([, a]) => !a.plan).map(([k, a]) => [k, a.value]));
      const argStr = lits.map(short).concat(Object.entries(kw).map(([k, x]) => `${k}=${short(x)}`)).join(", ");
      const node: PNode = {
        addr, op: c.name, arg: typeof lits[0] === "string" ? (lits[0] as string) : undefined, args: lits, kwargs: kw,
        input: cur, type: nt, per: each, fans: FANS.has(c.name), depth, ...(each && cap != null ? { cap } : {}), ...(each && filtered ? { filtered } : {}),
        label: `${c.name}(${argStr}${Object.values(c.kwargs).some((a) => a.plan) || c.args.some((a) => a.plan) ? `${argStr ? ", " : ""}…` : ""})`,
        ...(first && host ? { host, seg } : {}),
      };
      nodes.push(node); lastNode = node; first = false;
      // sub-plans: extract / filter columns run on EACH element of a collection (or on the one page);
      // step(action) on the held page; any other arg against the plan's context
      const elementInput = t === "Collection" ? cur : cur;
      const elementPer = t === "Collection" ? fanBase(cur) : each;
      inheritCap = t === "Collection" ? capOf(cur) : cap;
      inheritFiltered = t === "Collection" ? filterOf(cur) : filtered;
      c.args.forEach((a, n) => { if (a.plan) walk(a.plan, [...prefix, String(c.index), `arg:${n}`], c.name === "extract" || c.name === "filter" || c.name === "step" ? elementInput : "", c.name === "extract" || c.name === "filter" ? (t === "Collection" ? "Element" : t) : c.name === "step" ? t : rootType, c.name === "extract" || c.name === "filter" ? elementPer : each, depth + 1, addr, `arg:${n}`); });
      for (const [k, a] of Object.entries(c.kwargs)) {
        if (!a.plan) continue;
        // a bound op's own sub-plans (paginate's action / stop / key) are addressed `sub`
        const segK = c.name === "paginate" ? "sub" : `kw:${k}`;
        const colIn = c.name === "extract" ? elementInput : c.name === "paginate" ? cur : "";
        const colType: ObjType = c.name === "extract" ? (t === "Collection" ? "Element" : t) : c.name === "paginate" ? "Document" : rootType;
        const r = walk(a.plan, [...prefix, String(c.index), segK], colIn, colType, c.name === "extract" ? elementPer : each, depth + 1, addr, segK, c.name === "extract" ? k : undefined);
        if (c.name === "extract") {
          const last = nodes.find((x) => x.addr === r.last);
          if (last && !last.column) last.column = k;
          columns.push({ name: last?.column && last.column !== "(named from the page)" ? last.column : k, from: r.last });
        }
      }
      cur = addr; t = nt;
    }
    return { last: cur, type: t };
  };

  walk(plan, [], "", rootType, null, 0);
  // THE SAME STEP, once: columns that start alike (select("h3 a") then attr("title") | attr("href")) share their
  // steps -- one node, the reads branching off it. Steps with sub-plans (extract, step) stay their own.
  const key = new Map<string, string>(); const members = new Map<string, string[]>();
  const shown = (a: string) => nodes.find((x) => x.addr === a)?.same ?? a;
  for (const n of nodes) {
    members.set(n.addr, [n.addr]);
    if (n.label.endsWith("…)") || n.op === "project" || n.op === "merge") continue;
    const k = `${shown(n.input)}|${n.per ?? ""}|${n.op}|${JSON.stringify(n.args)}|${JSON.stringify(n.kwargs)}`;
    const first = key.get(k);
    if (first) { n.same = first; members.get(first)!.push(n.addr); members.delete(n.addr); }
    else key.set(k, n.addr);
  }
  return { planId, strict, stepMap, rootType, nodes, byAddr: new Map(nodes.map((n) => [n.addr, n])), columns, members };
}

/** a node's chain of ancestors by input (root first), itself last */
export function lineage(m: PlanModel, addr: string): PNode[] {
  const out: PNode[] = []; let n = m.byAddr.get(addr);
  while (n) { out.unshift(n); n = n.input ? m.byAddr.get(n.input) : undefined; }
  return out;
}

/** the steps an event's address falls under: its own node, or the nearest enclosing one (an address inside a
 * sub-plan the model does not break down -- `sub` -- belongs to its host) */
export function nodeOf(m: PlanModel, step: string | null | undefined): PNode | undefined {
  if (!step) return undefined;
  let s = m.stepMap?.[step] ?? step;
  for (;;) {
    const n = m.byAddr.get(s); if (n) return n;
    const i = s.lastIndexOf("/"); if (i < 0) return undefined;
    s = s.slice(0, i);
  }
}

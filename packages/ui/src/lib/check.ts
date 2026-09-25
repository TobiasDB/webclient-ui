/** The PLAN CHECK: after any edit, every line of the plan is evaluated on the pages the workspace
 * has (a fan-out's later lines over all its items; a page opened from a link on the FIRST item's
 * link, as one example) and flagged where it would fail or yield nothing: a selector that matches
 * nothing, a read that reads nothing, a link with nowhere to go, a page that is not open to check. */

import { ancestors, eachOf, elementsOf, evalNode, hrefOf, pageOf, type Graph } from "./graph";

export type Problem = { level: "error" | "warn" | "info"; short: string; message: string };

const SELECTS = new Set(["select", "select_all", "click", "write", "wait_for", "scroll", "hover"]);
const flat = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(flat) : [v]);
const empty = (x: unknown) => x === null || x === undefined || x === "" || (Array.isArray(x) && x.length === 0);

/** Check every line: `docOf(pageId)` is the parsed page a Document line stands for (null when not open). */
export function checkPlan(g: Graph, docOf: (pageId: string) => Document | null, base: string): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  // top-down: a line under one already flagged is not flagged again (the cause is shown once)
  const nodes = Object.values(g.nodes).map((n) => ({ n, path: ancestors(g, n.id) })).sort((a, b) => a.path.length - b.path.length);
  for (const { n, path } of nodes) {
    if (!n.op || !n.parent) continue;
    if (path.slice(0, -1).some((a) => out[a.id] && out[a.id]!.level !== "warn")) continue;
    const page = pageOf(g, n.id); if (!page) continue;
    const doc = docOf(page.id);
    if (!doc) { if (page.id === n.id) out[n.id] = { level: "info", short: "not checked", message: "this page is not open yet -- it is checked once it loads" }; continue; }
    if (n.id === page.id) {
      // a page opened from a link: the link must lead somewhere (the first item's, as the example)
      if (n.parent !== g.root) { const pp = pageOf(g, n.parent); const href = pp ? hrefOf(g, n.parent, docOf(pp.id), base) : null; if (!href) out[n.id] = { level: "error", short: "no link", message: "the value it opens is empty on the first item -- nothing to open" }; }
      continue;
    }
    const v = evalNode(g, n.id, doc); const each = !!eachOf(g, n.id);
    const sel = String(n.op.args[0]?.value ?? "");
    if (SELECTS.has(n.op.name) && sel) {
      const hits = n.op.name === "select_all" ? elementsOf(v).length : flat(v).filter((x) => !empty(x)).length;
      if (hits === 0 && !n.op.kwargs.optional?.value) out[n.id] = { level: "error", short: "no match", message: each ? `"${sel}" matches nothing in any item -- the run would fail here` : `"${sel}" matches nothing on the page -- the run would fail here` };
      continue;
    }
    if (n.op.name === "attr" || n.op.name === "text_content") {
      const vals = flat(v); const upstreamEmpty = vals.every((x) => x === undefined);
      if (!upstreamEmpty && vals.every(empty)) out[n.id] = { level: "warn", short: "empty", message: `reads nothing${each ? " in any item" : ""} -- the column would be empty` };
    }
  }
  return out;
}

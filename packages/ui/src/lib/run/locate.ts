/** WHERE a step ran, for one item: the page (its document id) and the way down to the element on it --
 * exact, from the plan's lineage and the step results the package publishes (a select's result names the
 * page its element is on; a resolve's names the page it opened), not from matching events by order.
 *
 *   hops: [{ sel: "ol.row li", index: 7 }, { sel: "h3 a" }]   = the 8th record's title link */

import type { ItemKey, RunState } from "./state";
import { lineage, type PlanModel, type PNode } from "./plan";

export type Hop = { sel: string; index?: number; all?: boolean };
export type Where = { doc: string; hops: Hop[]; op: string; addr: string; /** the step found MANY (a select_all itself): all of them are its result */ many?: boolean };

const PAGE_OPS = new Set(["resolve", "fetch", "paginate", "click", "write", "scroll", "wait_for", "goto", "reload", "step"]);
const isDoc = (d: unknown): d is string => typeof d === "string" && d.startsWith("doc:");

/** item keys to look a node's instance up by: the item itself, then its parents ("3.1" -> "3.1", "3", "") */
const prefixes = (item: ItemKey): ItemKey[] => { const p = item ? item.split(".") : []; const out: ItemKey[] = []; for (let i = p.length; i >= 0; i--) out.push(p.slice(0, i).join(".")); return out; };

/** the item's index WITHIN the fan-out instance it came from (a paginated fan-out's items count across its
 * pages' instances), and that instance's page */
export function localIndex(s: RunState, fan: string, item: ItemKey): { index: number; doc?: string } | null {
  const parts = item ? item.split(".") : []; if (!parts.length) return null;
  const k = Number(parts[parts.length - 1]); const parent = parts.slice(0, -1).join(".");
  const nr = s.nodes.get(fan); if (!nr) return { index: k };
  const own = nr.insts.get(parent);
  if (own) return { index: k, doc: docOfResult(own.result) };
  // merged across instances (a select_all per page, its records numbered across the pages): walk the instances
  const insts = [...nr.insts.values()].sort((a, b) => cmpKey(a.item, b.item));
  let from = 0;
  for (const inst of insts) { const n = inst.result?.n ?? s.fanN.get(`${fan}|${inst.item}`) ?? 0; if (k < from + n) return { index: k - from, doc: docOfResult(inst.result) }; from += n; }
  return { index: k };
}
const cmpKey = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; };
const docOfResult = (r?: { document_id?: string | null; parent?: string | null }) => (isDoc(r?.document_id) ? r!.document_id! : isDoc(r?.parent) ? r!.parent! : undefined);

export function locate(m: PlanModel, s: RunState, addr: string, item: ItemKey): Where | null {
  const lin = lineage(m, addr); if (!lin.length) return null;
  const target = lin[lin.length - 1]!;
  // the page: the nearest step back along the lineage whose result (for this item or an enclosing one) names one
  let doc: string | undefined; let pageAt = -1;
  for (let j = lin.length - 1; j >= 0 && !doc; j--) {
    const n = lin[j]!; const nr = s.nodes.get(n.addr); if (!nr) continue;
    for (const k of prefixes(item)) { const inst = nr.insts.get(k); const d = docOfResult(inst?.result); if (d) { doc = d; pageAt = j; break; } }
    if (!doc && n.per && n.fans === false) { /* keep looking further back */ }
  }
  // a fan-out's instance knows its page too (a record of a paginated select_all)
  if (!doc) for (const n of lin) { if (!n.per) continue; const li = localIndex(s, n.per, item); if (li?.doc) { doc = li.doc; break; } }
  if (!doc) return null;
  // the way down: the selects after the last step that produced a PAGE (a resolve, an action on the page)
  // (a page step AFTER the one that named the page has not made its page yet -- a resolve still opening: the
  // way down stays on the page it is leaving, to the link it follows)
  let start = 0;
  const upto = pageAt >= 0 ? pageAt : lin.length - 1;
  for (let j = 0; j <= upto; j++) if (PAGE_OPS.has(lin[j]!.op) && lin[j]!.type !== "Element" && (j < pageAt || lin[j]!.type === "Document" && j === pageAt)) start = j + 1;
  const hops: Hop[] = [];
  // an ACTION's target (click / write / ... name the element they act on) is the element -- found within what
  // the way down reached (the page, or the item's element)
  const acting = target !== undefined && ACTION_OPS.has(target.op) && target.arg ? target : undefined;
  for (const n of lin.slice(start)) {
    if ((n.op === "select" || n.op === "select_all") && n.arg) {
      // a select_all that later steps run per item of: this item's match; else all of them
      const feeds = lin.some((x) => x.per === n.addr);
      if (n.op === "select_all" && feeds) { const li = localIndex(s, n.addr, itemAt(m, lin, n, item)); hops.push({ sel: n.arg, index: li?.index ?? 0 }); }
      else hops.push(n.op === "select_all" ? { sel: n.arg, all: true } : { sel: n.arg });
    }
  }
  if (acting) hops.push({ sel: acting.arg! });
  // the fan-out step ITSELF (not one of its items): what it found is every match
  const many = (target.op === "select_all" || target.op === "links") && !lin.some((x) => x.per === target.addr && x !== target && item !== "");
  if (many) { const last = hops[hops.length - 1]; if (last && last.sel === target.arg) hops[hops.length - 1] = { sel: last.sel, all: true }; }
  return { doc, hops, op: target.op, addr: target.addr, ...(many ? { many } : {}) };
}

const ACTION_OPS = new Set(["click", "write", "scroll", "wait_for", "hover", "press"]);

/** the part of an item path that indexes fan-out `fan` (a nested fan-out's items are `outer.inner`) */
function itemAt(m: PlanModel, lin: PNode[], fan: PNode, item: ItemKey): ItemKey {
  const parts = item ? item.split(".") : [];
  // how many fan-outs that later steps run per item of lie on the lineage up to (and including) `fan`,
  // counting only the NESTED ones (a fan-out evaluated per item of another)
  let depth = 0;
  for (const n of lin) { if (lin.some((x) => x.per === n.addr) && (depth === 0 || n.per)) depth++; if (n === fan) break; }
  void m;
  return parts.slice(0, Math.max(1, Math.min(parts.length, depth))).join(".");
}

/** find the element: `hops` applied from the document root (null when the page does not have it) */
export function resolveHops(root: ParentNode, hops: Hop[]): { el: Element | null; all: Element[]; fan?: { all: Element[]; own: Element | null; index: number } } {
  let cur: ParentNode | null = root; let all: Element[] = [];
  // the FAN-OUT the item came from (the last indexed hop): its whole list, and the item's own match in it
  let fan: { all: Element[]; own: Element | null; index: number } | undefined;
  for (const h of hops) {
    if (!cur) return { el: null, all: [], fan };
    let found: Element[] = []; try { found = [...cur.querySelectorAll(h.sel)]; } catch { return { el: null, all: [], fan }; }
    if (h.all) { all = found; cur = found[0] ?? null; continue; }
    all = h.index != null ? found : found.slice(0, 1);
    cur = found[h.index ?? 0] ?? null;
    if (h.index != null) fan = { all: found, own: (cur as Element | null) ?? null, index: h.index };
  }
  return { el: cur && (cur as Element).tagName ? (cur as Element) : null, all, fan };
}

export type ChainLink = Where & {
  /** the step that led off this page to the next (the link read: `attr("href")`), or the step on screen (last) */
  via: string;
  /** the page step that opened the NEXT page (its resolve), when there is one */
  opens?: string;
};

/** THE PAGES an item went through to reach a step -- a nested crawl: the listing, the detail page its link
 * opened, the page a link on THAT opened... -- each with the way down to the element that led on (the link it
 * followed), the last with the step on screen. One entry when the step is on the page the plan started on. */
export function pageChain(m: PlanModel, s: RunState, addr: string, item: ItemKey): ChainLink[] {
  const lin = lineage(m, addr); if (!lin.length) return [];
  const out: ChainLink[] = [];
  // the page steps along the way: every resolve after the first page (a link read, then opened)
  const opens = lin.map((n, j) => ({ n, j })).filter(({ n, j }) => j > 0 && (n.op === "resolve" || n.op === "fetch") && n.type === "Document");
  for (const { n, j } of opens) {
    const exit = lin[j - 1]!; // what the page gave that was opened (the link)
    const w = locate(m, s, exit.addr, item);
    if (w && !out.some((o) => o.doc === w.doc)) out.push({ ...w, via: exit.addr, opens: n.addr });
  }
  const last = locate(m, s, addr, item);
  if (last) {
    const prev = out[out.length - 1];
    if (prev && prev.doc === last.doc) out[out.length - 1] = { ...last, via: addr };  // still on it (the next page not yet open)
    else out.push({ ...last, via: addr });
  }
  return out;
}

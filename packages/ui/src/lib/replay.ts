/** REPLAY: where on a page a step of a run acted -- the item's OWN element, not the first match.
 *
 * A step inside a fan-out runs once per item; its selector matches every record on the page. The
 * item's element is the k-th match of the fan-out's selector on THAT page (k = the item's index, less
 * what earlier pages of a paginated fan-out contributed), and the step's selector runs within it. */

import type { RunEvent } from "./stages";

/** for a fan-out stage spanning pages: each page's first item index (the items of earlier pages before it) */
export function pageOffsets(events: RunEvent[], stageOf: (string | null)[], fanStage: string): Map<string, number> {
  const out = new Map<string, number>(); let total = 0;
  events.forEach((e, i) => {
    if (stageOf[i] !== fanStage || e.topic !== "plan" || e.phase !== "fanout") return;
    const d = (e as { document_id?: string }).document_id; if (!d || out.has(d)) return;
    out.set(d, total); total += Number(e.detail?.n ?? 0);
  });
  return out;
}

/** for a fan-out stage: each page's span of items -- its first index and how many it fanned out to */
export function pageSpans(events: RunEvent[], stageOf: (string | null)[], fanStage: string): { doc: string; from: number; n: number }[] {
  const out: { doc: string; from: number; n: number }[] = []; let total = 0;
  events.forEach((e, i) => {
    if (stageOf[i] !== fanStage || e.topic !== "plan" || e.phase !== "fanout") return;
    const d = (e as { document_id?: string }).document_id; if (!d || out.some((x) => x.doc === d)) return;
    const n = Number(e.detail?.n ?? 0); out.push({ doc: d, from: total, n }); total += n;
  });
  return out;
}
/** the page an item of a fan-out is on (the span holding its index) */
export function pageOfItem(spans: { doc: string; from: number; n: number }[], index: number): { doc: string; local: number } | null {
  const s = spans.find((x) => index >= x.from && index < x.from + x.n); return s ? { doc: s.doc, local: index - s.from } : null;
}

export type Target = { els: Element[]; /** the one the item stands for (a select_all shows all, this one emphasised) */ own?: Element; how: "item" | "page" };

/** the elements a step acted on, on `doc`: `op` + `selector` of the step; `fanSelector` + `index` place the
 * item (its record = the index-th match of the fan-out on this page) -- falling back to the page as a whole
 * when the fan-out is not on this page (a detail page reached from the record) */
export function targetOf(doc: Document, op: string, selector: string | undefined, fanSelector?: string, index?: number): Target {
  const all = (root: ParentNode, sel: string): Element[] => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  if (fanSelector && index != null && index >= 0) {
    const recs = all(doc, fanSelector);
    if (recs.length) {
      const rec = recs[Math.min(index, recs.length - 1)]!;
      if (!selector || selector === fanSelector) return { els: op === "select_all" ? recs : [rec], own: rec, how: "item" };
      const inner = op === "select_all" ? all(rec, selector) : all(rec, selector).slice(0, 1);
      if (inner.length) return { els: inner, own: inner[0], how: "item" };
    }
  }
  if (!selector) return { els: [], how: "page" };
  const els = op === "select_all" ? all(doc, selector) : all(doc, selector).slice(0, 1);
  return { els, own: els[0], how: "page" };
}

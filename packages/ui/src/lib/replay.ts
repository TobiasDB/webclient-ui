/** REPLAY: where on a page a step of a run acted -- the item's OWN element, not the first match.
 *
 * A step inside a fan-out runs once per item; its selector matches every record on the page. The
 * item's element is the k-th match of the fan-out's selector on THAT page (k = the item's index, less
 * what earlier pages of a paginated fan-out contributed), and the step's selector runs within it. */

import type { RunEvent, Stage } from "./stages";

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
  // the one to focus: the first match a reader can SEE -- a hidden / zero-size match (a menu's <li>) has no box,
  // and its outline and the pointer would land in the page's corner
  return { els, own: els.find(shown) ?? (els[0] && shown(els[0]) ? els[0] : undefined), how: "page" };
}

/** whether an element renders a box. A document that is not rendered (DOMParser: no view) can't say: yes. */
export function shown(el: Element): boolean {
  const w = el.ownerDocument?.defaultView; if (!w) return true;
  if (el.closest("head, [hidden], template")) return false;
  try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return true; const cs = w.getComputedStyle(el); return cs.display === "contents"; } catch { return true; }
}

const keyOf = (e: RunEvent) => (e.item ?? []).join(".");
const docOf = (e: RunEvent) => (e as { document_id?: string }).document_id;

/** each chained stage's predecessor: a chain `select → attr → number` hangs under its head, the rest in order */
const PREV = new WeakMap<Stage[], Map<string, string>>();
function chainPrev(all: Stage[]): Map<string, string> {
  let m = PREV.get(all); if (m) return m; m = new Map();
  for (const st of all) { let prev = st.id; for (const c of st.children) if (c.chain) { m.set(c.id, prev); prev = c.id; } }
  PREV.set(all, m); return m;
}

export type Place = { doc: string; fan?: Stage; local?: number };

/** WHERE step `j` happened: its own page; a record's step (on an element: no page id) is on the page whose span of the
 * fan-out holds the record; anything else on its item's last page (its detail page's fetch). `feedOf` names the
 * fan-out stage feeding a stage. `local` is the item's index among the fan-out's matches on that page. */
export function placeOf(events: RunEvent[], stageOf: (string | null)[], all: Stage[], feedOf: (stage: string) => string | undefined, j: number, depth = 0): Place | null {
  const ev = events[j]; if (!ev || j < 0) return null;
  const own = docOf(ev); const st = all.find((x) => x.id === stageOf[j]);
  // a step on an ELEMENT (no page id) further down a chain reads what the step before it found -- on THAT step's
  // page (`.select("#product_description ~ p").attr("text")`: the read is on the detail page the select ran on)
  if (!own && st?.chain && depth < 8) {
    const prev = chainPrev(all).get(st.id); const key = keyOf(ev);
    if (prev) for (let k = j - 1; k >= 0 && j - k < 5000; k--) { const e = events[k]!; if (stageOf[k] === prev && e.topic === "plan" && e.phase === "step" && keyOf(e) === key) { const pp = placeOf(events, stageOf, all, feedOf, k, depth + 1); if (pp) return pp; break; } }
  }
  const feed = st ? feedOf(st.id) : undefined; let fan = feed ? all.find((x) => x.id === feed) : undefined;
  // no plan (a pipeline's trace: its query ran inside it): the fan-out the item came from is the last one recorded
  // for its parent -- its op and selector, on its page
  if (!fan && !st && (ev.item ?? []).length) {
    const parent = (ev.item ?? []).slice(0, -1).join(".");
    for (let k = j - 1; k >= 0; k--) { const e = events[k]!; if (e.topic === "plan" && e.phase === "fanout" && keyOf(e) === parent && docOf(e)) { fan = { id: `fan@${k}`, op: String(e.detail?.op ?? ""), kind: "EACH", arg: e.detail?.selector as string | undefined, children: [], depth: 0 }; if (!own) return { doc: docOf(e)!, fan, local: (ev.item ?? [])[(ev.item ?? []).length - 1] }; break; } }
  }
  let idx = (ev.item ?? []).length ? ev.item![ev.item!.length - 1]! : undefined;
  // a trace without item paths (recorded before they were stamped): the ITERATION -- how many times this
  // stage ran on this page since its fan-out there -- is the item's index
  let fanDoc: string | undefined;
  if (idx == null && fan && st && !(ev.item ?? []).length) {
    // anchored on the fan-out: its page, and how many times this stage ran since it
    let n = 0; for (let k = j - 1; k >= 0; k--) { const e = events[k]!; if (stageOf[k] === fan.id && (e.phase === "fanout" || (e.phase === "step" && e.topic === "plan")) && (!docOf(ev) || docOf(e) === docOf(ev))) { fanDoc = docOf(e); break; } if (stageOf[k] === st.id && e.topic === "plan" && e.phase === "step" && (!docOf(ev) || docOf(e) === docOf(ev))) n++; }
    idx = n;
    if (!own && fanDoc) return { doc: fanDoc, fan, local: idx };
  }
  // a NESTED fan-out's item ([8, 0]: row 0 of book 8's table) is on the page where the fan-out ran FOR ITS PARENT
  // ([8]) -- every parent's fan-out restarts at 0, so a count across all of them lands on the first book's page
  const path = ev.item ?? [];
  if (fan && path.length >= 2) {
    const parent = path.slice(0, -1).join(".");
    for (let k = j - 1; k >= 0; k--) { const e = events[k]!; if (stageOf[k] === fan.id && e.topic === "plan" && e.phase === "fanout" && keyOf(e) === parent && docOf(e)) return { doc: own ?? docOf(e)!, fan, local: path[path.length - 1] }; }
  }
  const spans = fan ? pageSpans(events, stageOf, fan.id) : [];
  if (own) { const sp = spans.find((x) => x.doc === own); return { doc: own, fan, local: idx != null && sp && (ev.item ?? []).length ? idx - sp.from : idx }; }
  if (fan && idx != null) { const hit = pageOfItem(spans, idx); if (hit) return { doc: hit.doc, fan, local: hit.local }; }
  const key = keyOf(ev);
  for (let k = j - 1; k >= 0 && j - k < 5000; k--) { const e = events[k]!; const d = docOf(e); if (d && keyOf(e) === key) return { doc: d, fan, local: idx }; }
  for (let k = j - 1; k >= 0 && j - k < 5000; k--) { const d = docOf(events[k]!); if (d) return { doc: d, fan, local: idx }; }  // no item: the last page touched
  return null;
}

/** what is watched: a stage and / or an item (its index path joined, "" = the root), or a page; null = follow the run */
export type Watch = { stage?: string | null; item?: string | null; doc?: string | null } | null;

/** the moment on screen: the last step / action / fetch (up to `at`) of the picked item / stage (or any: follow) */
export function currentStep(events: RunEvent[], stageOf: (string | null)[], at: number, pick: Watch): number {
  const shown = (e: RunEvent) => (e.topic === "plan" && e.phase === "step") || e.topic === "action" || e.topic === "snapshot";
  // FOLLOW (nothing picked): items run in parallel, so the last event belongs to a different item -- and a different
  // page -- almost every step. Stay with the OLDEST item still in flight (and its nested rows) until it is done.
  if (!pick || (pick.item == null && !pick.stage && !pick.doc)) {
    const upto = Math.min(at, events.length);
    const order: string[] = []; const last = new Map<string, number>(); const done = new Set<string>();
    for (let i = 0; i < upto; i++) {
      const e = events[i]!; const path = e.item ?? []; if (!path.length) continue;
      const top = String(path[0]);
      if (e.topic === "plan" && e.phase === "item" && path.length === 1) { done.add(top); continue; }
      if (!shown(e)) continue;
      if (!last.has(top)) order.push(top);
      last.set(top, i);
    }
    let lastAny = -1; for (let i = upto - 1; i >= 0; i--) if (shown(events[i]!)) { lastAny = i; break; }
    // an item is finished once it says so -- or (older traces: no item events) once it has gone quiet for a while
    const followed = order.find((k) => !done.has(k) && upto - last.get(k)! < 400);
    const mine = followed != null ? last.get(followed)! : -1;
    // a later ROOT step (the page fetched, the fan-out) still shows when nothing item-level is newer
    if (mine < 0) return lastAny;
    const root = lastAny > mine && !(events[lastAny]!.item ?? []).length ? lastAny : -1;
    return root > mine ? root : mine;
  }
  for (let i = Math.min(at, events.length) - 1; i >= 0; i--) {
    const e = events[i]!;
    if (pick?.item != null && keyOf(e) !== pick.item) continue;
    if (pick?.stage && stageOf[i] !== pick.stage) continue;
    if (pick?.doc) { if (docOf(e) === pick.doc) return i; continue; }
    if ((e.topic === "plan" && e.phase === "step") || e.topic === "action" || e.topic === "snapshot") return i;
  }
  return -1;
}


/** THE RUN AT A MOMENT: the plan (`planModel`) + the events up to t, folded (docs/product/run.md).
 *
 *   RUN(t) = fold(PLAN, events[0..t])
 *
 * A live run and a recorded one are the same fold -- a live run's cursor is at the end. Every event is
 * placed by what the package stamps on it: `step` (its plan node), `item` (the fan-out item), `document_id`
 * (its page). Nothing is inferred from order or selectors. */

import type { RunEvent } from "../stages";
import { nodeOf, type PlanModel } from "./plan";

export type ItemKey = string; // an item path joined with "." ("" = once, no fan-out)
export const keyOf = (item: number[] | null | undefined): ItemKey => (item ?? []).join(".");

export type Result = {
  op?: string; kind?: string; document_id?: string | null; parent?: string | null; url?: string;
  n?: number; of?: string; preview?: unknown; ms?: number; ok?: boolean; error?: string; message?: string;
};
/** one run of a step for one item */
export type Inst = { item: ItemKey; state: "running" | "done" | "failed"; first: number; last: number; t0: number; t1?: number; result?: Result };
export type NodeRun = { addr: string; insts: Map<ItemKey, Inst>; done: number; failed: number; running: number; firstT?: number; lastT?: number };

export type Request = { i: number; t: number; doc?: string; step?: string; item: ItemKey; url: string; method: string; status?: number; kind: "navigation" | "request" | "asset"; ms?: number; failed: boolean };
export type DocRun = {
  id: string; url?: string; status?: number; tier?: string; step?: string; item: ItemKey;
  /** event indexes: its snapshots (with their phase), rrweb chunks, requests, actions, errors */
  snaps: { i: number; phase?: string }[]; rrweb: number[]; requests: number[]; actions: { i: number; action: string; selector?: string; text?: string }[]; errors: number[];
  first: number; last: number;
};
export type Row = { i: number; item: ItemKey; row: unknown };
export type ErrorAt = { i: number; t: number; step?: string; item: ItemKey; doc?: string; code: string; message: string; raised: boolean };

export type RunState = {
  /** how many events are folded in, and the time of the last */
  n: number; t: number; t0: number;
  nodes: Map<string, NodeRun>;
  docs: Map<string, DocRun>;
  requests: Request[];
  actions: number[];
  errors: ErrorAt[];
  rows: Row[];
  /** per fan-out instance ("addr|item"): how many it fanned out to; per addr: the parallelism */
  fanN: Map<string, number>;
  parallel: Map<string, { n: number; limit: number; bound: string }>;
  started: boolean; finished: boolean;
};

export function emptyState(): RunState {
  return { n: 0, t: 0, t0: 0, nodes: new Map(), docs: new Map(), requests: [], actions: [], errors: [], rows: [], fanN: new Map(), parallel: new Map(), started: false, finished: false };
}

const docOf = (e: RunEvent) => (e as { document_id?: string | null }).document_id ?? undefined;
const stepOf = (e: RunEvent) => (e as { step?: string | null }).step ?? undefined;

function node(s: RunState, addr: string): NodeRun {
  let n = s.nodes.get(addr); if (!n) { n = { addr, insts: new Map(), done: 0, failed: 0, running: 0 }; s.nodes.set(addr, n); } return n;
}
function doc(s: RunState, id: string, i: number, e: RunEvent, addr?: string): DocRun {
  let d = s.docs.get(id);
  if (!d) { d = { id, step: addr ?? stepOf(e), item: keyOf(e.item), snaps: [], rrweb: [], requests: [], actions: [], errors: [], first: i, last: i }; s.docs.set(id, d); }
  d.last = i; return d;
}

/** fold ONE event (index `i`) into `s` (mutating: the folder owns its state) */
export function reduce(s: RunState, e: RunEvent, i: number, m: PlanModel | null): void {
  const t = e.ts ?? s.t; if (!s.t0 && t) s.t0 = t; s.t = t; s.n = i + 1;
  // another plan's run in the same stream (a trace can hold several): not this plan's
  const pid = (e as { plan_id?: string | null }).plan_id;
  if (m?.planId && pid && pid !== m.planId) return;
  const d = docOf(e); const item = keyOf(e.item);
  const topic = e.topic ?? "";
  // the node an event belongs to: its own step, or the nearest step the model knows
  const pn = m ? nodeOf(m, stepOf(e)) : undefined;
  const addr = pn?.addr ?? stepOf(e);
  if (topic === "plan") {
    const det = (e.detail ?? {}) as Record<string, unknown>;
    switch (e.phase) {
      case "started": s.started = true; break;
      case "done": s.finished = true; break;
      case "step": if (addr) {
        const nr = node(s, addr); const inst = nr.insts.get(item);
        if (!inst) { nr.insts.set(item, { item, state: "running", first: i, last: i, t0: t }); nr.running++; }
        else inst.last = i;
        nr.firstT ??= t; nr.lastT = t;
      } break;
      case "result": if (addr) {
        const nr = node(s, addr); let inst = nr.insts.get(item);
        if (!inst) { inst = { item, state: "running", first: i, last: i, t0: t - (Number(det.ms) || 0) / 1000 }; nr.insts.set(item, inst); nr.running++; }
        const ok = det.ok !== false;
        if (inst.state === "running") nr.running--; else if (inst.state === "done") nr.done--; else nr.failed--;
        inst.state = ok ? "done" : "failed"; inst.t1 = t; inst.last = i; inst.result = det as Result;
        if (ok) nr.done++; else nr.failed++;
        nr.firstT ??= inst.t0; nr.lastT = t;
        if (det.kind === "Collection" && typeof det.n === "number") s.fanN.set(`${addr}|${item}`, det.n);
        if (det.kind === "Row" && pn?.op === "project" && pn.depth === 0) s.rows.push({ i, item, row: det.preview });  // the plan's output, not a column's own rows
      } break;
      case "fanout": if (addr && typeof det.n === "number") s.fanN.set(`${addr}|${item}`, det.n as number); break;
      case "parallel": if (addr) s.parallel.set(addr, { n: Number(det.n ?? 0), limit: Number(det.limit ?? 0), bound: String(det.bound ?? "") }); break;
      case "row": if (!m || !m.nodes.some((x) => x.op === "project")) s.rows.push({ i, item: keyOf((det as { item?: number[] }).item), row: (det as { row?: unknown }).row }); break;
    }
  } else if (topic === "snapshot") {
    if (d) { const dr = doc(s, d, i, e, addr); dr.snaps.push({ i, phase: e.phase }); const x = e as { final_url?: string; url?: string; status_code?: number; tiers?: string[] }; dr.url = x.final_url ?? x.url ?? dr.url; dr.status = x.status_code ?? dr.status; if (x.tiers?.length) dr.tier = x.tiers[x.tiers.length - 1]; }
  } else if (topic === "rrweb") {
    if (d) { const dr = doc(s, d, i, e, addr); dr.rrweb.push(i); dr.tier = "browser"; }
  } else if (topic.startsWith("network")) {
    const x = e as { url?: string; method?: string; status_code?: number; elapsed?: number; resource_type?: string; request?: { url?: string } };
    const url = x.url ?? x.request?.url ?? "";
    const kind: Request["kind"] = topic === "network.navigation" || x.resource_type === "document" ? "navigation" : x.resource_type && ["xhr", "fetch", "eventsource", "websocket"].includes(x.resource_type) ? "request" : x.resource_type ? "asset" : "request";
    const r: Request = { i, t, doc: d, step: addr, item, url, method: String(x.method ?? "GET").toUpperCase(), status: x.status_code, kind, ms: x.elapsed != null ? x.elapsed * 1000 : undefined, failed: (x.status_code ?? 200) >= 400 };
    s.requests.push(r);
    if (d) { const dr = doc(s, d, i, e, addr); dr.requests.push(s.requests.length - 1); if (kind === "navigation") { dr.url ??= url; dr.status ??= x.status_code; } }
  } else if (topic === "action") {
    s.actions.push(i);
    if (d) { const x = e as { action?: string; args?: { selector?: string; text?: string } }; doc(s, d, i, e, addr).actions.push({ i, action: String(x.action ?? "action"), selector: x.args?.selector, text: x.args?.text }); }
  } else if (topic === "error") {
    const x = e as { error?: { code?: string; type?: string; message?: string }; raised?: boolean };
    s.errors.push({ i, t, step: addr, item, doc: d, code: String(x.error?.code ?? x.error?.type ?? "error"), message: String(x.error?.message ?? ""), raised: x.raised !== false });
    if (d) doc(s, d, i, e, addr).errors.push(i);
  }
}

/** A FOLDER: the run state at a cursor, advanced incrementally as the cursor moves forward (a live stream,
 * playback) and rebuilt from the start when it moves back (a scrub back is O(n) once, not per frame). */
export class RunFolder {
  private s = emptyState();
  private events: RunEvent[] | null = null;
  private model: PlanModel | null = null;
  private snap: RunState = emptyState();
  at(events: RunEvent[], model: PlanModel | null, t: number): RunState {
    const upto = Math.max(0, Math.min(t, events.length));
    // the same stream, or a live one grown (a new array, same events at the front): carry on; else start over
    const prev = this.events;
    const extended = prev !== null && (events === prev || (events.length >= prev.length && events[0] === prev[0] && (this.s.n === 0 || events[this.s.n - 1] === prev[this.s.n - 1])));
    if (model !== this.model || !extended || upto < this.s.n) { this.s = emptyState(); this.model = model; this.snap = this.s; }
    this.events = events;
    if (upto === this.s.n && this.snap.n === upto && prev !== null && extended) return this.snap;
    for (let i = this.s.n; i < upto; i++) reduce(this.s, events[i]!, i, model);
    this.s.n = upto;
    // a fresh object per change (so React sees it); the maps inside are shared -- read them, never write
    this.snap = { ...this.s };
    return this.snap;
  }
}

/** the run state at `t`, from scratch (tests, one-offs) */
export function stateAt(events: RunEvent[], model: PlanModel | null, t = events.length): RunState {
  const s = emptyState(); const upto = Math.min(t, events.length);
  for (let i = 0; i < upto; i++) reduce(s, events[i]!, i, model);
  s.n = upto; return s;
}

/** how many items a node is expected to run for: the sum over its fan-out's instances of what each fanned out to */
export function expectedOf(s: RunState, m: PlanModel, addr: string): number | undefined {
  const pn = m.byAddr.get(addr); if (!pn?.per) return 1;
  let total = 0, any = false;
  for (const [k, n] of s.fanN) { if (k.startsWith(`${pn.per}|`)) { total += n; any = true; } }
  return any ? total : undefined;
}

/** FOLLOW: the item to show -- the oldest item still in flight (items run in parallel; following the latest
 * event would hop between them every step), else the last one to finish; "" = the root */
export function followItem(s: RunState, m: PlanModel): ItemKey {
  let oldest: { first: number; item: ItemKey } | null = null; let last: { i: number; item: ItemKey } | null = null;
  for (const [addr, nr] of s.nodes) {
    if (!m.byAddr.get(addr)?.per) continue;
    for (const inst of nr.insts.values()) {
      const top = inst.item.split(".")[0]!;
      if (inst.state === "running" && (!oldest || inst.first < oldest.first)) oldest = { first: inst.first, item: top };
      if (!last || inst.last > last.i) last = { i: inst.last, item: top };
    }
  }
  return oldest?.item ?? last?.item ?? "";
}

/** the latest step run (its node and instance) for `item` (and its nested items) up to now */
export function latestFor(s: RunState, item: ItemKey): { addr: string; inst: Inst } | null {
  let best: { addr: string; inst: Inst } | null = null;
  for (const [addr, nr] of s.nodes) for (const inst of nr.insts.values()) {
    if (!(inst.item === item || inst.item.startsWith(`${item}.`) || (item === "" && true))) continue;
    if (item === "" && inst.item !== "") continue;
    if (!best || inst.last > best.inst.last) best = { addr, inst };
  }
  return best;
}

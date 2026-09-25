/** The plan as STAGES (an EXPLAIN): what each call of the plan does, as a tree -- the spine
 * (fetch → pages → each record) and, under a record, one branch per column (find → read →
 * cast), a followed page nesting its own. Live events from a run are attributed to stages
 * (the executor's `plan.step` events carry the op and its selector), so the tree can show the
 * plan being realised: how many times each stage ran, which are active, where errors happened. */

import { calls, fieldRef, type Plan } from "./plan";

export type Stage = {
  id: string;
  op: string;
  /** EXPLAIN-style name: FETCH, PAGES, EACH, FIND, READ, CAST, COLUMNS, EMIT, MERGE, ACT */
  kind: string;
  /** the op's main argument (a selector, an attribute) */
  arg?: string;
  /** a column this stage produces (the extract key / alias) */
  column?: string;
  children: Stage[];
  depth: number;
  /** follows the stage it hangs under in sequence (the rest of a column's chain), not a branch of it */
  chain?: boolean;
};

const KIND: Record<string, string> = {
  resolve: "FETCH", paginate: "PAGES", select_all: "EACH", select: "FIND", attr: "READ", number: "CAST", date: "CAST", datetime: "CAST", map: "CAST",
  extract: "COLUMNS", project: "EMIT", merge: "MERGE", limit: "LIMIT", filter: "FILTER", click: "ACT", write: "ACT", scroll: "ACT", wait_for: "ACT", download: "READ",
};
const argOf = (c: { args: { value?: unknown; plan?: Plan }[]; kwargs: Record<string, { value?: unknown }> }): string | undefined => {
  const a = c.args[0]; if (a && typeof a.value === "string") return a.value;
  const kw = Object.entries(c.kwargs).filter(([, v]) => v.value !== undefined && typeof v.value !== "object").map(([k, v]) => `${k}=${String(v.value)}`); return kw.length ? kw.join(", ") : undefined;
};

/** The stage tree of a plan: a chain of stages; an extract's columns branch under it. */
export function stagesOf(p: Plan): Stage[] {
  let n = 0;
  const chain = (plan: Plan, depth: number, column?: string): Stage[] => {
    const out: Stage[] = [];
    for (const c of calls(plan)) {
      if (c.name === "alias") {
        // a name read from the page (`td.alias(th text)`): its reads run too -- a branch of the read it names
        const a = c.args[0]; const host = out[out.length - 1];
        if (a?.plan && host && !fieldRef(a.plan)) { const sub = chain(a.plan, depth + 1); if (sub[0]) { sub[sub.length - 1]!.column = "(the name)"; host.children.push(...link(sub)); } }
        continue;
      }
      const st: Stage = { id: `s${n++}`, op: c.name, kind: KIND[c.name] ?? c.name.toUpperCase(), arg: argOf(c), children: [], depth, column: undefined };
      if (c.name === "extract") {
        for (const [k, a] of Object.entries(c.kwargs)) if (a.plan) { const sub = chain(a.plan, depth + 1, k); if (sub[0]) { sub[sub.length - 1]!.column = k; st.children.push(...link(sub)); } }
        for (const a of c.args) if (a.plan) { const sub = chain(a.plan, depth + 1, "(named from the page)"); if (sub[0]) { sub[sub.length - 1]!.column = "(named from the page)"; st.children.push(...link(sub)); } }
      }
      out.push(st);
    }
    return out;
  };
  // a chain renders as a list; nest each chain under its first stage so columns read as branches
  const link = (sts: Stage[]): Stage[] => { if (sts.length <= 1) return sts; const [head, ...rest] = sts; rest.forEach((r) => { r.chain = true; }); head!.children = [...rest, ...head!.children]; return [head!]; };
  return chain(p, 0);
}
export function flatStages(sts: Stage[]): Stage[] { const out: Stage[] = []; const go = (s: Stage) => { out.push(s); s.children.forEach(go); }; sts.forEach(go); return out; }

export type RunEvent = { topic?: string; phase?: string; ts?: number; item?: number[]; detail?: Record<string, unknown>; error?: { code?: string; op?: string; message?: string; subject?: string; hint?: string }; raised?: boolean; url?: string; [k: string]: unknown };
export type StageStat = { count: number; errors: { code?: string; message?: string; raised?: boolean }[]; last?: number;
  /** each item's state at this stage, by its index path ("3", "3.1"; "" outside a fan-out) */ items?: Record<string, ItemState>;
  /** a fan-out stage: how many items it fanned out to, per the item it ran in */ fanBy?: Record<string, number>;
  /** the fan-out stage whose items this stage runs over */ feed?: string;
  /** a timed stage (fetch, interaction): how long each finished run took, and the ones still running (seconds) */ durations?: number[]; inflight?: number[]; /** items this stage fanned out to so far (a select_all's matches, a paginate's pages) */ fanout: number; /** how many times it is expected to run: the fan-out of the nearest EACH / PAGES above it */ expected?: number;
  /** how many separate fan-outs made up `fanout` (a select_all run once per page: 40 fan-outs of ~7) */ fanouts?: number;
  /** the width its items run at: at most `limit` at once, bounded by the `bound` pool (http slots / browser pages) */ parallel?: { limit: number; bound: string } };

/** the pool's occupancy at a moment of the run (sampled while it is live) */
export type Resources = { at: number; httpUsed: number; httpTotal: number; pagesUsed: number; pagesTotal: number; waiting: number;
  /** the server's process tree (it + its browsers): resident memory (MB), CPU (% of one core), process count */ memMb?: number; cpuPct?: number; procs?: number };
/** every pool sample up to `upTo` */
export function resourcesOf(events: RunEvent[], upTo = events.length): Resources[] {
  const out: Resources[] = [];
  for (let i = 0; i < Math.min(upTo, events.length); i++) {
    const e = events[i]! as RunEvent & { http_total?: number; http_free?: number; pages_total?: number; pages_free?: number; waiting?: number; mem_mb?: number; cpu_pct?: number; procs?: number };
    if (e.topic !== "resources") continue;
    const prev = out[out.length - 1];
    out.push({ at: i, httpTotal: e.http_total ?? prev?.httpTotal ?? 0, httpUsed: e.http_total !== undefined ? e.http_total - (e.http_free ?? 0) : prev?.httpUsed ?? 0,
      pagesTotal: e.pages_total ?? prev?.pagesTotal ?? 0, pagesUsed: e.pages_total !== undefined ? e.pages_total - (e.pages_free ?? 0) : prev?.pagesUsed ?? 0, waiting: e.waiting ?? 0,
      memMb: e.mem_mb, cpuPct: e.cpu_pct, procs: e.procs });
  }
  return out;
}

/** what a stage DOES, for colour: fetches the network, fans out, finds, reads, interacts with the page, shapes rows */
export type Action = "network" | "fanout" | "find" | "read" | "interact" | "shape";
const ACTION: Record<string, Action> = {
  resolve: "network", paginate: "network", download: "network", goto: "network",
  select_all: "fanout", links: "fanout", select: "find",
  attr: "read", text_content: "read", number: "read", date: "read", datetime: "read", map: "read",
  click: "interact", write: "interact", scroll: "interact", wait_for: "interact", hover: "interact", press: "interact",
  extract: "shape", project: "shape", merge: "shape", limit: "shape", filter: "shape",
};
export const actionOf = (op: string): Action => ACTION[op] ?? "shape";
export const ACTION_COLOUR: Record<Action, string> = { network: "#2563eb", fanout: "#7c3aed", find: "#0891b2", read: "#16a34a", interact: "#ea580c", shape: "#64748b" };

/** Attribute events 0..upTo to stages: a `plan.step` event counts on the stage with the same op
 * and argument (identical stages share them; the root fetch takes the first); an `error` event counts
 * on the stage whose op it names; untraced stages (casts, columns, emit) count as their parent. */
/** each event's STAGE (its card), by index: steps / fan-outs / errors by attribution; a page's own events
 * (fetch, snapshot, navigation, retries) go to the fetch stage open for that item; else null */
export function eventStages(sts: Stage[], events: RunEvent[]): (string | null)[] {
  const into: (string | null)[] = new Array(events.length).fill(null);
  stageStats(sts, events, events.length, into);
  return into;
}

export function stageStats(sts: Stage[], events: RunEvent[], upTo = events.length, into?: (string | null)[]): Record<string, StageStat> {
  const all = flatStages(sts); const out: Record<string, StageStat> = {};
  for (const s of all) out[s.id] = { count: 0, errors: [], fanout: 0, items: {}, fanBy: {}, durations: [], inflight: [] };
  const seen: Record<string, number> = {};
  // what runs just before a stage (the stage it follows in a sequence, else the one it branches from),
  // skipping stages the executor does not trace: an event goes first to the stage that follows the last one
  const pred: Record<string, Stage | undefined> = {};
  const link2 = (list: Stage[], before: Stage | undefined) => { let b = before; for (const st of list) { pred[st.id] = b; st.children.filter((c) => !c.chain).forEach((c) => link2([c], st)); link2(st.children.filter((c) => c.chain), st); b = st; } };
  link2(sts, undefined);
  const traced = (st: Stage | undefined): Stage | undefined => { let x = st; while (x && UNTRACED.has(x.op)) x = pred[x.id]; return x; };
  // items run concurrently, so "the stage that ran last" is kept PER ITEM (its index path); an item's
  // first step follows the last stage of the item it fanned out of
  const lastBy: Record<string, Stage | undefined> = {};
  const lastOf = (key: string): Stage | undefined => { let k: string | null = key; while (k !== null) { if (lastBy[k]) return lastBy[k]; k = k === "" ? null : k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : ""; } return undefined; };
  // a fetch / an interaction is TIMED: from its step to the next step (or the end) of the same item
  const open: Record<string, { st: Stage; ts: number }> = {};
  const close = (key: string, ts: number | undefined) => { const o = open[key]; if (!o) return; if (ts !== undefined) out[o.st.id]!.durations!.push(ts - o.ts); delete open[key]; };
  let lastFan: Stage | undefined;
  const n = Math.min(upTo, events.length);
  for (let i = 0; i < n; i++) {
    const e = events[i]!; const key = (e.item as number[] | undefined)?.join(".") ?? "";
    if (e.topic === "plan" && e.phase === "step") {
      const op = String(e.detail?.op ?? ""); const sel = e.detail?.selector as string | undefined;
      let cands = all.filter((s) => s.op === op && (sel ? s.arg === sel : true));
      if (!cands.length && !sel) cands = all.filter((s) => s.op === op);
      close(key, e.ts);
      if (!cands.length) { lastBy[key] = undefined; continue; }
      const last = lastOf(key);
      const next = last ? cands.filter((s) => traced(pred[s.id]) === last) : [];
      let st: Stage;
      if (next.length === 1) st = next[0]!;
      else {
        if (next.length > 1) cands = next;
        // several stages with the same op and argument (the root fetch and the per-record fetches):
        // the root takes the un-itemed event; the rest are shared round-robin
        const deep = cands.filter((s) => s.depth > 0);
        if (cands.length > 1 && key === "" && cands[0]!.depth === 0) st = cands[0]!;
        else { const pool = key !== "" && deep.length ? deep : cands; const sk = `${op}|${sel ?? ""}`; const k = seen[sk] ?? 0; seen[sk] = k + 1; st = pool[k % pool.length]!; }
      }
      const o = out[st.id]!; o.count++; o.last = i; lastBy[key] = st; if (into) into[i] = st.id;
      if (!o.items![key]) o.items![key] = "done";
      if ((TIMED.has(op)) && e.ts !== undefined) open[key] = { st, ts: e.ts };
    } else if (e.topic === "plan" && e.phase === "item") {
      close(key, e.ts);
    } else if (e.topic === "plan" && (e.phase === "done" || e.phase === "row") && key === "") {
      close("", e.ts);
    } else if (e.topic === "plan" && e.phase === "fanout") {
      const op = String(e.detail?.op ?? ""); const sel = e.detail?.selector as string | undefined; const cnt = Number(e.detail?.n ?? 0);
      const st = all.find((s) => s.op === op && (!sel || s.arg === sel)) ?? all.find((s) => s.op === op);
      if (st) { const o = out[st.id]!; o.fanout += cnt; o.fanouts = (o.fanouts ?? 0) + 1; o.fanBy![key] = (o.fanBy![key] ?? 0) + cnt; o.last = i; lastFan = st; if (into) into[i] = st.id; }
    } else if (e.topic === "plan" && e.phase === "parallel") {
      // a fan-out starting: its width belongs to the stage that just fanned out
      const lim = Number(e.detail?.limit ?? 0); const bound = String(e.detail?.bound ?? "http");
      if (lastFan && lim) { const o = out[lastFan.id]!; o.parallel = { limit: Math.max(o.parallel?.limit ?? 0, lim), bound }; }
    } else if (e.topic === "error" && e.error) {
      // the failing stage: the step this item just ran (when its op matches), else its op + selector
      // (as the subject, or quoted in the message), else the first stage with that op
      const op = e.error.op; const subj = e.error.subject; const msg = e.error.message ?? ""; const last = lastBy[key];
      const st = (last && last.op === op ? last : undefined) ?? all.find((s) => s.op === op && !!s.arg && s.arg === subj) ?? all.find((s) => s.op === op && !!s.arg && msg.includes(`'${s.arg}'`)) ?? all.find((s) => s.op === op);
      if (st) {
        const o = out[st.id]!; o.errors.push({ code: e.error.code, message: e.error.message, raised: e.raised !== false }); o.last = i;
        // raised: the item FAILED; returned (an optional miss): the value is MISSING
        o.items![key] = e.raised === false ? "missing" : "failed";
        if (into) into[i] = st.id;
      }
    } else if (into && (e.topic === "snapshot" || e.topic?.startsWith("network") || e.topic === "loop" || e.topic === "resource" || e.topic === "action" || e.topic === "rrweb" || e.topic === "dom")) {
      // a page's own events: the fetch / action stage open for this item (else its last stage)
      const o = open[key]; into[i] = o ? o.st.id : lastBy[key]?.id ?? null;
    }
  }
  // what is still running at this moment, and for how long
  const now = n ? events[n - 1]!.ts : undefined;
  if (now !== undefined) for (const o of Object.values(open)) out[o.st.id]!.inflight!.push(now - o.ts);
  // stages the executor does not trace (casts, columns, emit, merge): they run as often as the stage before them
  const walk = (st: Stage, parentCount: number) => { const o = out[st.id]!; if (UNTRACED.has(st.op) && o.count === 0 && parentCount > 0) o.count = parentCount; st.children.forEach((c) => walk(c, o.count)); };
  sts.forEach((st, i) => walk(st, i > 0 ? out[sts[i - 1]!.id]!.count : 0));
  // expected runs: a stage in a sequence after an EACH / PAGES runs once per item it fanned out to:
  // carry the fan-out (and WHICH stage fanned out -- `feed`) along the sequence and into branches
  const FAN = new Set(["select_all", "paginate", "links"]);
  // ops on the WHOLE collection (run once per collection; their columns run once per item)
  const WHOLE = new Set(["extract", "project", "merge", "limit", "filter"]);
  type Src = { n: number; feed: string } | undefined;
  const seq = (list: Stage[], outer: Src, pending?: Src) => {
    let exp = outer; let items: Src = pending;
    for (const st of list) {
      const o = out[st.id]!;
      if (!WHOLE.has(st.op) && items !== undefined) { exp = items; items = undefined; }
      if (exp !== undefined) { o.expected = exp.n; o.feed = exp.feed; }
      if (FAN.has(st.op) && o.fanout > 0) items = { n: o.fanout, feed: st.id };
      const inner = WHOLE.has(st.op) ? items ?? exp : exp;
      st.children.filter((c) => !c.chain).forEach((c) => seq([c], inner));
      // the rest of a chain continues this sequence: what this stage fanned out to is still pending
      seq(st.children.filter((c) => c.chain), exp, items);
    }
  };
  seq(sts, undefined);
  return out;
}

/** An item's state at a stage: it ran (done), its value was missing (an optional miss), it failed. */
export type ItemState = "done" | "missing" | "failed";
/** A stage's items as GROUPS of cells -- one group per item of the fan-out above (the table rows of
 * each book), or a single group -- each cell done / missing / failed / pending (not reached yet). */
export type ItemGroups = { groups: { key: string; cells: (ItemState | "pending")[] }[]; pendingGroups: number };
export function itemGroups(stat: StageStat | undefined, feed: StageStat | undefined): ItemGroups {
  const items = stat?.items ?? {}; const expected = stat?.expected ?? 0;
  const keys = Object.keys(items);
  const prefix = (k: string) => (k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : "");
  const idx = (k: string) => Number(k.includes(".") ? k.slice(k.lastIndexOf(".") + 1) : k);
  const fanBy = feed?.fanBy ?? {};
  // grouped when the items sit one level under the fan-out's own items (a table per book)
  const grouped = keys.length > 0 && keys.every((k) => prefix(k) !== "" && prefix(k) in fanBy);
  if (!grouped) {
    const size = Math.max(expected, keys.length);
    const cells: (ItemState | "pending")[] = Array.from({ length: size }, () => "pending");
    const sorted = keys.sort((a, b) => idx(a) - idx(b));
    // items without a fan-out index (the root) fill from the front; indexed ones sit at their index
    sorted.forEach((k, j) => { const at = k === "" || prefix(k) !== "" ? j : idx(k); if (at < size) cells[at] = items[k]!; else cells.push(items[k]!); });
    return { groups: keys.length || size ? [{ key: "", cells }] : [], pendingGroups: 0 };
  }
  const groups = Object.entries(fanBy).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([g, size]) => {
    const cells: (ItemState | "pending")[] = Array.from({ length: size }, () => "pending");
    for (const k of keys) if (prefix(k) === g) { const at = idx(k); if (at < size) cells[at] = items[k]!; }
    return { key: g, cells };
  });
  // parents that have not fanned out yet: their groups are still to come
  const parents = feed?.expected ?? 0;
  return { groups, pendingGroups: Math.max(0, parents - groups.length) };
}
/** ops whose DURATION is shown (they wait on the network or the page) */
const TIMED = new Set(["resolve", "paginate", "click", "write", "scroll", "wait_for", "goto", "download", "hover", "press"]);
const UNTRACED = new Set(["number", "date", "datetime", "map", "extract", "project", "merge", "limit", "filter", "alias", "download"]);

/** max and average of a resource over the samples (skipping samples without it) */
export function resourceSummary(samples: Resources[], key: "memMb" | "cpuPct"): { now?: number; max?: number; avg?: number } {
  const xs = samples.map((r) => r[key]).filter((x): x is number => typeof x === "number");
  if (!xs.length) return {};
  return { now: xs[xs.length - 1], max: Math.max(...xs), avg: xs.reduce((a, b) => a + b, 0) / xs.length };
}

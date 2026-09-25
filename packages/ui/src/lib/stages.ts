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

export type RunEvent = { topic?: string; phase?: string; ts?: number; detail?: Record<string, unknown>; error?: { code?: string; op?: string; message?: string; subject?: string; hint?: string }; raised?: boolean; url?: string; [k: string]: unknown };
export type StageStat = { count: number; errors: { code?: string; message?: string }[]; last?: number; /** items this stage fanned out to so far (a select_all's matches, a paginate's pages) */ fanout: number; /** how many times it is expected to run: the fan-out of the nearest EACH / PAGES above it */ expected?: number;
  /** how many separate fan-outs made up `fanout` (a select_all run once per page: 40 fan-outs of ~7) */ fanouts?: number;
  /** the width its items run at: at most `limit` at once, bounded by the `bound` pool (http slots / browser pages) */ parallel?: { limit: number; bound: string } };

/** the pool's occupancy at a moment of the run (sampled while it is live) */
export type Resources = { at: number; httpUsed: number; httpTotal: number; pagesUsed: number; pagesTotal: number; waiting: number };
/** every pool sample up to `upTo` */
export function resourcesOf(events: RunEvent[], upTo = events.length): Resources[] {
  const out: Resources[] = [];
  for (let i = 0; i < Math.min(upTo, events.length); i++) {
    const e = events[i]! as RunEvent & { http_total?: number; http_free?: number; pages_total?: number; pages_free?: number; waiting?: number };
    if (e.topic !== "resources") continue;
    out.push({ at: i, httpTotal: e.http_total ?? 0, httpUsed: (e.http_total ?? 0) - (e.http_free ?? 0), pagesTotal: e.pages_total ?? 0, pagesUsed: (e.pages_total ?? 0) - (e.pages_free ?? 0), waiting: e.waiting ?? 0 });
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
export function stageStats(sts: Stage[], events: RunEvent[], upTo = events.length): Record<string, StageStat> {
  const all = flatStages(sts); const out: Record<string, StageStat> = {};
  for (const s of all) out[s.id] = { count: 0, errors: [], fanout: 0 };
  const seen: Record<string, number> = {};
  // what runs just before a stage (the stage it follows in a sequence, else the one it branches from),
  // skipping stages the executor does not trace: an event goes first to the stage that follows the last one
  const pred: Record<string, Stage | undefined> = {};
  const link2 = (list: Stage[], before: Stage | undefined) => { let b = before; for (const st of list) { pred[st.id] = b; st.children.filter((c) => !c.chain).forEach((c) => link2([c], st)); link2(st.children.filter((c) => c.chain), st); b = st; } };
  link2(sts, undefined);
  const traced = (st: Stage | undefined): Stage | undefined => { let x = st; while (x && UNTRACED.has(x.op)) x = pred[x.id]; return x; };
  let lastStage: Stage | undefined; let lastFan: Stage | undefined;
  for (let i = 0; i < Math.min(upTo, events.length); i++) {
    const e = events[i]!;
    if (e.topic === "plan" && e.phase === "step") {
      const op = String(e.detail?.op ?? ""); const sel = e.detail?.selector as string | undefined;
      let cands = all.filter((s) => s.op === op && (sel ? s.arg === sel : true));
      if (!cands.length && !sel) cands = all.filter((s) => s.op === op);
      if (!cands.length) { lastStage = undefined; continue; }
      const next = lastStage ? cands.filter((s) => traced(pred[s.id]) === lastStage) : [];
      if (next.length === 1) { const st = next[0]!; out[st.id]!.count++; out[st.id]!.last = i; lastStage = st; continue; }
      if (next.length > 1) cands = next;
      // several stages with the same op and argument (the root fetch and the per-record fetches; two
      // attr("text") reads): the root takes the first event, the rest are shared round-robin
      const key = `${op}|${sel ?? ""}`; const k = seen[key] ?? 0; seen[key] = k + 1;
      const st = cands.length === 1 ? cands[0]! : !sel && cands[0]!.depth === 0 ? (k === 0 ? cands[0]! : cands[1 + ((k - 1) % (cands.length - 1))]!) : cands[k % cands.length]!;
      out[st.id]!.count++; out[st.id]!.last = i; lastStage = st;
    } else if (e.topic === "plan" && e.phase === "fanout") {
      const op = String(e.detail?.op ?? ""); const sel = e.detail?.selector as string | undefined; const n = Number(e.detail?.n ?? 0);
      const st = all.find((s) => s.op === op && (!sel || s.arg === sel)) ?? all.find((s) => s.op === op);
      if (st) { const o = out[st.id]!; o.fanout += n; o.fanouts = (o.fanouts ?? 0) + 1; o.last = i; lastFan = st; }
    } else if (e.topic === "plan" && e.phase === "parallel") {
      // a fan-out starting: its width belongs to the stage that just fanned out
      const lim = Number(e.detail?.limit ?? 0); const bound = String(e.detail?.bound ?? "http");
      if (lastFan && lim) { const o = out[lastFan.id]!; o.parallel = { limit: Math.max(o.parallel?.limit ?? 0, lim), bound }; }
    } else if (e.topic === "error" && e.error) {
      // the failing stage: its op + selector (as the subject, or quoted in the message), else the
      // step that just ran, else the first stage with that op
      const op = e.error.op; const subj = e.error.subject; const msg = e.error.message ?? "";
      const st = all.find((s) => s.op === op && !!s.arg && s.arg === subj) ?? all.find((s) => s.op === op && !!s.arg && msg.includes(`'${s.arg}'`))
        ?? (lastStage && lastStage.op === op ? lastStage : undefined) ?? all.find((s) => s.op === op);
      if (st) { out[st.id]!.errors.push({ code: e.error.code, message: e.error.message }); out[st.id]!.last = i; }
    }
  }
  // stages the executor does not trace (casts, columns, emit, merge): they run as often as the stage before them
  const walk = (st: Stage, parentCount: number) => { const o = out[st.id]!; if (UNTRACED.has(st.op) && o.count === 0 && parentCount > 0) o.count = parentCount; st.children.forEach((c) => walk(c, o.count)); };
  sts.forEach((st, i) => walk(st, i > 0 ? out[sts[i - 1]!.id]!.count : 0));
  // expected runs: a stage under an EACH / PAGES runs once per item it fanned out to
  // a stage in a sequence after an EACH / PAGES runs once per item it fanned out to: carry the
  // fan-out along the sequence (the top-level list; a column's chained stages) and into branches
  const FAN = new Set(["select_all", "paginate", "links"]);
  // ops on the WHOLE collection (run once per collection; their columns run once per item)
  const WHOLE = new Set(["extract", "project", "merge", "limit", "filter"]);
  const seq = (list: Stage[], outer: number | undefined, pending?: number) => {
    let exp = outer; let items: number | undefined = pending;
    for (const st of list) {
      const o = out[st.id]!;
      if (!WHOLE.has(st.op) && items !== undefined) { exp = items; items = undefined; }
      if (exp !== undefined) o.expected = exp;
      if (FAN.has(st.op) && o.fanout > 0) items = o.fanout;
      const inner = WHOLE.has(st.op) ? items ?? exp : exp;
      st.children.filter((c) => !c.chain).forEach((c) => seq([c], inner));
      // the rest of a chain continues this sequence: what this stage fanned out to is still pending
      seq(st.children.filter((c) => c.chain), exp, items);
    }
  };
  seq(sts, undefined);
  return out;
}
const UNTRACED = new Set(["number", "date", "datetime", "map", "extract", "project", "merge", "limit", "filter", "alias", "download"]);

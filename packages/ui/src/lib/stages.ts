/** The plan as STAGES (an EXPLAIN): what each call of the plan does, as a tree -- the spine
 * (fetch → pages → each record) and, under a record, one branch per column (find → read →
 * cast), a followed page nesting its own. Live events from a run are attributed to stages
 * (the executor's `plan.step` events carry the op and its selector), so the tree can show the
 * plan being realised: how many times each stage ran, which are active, where errors happened. */

import { calls, splitAlias, type Plan } from "./plan";

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
      if (c.name === "alias") continue;
      const st: Stage = { id: `s${n++}`, op: c.name, kind: KIND[c.name] ?? c.name.toUpperCase(), arg: argOf(c), children: [], depth, column: undefined };
      if (c.name === "extract") {
        for (const [k, a] of Object.entries(c.kwargs)) if (a.plan) { const sub = chain(a.plan, depth + 1, k); if (sub[0]) { sub[sub.length - 1]!.column = k; st.children.push(...link(sub)); } }
        for (const a of c.args) if (a.plan) { const { value } = splitAlias(a.plan); const sub = chain(value, depth + 1, "(named from the page)"); if (sub[0]) { sub[sub.length - 1]!.column = "(named from the page)"; st.children.push(...link(sub)); } }
      }
      out.push(st);
    }
    return out;
  };
  // a chain renders as a list; nest each chain under its first stage so columns read as branches
  const link = (sts: Stage[]): Stage[] => { if (sts.length <= 1) return sts; const [head, ...rest] = sts; head!.children = [...rest, ...head!.children]; return [head!]; };
  return chain(p, 0);
}
export function flatStages(sts: Stage[]): Stage[] { const out: Stage[] = []; const go = (s: Stage) => { out.push(s); s.children.forEach(go); }; sts.forEach(go); return out; }

export type RunEvent = { topic?: string; phase?: string; ts?: number; detail?: Record<string, unknown>; error?: { code?: string; op?: string; message?: string; subject?: string; hint?: string }; raised?: boolean; url?: string; [k: string]: unknown };
export type StageStat = { count: number; errors: { code?: string; message?: string }[]; last?: number };

/** Attribute events 0..upTo to stages: a `plan.step` event counts on the stage with the same op
 * and argument (identical stages share them; the root fetch takes the first); an `error` event counts
 * on the stage whose op it names; untraced stages (casts, columns, emit) count as their parent. */
export function stageStats(sts: Stage[], events: RunEvent[], upTo = events.length): Record<string, StageStat> {
  const all = flatStages(sts); const out: Record<string, StageStat> = {};
  for (const s of all) out[s.id] = { count: 0, errors: [] };
  const seen: Record<string, number> = {};
  for (let i = 0; i < Math.min(upTo, events.length); i++) {
    const e = events[i]!;
    if (e.topic === "plan" && e.phase === "step") {
      const op = String(e.detail?.op ?? ""); const sel = e.detail?.selector as string | undefined;
      let cands = all.filter((s) => s.op === op && (sel ? s.arg === sel : true));
      if (!cands.length) cands = all.filter((s) => s.op === op);
      if (!cands.length) continue;
      // several stages with the same op and argument (the root fetch and the per-record fetches; two
      // attr("text") reads): the root takes the first event, the rest are shared round-robin
      const key = `${op}|${sel ?? ""}`; const k = seen[key] ?? 0; seen[key] = k + 1;
      const st = cands.length === 1 ? cands[0]! : !sel && cands[0]!.depth === 0 ? (k === 0 ? cands[0]! : cands[1 + ((k - 1) % (cands.length - 1))]!) : cands[k % cands.length]!;
      out[st.id]!.count++; out[st.id]!.last = i;
    } else if (e.topic === "error" && e.error) {
      const op = e.error.op; const st = all.find((s) => s.op === op && (!e.error!.subject || s.arg === e.error!.subject)) ?? all.find((s) => s.op === op);
      if (st) { out[st.id]!.errors.push({ code: e.error.code, message: e.error.message }); out[st.id]!.last = i; }
    }
  }
  // stages the executor does not trace (casts, columns, emit, merge): they run as often as the stage before them
  const walk = (st: Stage, parentCount: number) => { const o = out[st.id]!; if (UNTRACED.has(st.op) && o.count === 0 && parentCount > 0) o.count = parentCount; st.children.forEach((c) => walk(c, o.count)); };
  sts.forEach((st, i) => walk(st, i > 0 ? out[sts[i - 1]!.id]!.count : 0));
  return out;
}
const UNTRACED = new Set(["number", "date", "datetime", "map", "extract", "project", "merge", "limit", "filter", "alias", "download"]);

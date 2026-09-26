/** A FIXED layout of a plan's nodes (the run never moves it: nothing jumps as a run plays). The main
 * chain runs left to right on lane 0; each sub-plan (an extract column, an action sequence, a name read)
 * branches off the node it runs on onto its own lane below, left to right again; the output (project /
 * merge) sits at the far right with every column flowing into it. */

import type { PlanModel, PNode } from "./plan";

const SHAPING = new Set(["extract", "project", "merge"]);
/** the step a node is SHOWN as: itself, the step it is the same as, or -- for a shaping step -- what it shapes */
export function visible(m: PlanModel, addr: string): string {
  let a = addr;
  for (let k = 0; a && k < 50; k++) { const n = m.byAddr.get(a); if (!n) return a; if (n.same) { a = n.same; continue; } if (SHAPING.has(n.op)) { a = n.input; continue; } return a; }
  return a;
}
/** the output columns each shown step fills (a column's last step, or the list its rows are read from) */
export function outputsOf(m: PlanModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of m.columns) { const v = visible(m, c.from); if (!v) continue; out.set(v, [...(out.get(v) ?? []), c.name]); }
  return out;
}

/** the column a branch leads to (the nearest column below it), for its lane's name */
function columnOf(m: PlanModel, n: PNode): string | undefined {
  const byInput = (a: string) => m.nodes.filter((x) => x.input === a || (x.input && m.byAddr.get(x.input)?.same === a));
  let cur: PNode | undefined = n;
  for (let k = 0; cur && k < 40; k++) { if (cur.column) return cur.column; cur = byInput(cur.addr)[0]; }
  return undefined;
}

export type Pos = { x: number; y: number; col: number; lane: number };
export type Layout = {
  pos: Map<string, Pos>; // "" = the root object
  edges: { from: string; to: string }[];
  /** the lanes of sub-plans: where each starts and what it is (a column's name) */
  lanes: { lane: number; label: string; host: string; first: string; y: number }[];
  width: number; height: number;
  /** the columns flowing into the output: (column's last node -> output node) */
  outputs: { from: string; to: string; name: string }[];
};

export const COL_W = 186, LANE_H = 98, CARD_W = 164, CARD_H = 80, PAD = 16;

export function layoutOf(m: PlanModel): Layout {
  const col = new Map<string, number>([["", 0]]), lane = new Map<string, number>([["", 0]]);
  const lanes: Layout["lanes"] = [];
  let nextLane = 1;
  const output = new Set<string>();
  // SHAPING (extract / project / merge) is not a phase: not shown -- its outputs are marked on the steps that make them
  const shown = m.nodes.filter((n) => !n.same && !SHAPING.has(n.op));
  const parentOf = (n: PNode) => visible(m, n.input);
  const used = new Set<string>(); // a node whose lane has been continued by a child
  for (const n of shown) {
    if (output.has(n.addr)) continue;
    const p = parentOf(n);
    const inCol = col.get(p) ?? 0; const inLane = lane.get(p) ?? 0;
    // the first child of a node continues its lane -- unless it starts a sub-plan (a column) or the lane is taken:
    // then it BRANCHES onto a lane of its own, below
    const branch = !!n.host || used.has(p);
    if (branch) {
      const l = nextLane++; lane.set(n.addr, l); col.set(n.addr, inCol + 1);
      const hostOp = n.host ? m.byAddr.get(n.host)?.op : undefined;
      const label = n.host
        ? (n.seg?.startsWith("kw:") ? n.seg.slice(3) : hostOp === "step" ? "then" : !hostOp ? "the column's name, read from the page" : hostOp === "filter" ? "keep when" : hostOp === "extract" && n.seg?.startsWith("arg:") ? "a column named from the page" : n.seg ?? "")
        : columnOf(m, n) ?? "";
      lanes.push({ lane: l, label, host: p, first: n.addr, y: 0 });
    } else { lane.set(n.addr, p === "" ? 0 : inLane); col.set(n.addr, (p === "" ? 0 : inCol) + 1); }
    used.add(p);
  }
  const maxCol = Math.max(0, ...[...col.values()]);
  for (const a of output) { col.set(a, maxCol + 1); lane.set(a, 0); }
  // COMPACT: each lane moves up to the first row below its host's where nothing else sits in its columns
  // (a column's nested sub-columns sit to the right: the next column's lane can share their rows' left side)
  const span = new Map<number, [number, number]>();
  for (const [a, l] of lane) { if (a === "") continue; const c = col.get(a)!; const sp = span.get(l); span.set(l, sp ? [Math.min(sp[0], c), Math.max(sp[1], c)] : [c, c]); }
  const rowOf = new Map<number, number>([[0, 0]]); const taken: [number, number, number][] = []; // [row, from, to]
  for (const [a, l] of lane) if (l === 0 && a !== "") { const c = col.get(a)!; taken.push([0, c, c]); }
  for (const L of lanes) {
    const [from, to] = span.get(L.lane) ?? [0, 0];
    const hostRow = rowOf.get(lane.get(L.host) ?? 0) ?? 0;
    let r = hostRow + 1;
    while (taken.some(([tr, f, t]) => tr === r && !(to < f || from > t))) r++;
    rowOf.set(L.lane, r); taken.push([r, from, to]);
  }
  for (const [a, l] of lane) lane.set(a, rowOf.get(l) ?? l);
  for (const L of lanes) L.lane = rowOf.get(L.lane) ?? L.lane;
  const rows = Math.max(0, ...[...rowOf.values()]) + 1;
  // lanes in order of creation; compact y
  const pos = new Map<string, Pos>();
  for (const [a, c] of col) { const l = lane.get(a) ?? 0; pos.set(a, { col: c, lane: l, x: PAD + c * COL_W, y: PAD + l * LANE_H }); }
  for (const L of lanes) L.y = PAD + L.lane * LANE_H;
  const edges = shown.map((n) => ({ from: parentOf(n), to: n.addr })).filter((e) => pos.has(e.from) && pos.has(e.to));
  const outputs: Layout["outputs"] = [];
  const width = PAD * 2 + (Math.max(...[...col.values()]) + 1) * COL_W;
  const height = PAD * 2 + rows * LANE_H;
  return { pos, edges, lanes, width, height, outputs };
}

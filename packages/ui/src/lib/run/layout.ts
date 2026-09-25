/** A FIXED layout of a plan's nodes (the run never moves it: nothing jumps as a run plays). The main
 * chain runs left to right on lane 0; each sub-plan (an extract column, an action sequence, a name read)
 * branches off the node it runs on onto its own lane below, left to right again; the output (project /
 * merge) sits at the far right with every column flowing into it. */

import type { PlanModel } from "./plan";

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
  const output = new Set(m.nodes.filter((n) => (n.op === "project" || n.op === "merge") && n.depth === 0).map((n) => n.addr));
  for (const n of m.nodes) {
    if (output.has(n.addr)) continue;
    const inCol = col.get(n.input) ?? 0; const inLane = lane.get(n.input) ?? 0;
    if (n.host) {
      // a sub-plan: its own lane, starting beside the node it runs on
      const l = nextLane++; lane.set(n.addr, l); col.set(n.addr, inCol + 1);
      const hostOp = m.byAddr.get(n.host)?.op;
      const label = n.seg?.startsWith("kw:") ? n.seg.slice(3) : hostOp === "step" ? "then" : !hostOp ? "the column's name, read from the page" : hostOp === "filter" ? "keep when" : n.seg ?? "";
      lanes.push({ lane: l, label, host: n.host, first: n.addr, y: 0 });
    } else {
      // the same lane as its input, one column on (a sub-plan's later steps follow its first, on its lane)
      lane.set(n.addr, n.input === "" ? 0 : inLane); col.set(n.addr, (n.input === "" ? 0 : inCol) + 1);
    }
  }
  const maxCol = Math.max(0, ...[...col.values()]);
  for (const a of output) { col.set(a, maxCol + 1); lane.set(a, 0); }
  // lanes in order of creation; compact y
  const pos = new Map<string, Pos>();
  for (const [a, c] of col) { const l = lane.get(a) ?? 0; pos.set(a, { col: c, lane: l, x: PAD + c * COL_W, y: PAD + l * LANE_H }); }
  for (const L of lanes) L.y = PAD + L.lane * LANE_H;
  const edges = m.nodes.map((n) => ({ from: n.input, to: n.addr })).filter((e) => pos.has(e.from) && pos.has(e.to));
  const outputs = [...output].flatMap((o) => m.columns.map((c) => ({ from: c.from, to: o, name: c.name })));
  const width = PAD * 2 + (Math.max(...[...col.values()]) + 1) * COL_W;
  const height = PAD * 2 + nextLane * LANE_H;
  return { pos, edges, lanes, width, height, outputs };
}

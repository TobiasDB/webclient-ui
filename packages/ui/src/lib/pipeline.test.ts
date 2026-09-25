import { describe, expect, it } from "vitest";
import { stagesOf, stageStats, flatStages, type RunEvent } from "./stages";
import { compile, addNode, emptyGraph, opOf } from "./graph";

describe("fan-out", () => {
  it("a select_all's matches become the expected runs of the stages after it", () => {
    let g = emptyGraph("https://x/");
    const add = (p: string, n: string, a: unknown[] = [], extra = {}) => { const r = addNode(g, p, opOf(n, a), {}, extra); g = r.graph; return r.id; };
    const page = add(g.root, "resolve"); const li = add(page, "select_all", ["li.r"]);
    const t = add(li, "select", ["h3"]); add(t, "attr", ["text"], { output: "title" });
    const sts = stagesOf(compile(g)); const all = flatStages(sts);
    const ev: RunEvent[] = [
      { topic: "plan", phase: "step", detail: { op: "resolve" } },
      { topic: "plan", phase: "fanout", detail: { op: "select_all", selector: "li.r", n: 7 } },
      ...Array.from({ length: 3 }, () => ({ topic: "plan", phase: "step", detail: { op: "select", selector: "h3" } })),
    ];
    const st = stageStats(sts, ev);
    const each = all.find((s) => s.op === "select_all")!; const find = all.find((s) => s.op === "select")!;
    expect(st[each.id]!.fanout).toBe(7);
    expect(st[each.id]!.expected).toBeUndefined();
    expect(st[find.id]!.count).toBe(3);
    expect(st[find.id]!.expected).toBe(7);
    expect(all.find((s) => s.op === "attr")!.chain).toBe(true);
  });
});

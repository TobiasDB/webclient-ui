import { describe, expect, it } from "vitest";
import { flatStages, stageStats, stagesOf } from "./stages";
import { compile, addNode, emptyGraph, opOf } from "./graph";

describe("stages", () => {
  it("explains a plan as a stage tree and counts steps per stage", () => {
    let g = emptyGraph("https://x/");
    const add = (p: string, n: string, a: unknown[] = [], extra = {}) => { const r = addNode(g, p, opOf(n, a), {}, extra); g = r.graph; return r.id; };
    const page = add(g.root, "resolve"); const li = add(page, "select_all", ["li"]);
    const t = add(li, "select", ["h3 a"]); add(t, "attr", ["title"], { output: "title" });
    const pr = add(li, "select", ["p.price"]); add(pr, "attr", ["text"], { output: "price" });
    const sts = stagesOf(compile(g));
    const flat = flatStages(sts).map((s) => `${s.kind}:${s.arg ?? ""}${s.column ? "→" + s.column : ""}`);
    expect(flat).toEqual(["FETCH:", "EACH:li", "COLUMNS:", "FIND:h3 a", "READ:title→title", "FIND:p.price", "READ:text→price", "EMIT:"]);
    const ev = (op: string, selector?: string) => ({ topic: "plan", phase: "step", detail: { op, selector } });
    const stats = stageStats(sts, [ev("resolve"), ev("select_all", "li"), ev("select", "h3 a"), ev("select", "h3 a"), ev("attr", "title"), { topic: "error", error: { op: "select", code: "select.no_match", subject: "p.price" } }]);
    const byKey = Object.fromEntries(flatStages(sts).map((s) => [`${s.kind}:${s.arg ?? ""}`, stats[s.id]!]));
    expect(byKey["FETCH:"]!.count).toBe(1); expect(byKey["FIND:h3 a"]!.count).toBe(2); expect(byKey["FIND:p.price"]!.errors.length).toBe(1);
  });
  it("shares events between identical stages and counts untraced stages from their parent", () => {
    let g = emptyGraph("https://x/");
    const add = (p: string, n: string, a: unknown[] = [], extra = {}) => { const r = addNode(g, p, opOf(n, a), {}, extra); g = r.graph; return r.id; };
    const page = add(g.root, "resolve"); const li = add(page, "select_all", ["li"]);
    const a = add(li, "select", ["p.a"]); const ra = add(a, "attr", ["text"]); add(ra, "number", [], { output: "a" });
    const b = add(li, "select", ["p.b"]); add(b, "attr", ["text"], { output: "b" });
    const sts = stagesOf(compile(g));
    const ev = (op: string, selector?: string) => ({ topic: "plan", phase: "step", detail: { op, selector } });
    const stats = stageStats(sts, [ev("resolve"), ev("select_all", "li"), ev("select", "p.a"), ev("attr", "text"), ev("select", "p.b"), ev("attr", "text")]);
    const reads = flatStages(sts).filter((s) => s.op === "attr").map((s) => stats[s.id]!.count);
    expect(reads).toEqual([1, 1]);
    const cast = flatStages(sts).find((s) => s.op === "number")!; expect(stats[cast.id]!.count).toBe(1);
  });
});

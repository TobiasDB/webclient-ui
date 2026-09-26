// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/detail-run.json";
import type { Plan } from "../plan";
import type { RunEvent } from "../stages";
import { lineage, nodeOf, planModel } from "./plan";
import { RunFolder, expectedOf, followItem, stateAt } from "./state";

// a real run (the package, recorded): resolve -> select_all("li.r") -> extract(n=select(b).attr(text),
// detail=select(a).attr(href).resolve().select(p.desc).attr(text)) -> project
const plan = fixture.plan as unknown as Plan;
const events = fixture.events as unknown as RunEvent[];
const m = planModel(plan);

describe("the plan, by address", () => {
  it("addresses every step and sub-plan step as the package stamps them", () => {
    expect(m.nodes.map((n) => n.addr)).toEqual(["0", "2", "4", "4/kw:n/0", "4/kw:n/2", "4/kw:detail/0", "4/kw:detail/2", "4/kw:detail/4", "4/kw:detail/6", "4/kw:detail/8", "6"]);
    const types = Object.fromEntries(m.nodes.map((n) => [n.addr, n.type]));
    expect(types).toMatchObject({ "0": "Document", "2": "Collection", "4": "Collection", "4/kw:detail/2": "Reference", "4/kw:detail/4": "Document", "4/kw:n/2": "Value", "6": "Rows" });
  });
  it("knows what runs once per item, and which columns are projected from where", () => {
    expect(m.byAddr.get("2")!.per).toBeNull();
    expect(m.byAddr.get("4/kw:detail/4")!.per).toBe("2");
    expect(m.columns).toEqual([{ name: "n", from: "4/kw:n/2" }, { name: "detail", from: "4/kw:detail/8" }]);
    expect(lineage(m, "4/kw:detail/8").map((n) => n.addr)).toEqual(["0", "2", "4/kw:detail/0", "4/kw:detail/2", "4/kw:detail/4", "4/kw:detail/6", "4/kw:detail/8"]);
    expect(nodeOf(m, "4/sub/1")?.addr).toBe("4");
  });
});

describe("the run at a moment", () => {
  const end = stateAt(events, m);
  it("places every step's result, per item", () => {
    expect(end.nodes.get("2")!.insts.get("")!.result).toMatchObject({ kind: "Collection", n: 2 });
    expect(end.nodes.get("4/kw:n/2")!.insts.get("1")!.result!.preview).toBe("1");
    expect(end.nodes.get("4/kw:detail/4")!.done).toBe(2);
    expect(expectedOf(end, m, "4/kw:detail/4")).toBe(2);
  });
  it("knows every page: which step and item opened it, its snapshots and requests", () => {
    const pages = [...end.docs.values()];
    expect(pages).toHaveLength(3);
    const detail = pages.filter((d) => d.step === "4/kw:detail/4").map((d) => d.item).sort();
    expect(detail).toEqual(["0", "1"]);
    for (const d of pages) { expect(d.snaps.length).toBeGreaterThan(0); expect(d.requests.length).toBeGreaterThan(0); }
  });
  it("knows which item each projected row came from", () => {
    expect(end.rows.map((r) => [r.item, r.row])).toEqual([["0", { n: "0", detail: "about" }], ["1", { n: "1", detail: "about" }]]);
  });
  it("is the same folded incrementally (live / playback) as from scratch", () => {
    const f = new RunFolder();
    for (let t = 0; t <= events.length; t += 7) f.at(events, m, t);
    const inc = f.at(events, m, events.length);
    expect(inc.rows).toEqual(end.rows);
    expect([...inc.nodes.keys()].sort()).toEqual([...end.nodes.keys()].sort());
    const back = f.at(events, m, 10); // a scrub back
    expect(back.n).toBe(10); expect(back.rows).toEqual([]);
  });
  it("follows the oldest item in flight", () => {
    const mid = events.findIndex((e) => (e as { step?: string }).step === "4/kw:detail/4" && e.phase === "step" && (e.item ?? [])[0] === 1);
    expect(followItem(stateAt(events, m, mid + 1), m)).toBe("0");
  });
});

// pagination + a nested fan-out: resolve -> paginate(2 pages) -> select_all("li.r") (3 per page, numbered 0-5
// across both) -> extract(n=select(b).attr(text), info=select(a).attr(href).resolve().select_all("tr")
// .extract(v=select(td).attr(text)).project()) -> project
import paged from "./fixtures/paged-run.json";
import { locate, resolveHops } from "./locate";

describe("where a step ran", () => {
  const pm = planModel(paged.plan as unknown as Plan);
  const ps = stateAt(paged.events as unknown as RunEvent[], pm);
  it("a record numbered across pages is on ITS page, at its index there", () => {
    const w = locate(pm, ps, "6/kw:n/2", "4")!;
    const page2 = [...ps.docs.values()].find((d) => d.url?.endsWith("/p2"))!;
    expect(w.doc).toBe(page2.id);
    expect(w.hops).toEqual([{ sel: "li.r", index: 1 }, { sel: "b" }]);
    const dom = new DOMParser().parseFromString(paged.pages["/p2"], "text/html");
    expect(resolveHops(dom, w.hops).el?.textContent).toBe("4");
  });
  it("a nested item (a row of a record's own detail page) is on that page, at its row", () => {
    const addr = pm.nodes.find((n) => n.addr.startsWith("6/kw:info/8/kw:v/") && n.op === "select")!.addr;
    const w = locate(pm, ps, addr, "4.1")!;
    const detail4 = ps.nodes.get("6/kw:info/4")!.insts.get("4")!.result!.document_id;
    expect(w.doc).toBe(detail4);
    expect(w.hops).toEqual([{ sel: "tr", index: 1 }, { sel: "td" }]);
  });
  it("the page a detail step opened is the page", () => {
    const w = locate(pm, ps, "6/kw:info/4", "2")!;
    expect(w.doc).toBe(ps.nodes.get("6/kw:info/4")!.insts.get("2")!.result!.document_id);
    expect(w.hops).toEqual([]);
  });
});

import { layoutOf } from "./layout";
describe("the layout", () => {
  it("puts the chain on lane 0, each column on its own lane beside what it runs on, the output at the end", () => {
    const L = layoutOf(m);
    const at = (a: string) => L.pos.get(a)!;
    expect([at("0").lane, at("2").lane, at("4").lane]).toEqual([0, 0, 0]);
    expect(at("4/kw:n/0").lane).toBe(1); expect(at("4/kw:n/2").lane).toBe(1);
    expect(at("4/kw:detail/0").lane).toBe(2); expect(at("4/kw:detail/8").lane).toBe(2);
    expect(at("4/kw:n/0").col).toBe(at("2").col + 1);      // beside the collection it runs on each item of
    expect(at("6").col).toBeGreaterThan(at("4/kw:detail/8").col); // the output after every column
    expect(L.outputs.map((o) => o.name)).toEqual(["n", "detail"]);
  });
});

describe("a page step still running", () => {
  it("shows the link it follows, on the page it leaves", () => {
    const pm = planModel(paged.plan as unknown as Plan); const evs = paged.events as unknown as RunEvent[];
    // the moment record 2's detail resolve has started, not finished
    const k = evs.findIndex((e) => (e as { step?: string }).step === "6/kw:info/4" && e.phase === "step" && (e.item ?? [])[0] === 2);
    const w = locate(pm, stateAt(evs, pm, k + 1), "6/kw:info/4", "2")!;
    expect(w.hops).toEqual([{ sel: "li.r", index: 2 }, { sel: "a" }]);
  });
});

// an IMPERATIVE script, recorded (wc.record): a loop over the cards reading each, following each card's link --
// the trace carries the plan it compiled to and where each recorded read (@n3) landed in it
import recorded from "./fixtures/recorded-loop.json";
describe("a recorded script plays as its plan", () => {
  const rm = planModel(recorded.plan as unknown as Plan, undefined, recorded.steps as Record<string, string>);
  const rs = stateAt(recorded.events as unknown as RunEvent[], rm);
  it("places every recorded read on its step, per item", () => {
    expect(rs.nodes.get("4/kw:b_text/2")!.insts.get("1")!.result!.preview).toBe("1");
    expect(rs.nodes.get("4/kw:p_desc_text/4")!.done).toBe(3);
    expect(rs.nodes.get("2")!.insts.get("")!.result).toMatchObject({ kind: "Collection", n: 3 });
    expect([...rs.docs.values()].filter((d) => d.step === "4/kw:p_desc_text/4").map((d) => d.item).sort()).toEqual(["0", "1", "2"]);
  });
  it("finds the item's element on the page", () => {
    const w = locate(rm, rs, "4/kw:b_text/2", "1")!;
    expect(w.hops).toEqual([{ sel: "li.r", index: 1 }, { sel: "b" }]);
  });
});

import { pageChain } from "./locate";
describe("the pages an item went through", () => {
  it("a nested crawl: the listing (the link followed), then the detail page (the row read)", () => {
    const pm = planModel(paged.plan as unknown as Plan); const ps = stateAt(paged.events as unknown as RunEvent[], pm);
    const addr = pm.nodes.find((n) => n.addr.startsWith("6/kw:info/8/kw:v/") && n.op === "select")!.addr;
    const chain = pageChain(pm, ps, addr, "4.1");
    const page2 = [...ps.docs.values()].find((d) => d.url?.endsWith("/p2"))!.id;
    expect(chain.map((c) => c.doc)).toEqual([page2, ps.nodes.get("6/kw:info/4")!.insts.get("4")!.result!.document_id]);
    expect(chain[0]!.hops).toEqual([{ sel: "li.r", index: 1 }, { sel: "a" }]);   // the link record 4 followed
    expect(chain[0]!.opens).toBe("6/kw:info/4");
    expect(chain[1]!.hops).toEqual([{ sel: "tr", index: 1 }, { sel: "td" }]);    // row 1 on its detail page
  });
  it("one page when the step is on the page the plan started on", () => {
    const pm = planModel(paged.plan as unknown as Plan); const ps = stateAt(paged.events as unknown as RunEvent[], pm);
    expect(pageChain(pm, ps, "6/kw:n/2", "4")).toHaveLength(1);
  });
});

describe("a limit keeps its items", () => {
  it("steps after select_all(...).limit(n) run per item of the select_all (the item's match is its index there)", () => {
    const c = (name: string, ...args: unknown[]) => [{ kind: "get" as const, name }, { kind: "call" as const, name, args: args.map((v) => ({ value: v })), kwargs: {} }];
    const p: Plan = { root: "Reference", steps: [...c("resolve"), ...c("select_all", "li"), ...c("limit", 6), { kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: { t: { plan: { root: "Document", steps: [...c("select", "a"), ...c("attr", "href")] } } } }] };
    const pm = planModel(p);
    expect(pm.byAddr.get("6/kw:t/0")!.per).toBe("2");
    expect(pm.byAddr.get("6/kw:t/0")!.cap).toBe(6);
  });
});

describe("the same step is one node", () => {
  it("columns that start with the same select share it: one node, the reads branching off it", () => {
    const c = (name: string, ...args: unknown[]) => [{ kind: "get" as const, name }, { kind: "call" as const, name, args: args.map((v) => ({ value: v })), kwargs: {} }];
    const col = (...steps: ReturnType<typeof c>[]) => ({ plan: { root: "Document" as const, steps: steps.flat() } });
    const p: Plan = { root: "Reference", steps: [...c("resolve"), ...c("select_all", "li"), { kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: { title: col(c("select", "h3 a"), c("attr", "title")), link: col(c("select", "h3 a"), c("attr", "href")) } }] };
    const pm = planModel(p);
    expect(pm.byAddr.get("4/kw:link/0")!.same).toBe("4/kw:title/0");
    expect(pm.members.get("4/kw:title/0")).toEqual(["4/kw:title/0", "4/kw:link/0"]);
    const L = layoutOf(pm);
    expect(L.pos.has("4/kw:link/0")).toBe(false);
    expect(L.edges).toContainEqual({ from: "4/kw:title/0", to: "4/kw:link/2" });   // href read off the one select
    expect(L.pos.get("4/kw:link/2")!.lane).not.toBe(L.pos.get("4/kw:title/2")!.lane);
  });
});

describe("a run among other things", () => {
  it("strict: only events stamped with the plan's id are its run", () => {
    const pm = planModel(fixture.plan as unknown as Plan, "p1", undefined, true);
    const evs = [
      { topic: "plan", phase: "result", step: "0", plan_id: "p1", detail: { op: "resolve", kind: "Document", document_id: "doc:1" }, document_id: "doc:1" },
      { topic: "snapshot", phase: "fetch", document_id: "doc:9", url: "http://elsewhere/" },  // the script did this too
    ] as unknown as RunEvent[];
    const st = stateAt(evs, pm);
    expect(st.nodes.get("0")!.done).toBe(1);
    expect(st.docs.has("doc:9")).toBe(false);
  });
});

describe("a select_all step itself", () => {
  it("found every match: all of them, not the first", () => {
    const w = locate(m, stateAt(events, m), "2", "")!;
    expect(w.many).toBe(true);
    expect(w.hops).toEqual([{ sel: "li.r", all: true }]);
  });
});

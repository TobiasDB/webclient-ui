// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { currentStep, pageOffsets, pageOfItem, pageSpans, placeOf, targetOf } from "./replay";
import type { RunEvent, Stage } from "./stages";

const page = (n: number, from: number) => new DOMParser().parseFromString(`<ol>${Array.from({ length: n }, (_, i) => `<li class="r"><h3><a>book ${from + i}</a></h3></li>`).join("")}</ol>`, "text/html");

describe("replay targets", () => {
  it("a step inside a fan-out acts on ITS item's record, not the first match", () => {
    const d = page(5, 0);
    const t = targetOf(d, "select", "h3 a", "li.r", 3);
    expect(t.how).toBe("item"); expect(t.els.map((e) => e.textContent)).toEqual(["book 3"]);
    // the fan-out itself: every record, this item's emphasised
    const f = targetOf(d, "select_all", "li.r", "li.r", 2);
    expect(f.els.length).toBe(5); expect(f.own?.textContent).toBe("book 2");
  });
  it("a paginated fan-out: item 7 is the 3rd record of page 2", () => {
    const events = [
      { topic: "plan", phase: "fanout", document_id: "p1", detail: { n: 5 } },
      { topic: "plan", phase: "fanout", document_id: "p2", detail: { n: 5 } },
    ] as never[];
    const offs = pageOffsets(events, ["F", "F"], "F");
    expect(offs.get("p2")).toBe(5);
    const t = targetOf(page(5, 5), "select", "h3 a", "li.r", 7 - offs.get("p2")!);
    expect(t.els[0]?.textContent).toBe("book 7");
  });
  it("a page without the fan-out (a detail page): the step's selector on the page", () => {
    const d = new DOMParser().parseFromString('<h1>Detail</h1><p class="d">text</p>', "text/html");
    const t = targetOf(d, "select", "p.d", "li.r", 4);
    expect(t.how).toBe("page"); expect(t.els[0]?.textContent).toBe("text");
  });

  it("a record's page: the page whose span of the fan-out holds its index", () => {
    const events = [
      { topic: "plan", phase: "fanout", document_id: "p1", detail: { n: 20 } },
      { topic: "plan", phase: "fanout", document_id: "p2", detail: { n: 20 } },
    ] as never[];
    const spans = pageSpans(events, ["F", "F"], "F");
    expect(pageOfItem(spans, 7)).toEqual({ doc: "p1", local: 7 });
    expect(pageOfItem(spans, 27)).toEqual({ doc: "p2", local: 7 });
    expect(pageOfItem(spans, 40)).toBeNull();
  });
});

// the books plan's shape: EACH record (s0) -> FIND h3 a (s1, head) -> READ href (s2, chained) -> a detail page
// (d1, d2) where FIND description (s3) -> READ text (s4, chained) and EACH table tr (s5) -> READ td (s6)
const S = (id: string, op: string, children: Stage[] = [], chain = false, arg?: string): Stage => ({ id, op, kind: op, arg, children, depth: 0, chain });
const stages: Stage[] = [S("s0", "select_all", [S("s1", "select", [S("s2", "attr", [], true)]), S("s3", "select", [S("s4", "attr", [], true)]), S("s5", "select_all", [S("s6", "select")], false, "table tr")], false, "li.r")];
const all: Stage[] = []; const walk = (x: Stage) => { all.push(x); x.children.forEach(walk); }; stages.forEach(walk);
const feeds: Record<string, string> = { s1: "s0", s3: "s0", s6: "s5" };
const step = (item: number[], doc?: string, op = "select"): RunEvent => ({ topic: "plan", phase: "step", item, detail: { op }, ...(doc ? { document_id: doc } : {}) });
const fan = (item: number[], doc: string, n: number): RunEvent => ({ topic: "plan", phase: "fanout", item, detail: { op: "select_all", n }, document_id: doc });

describe("where a step happened", () => {
  it("a NESTED fan-out's item is on the page its parent's fan-out ran on -- not the first parent's", () => {
    const ev = [fan([], "list", 2), fan([0], "d0", 3), fan([1], "d1", 3), step([0, 2]), step([1, 0])];
    const so = [null, "s5", "s5", "s6", "s6"];
    expect(placeOf(ev, so, all, (s) => feeds[s], 3)).toMatchObject({ doc: "d0", local: 2 });
    expect(placeOf(ev, so, all, (s) => feeds[s], 4)).toMatchObject({ doc: "d1", local: 0 });
  });
  it("a read further down a chain is on the page the step before it found its element", () => {
    const ev = [fan([], "list", 2), step([1], "d1"), step([1], undefined, "attr")];
    expect(placeOf(ev, ["s0", "s3", "s4"], all, (s) => feeds[s], 2)).toMatchObject({ doc: "d1" });
  });
});

describe("follow", () => {
  it("stays with the oldest item in flight while parallel items interleave, then moves on", () => {
    const item = (k: number): RunEvent => ({ topic: "plan", phase: "item", item: [k], detail: { status: "ok" } });
    const ev = [step([0]), step([1]), step([0]), step([1]), item(0), step([1])];
    const so = ev.map(() => null);
    expect(currentStep(ev, so, 4, null)).toBe(2);  // item 1 was last, but item 0 is still going
    expect(currentStep(ev, so, 6, null)).toBe(5);  // item 0 done: item 1
  });
});

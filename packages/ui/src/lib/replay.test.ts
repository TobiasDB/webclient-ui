// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pageOffsets, pageOfItem, pageSpans, targetOf } from "./replay";

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

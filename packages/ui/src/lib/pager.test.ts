import { describe, expect, it } from "vitest";
import { code, fromHint, lastStop, stopNote, fromKwargs, fromLegacy, hintOf, toKwargs, type Pager } from "./pager";

const round = (p: Pager) => fromKwargs(toKwargs(p));

describe("pager", () => {
  it("round-trips every iterator through the paginate kwargs", () => {
    const cases: Pager[] = [
      { mode: "next", next: "", max_pages: 20 },
      { mode: "next", next: "li.next a", max_pages: 5 },
      { mode: "pages", param: "offset", start: 0, step: 20, stop: 80, max_pages: 20 },
      { mode: "pages", param: "page", step: 1, stop: { selector: "a.last", attr: "text" }, max_pages: 20 },
      { mode: "cursor", cursor: { selector: "a.more", attr: "data-after" }, param: "after", max_pages: 20 },
      { mode: "click", click: "button.more", records: "li.item", max_pages: 10 },
      { mode: "scroll", max_pages: 10 },
      { mode: "next", next: "", max_pages: 20, until: { selector: "time", attr: "datetime", cmp: "lt", value: "2026-01-01" }, filter: { selector: ".sold-out", attr: "", cmp: "missing", value: "" } },
    ];
    for (const p of cases) expect(round(p)).toMatchObject(p);
  });

  it("writes the package's spelling", () => {
    expect(code({ mode: "next", next: "", max_pages: 20 })).toBe(".paginate(next=wq.doc.next_link())");
    expect(code({ mode: "pages", param: "offset", start: 0, step: 20, stop: 80, max_pages: 5 })).toBe('.paginate(pages="offset", start=0, step=20, stop=80, max_pages=5)');
    expect(code({ mode: "next", next: "", max_pages: 20, until: { selector: "time", attr: "datetime", cmp: "lt", value: "2026-01-01" } }))
      .toBe('.paginate(next=wq.doc.next_link(), until=wq.doc.select("time").attr("datetime") < "2026-01-01")');
  });

  it("reads the old by= kwargs as the pager they meant", () => {
    expect(fromLegacy({ by: { value: "link" }, max_pages: { value: 5 } })).toMatchObject({ mode: "next", next: "", max_pages: 5 });
    expect(fromLegacy({ by: { value: "param" }, name: { value: "p" } })).toMatchObject({ mode: "pages", param: "p" });
    expect(fromKwargs({ by: { value: "click" }, next: { value: "button.more" } })).toMatchObject({ mode: "click", click: "button.more" });
    expect(fromKwargs({ by: { value: "action" }, action: { plan: { root: "Document", steps: [{ kind: "get", name: "scroll" }, { kind: "call", name: "scroll", args: [] }] } } })).toMatchObject({ mode: "scroll" });
  });

  it("builds a pager from a hint and finds the hint in the flags", () => {
    const flags = [{ name: "pagination", present: true, value: { modes: [{ mode: "pages", code: "", param: "page", start: 3, step: 1, stop: 9 }, { mode: "next", code: "", selector: 'a[rel="next"]' }] } }];
    const h = hintOf(flags)!;
    expect(fromHint(h.modes[0]!)).toMatchObject({ mode: "pages", param: "page", start: 3, stop: 9 });
    expect(fromHint(h.modes[1]!)).toMatchObject({ mode: "next", next: "" });
    expect(hintOf([{ name: "pagination", present: false, value: null }])).toBeNull();
  });

  it("says why a walk stopped, and flags a pager that never left page one", () => {
    const ev = [{ topic: "plan", phase: "result", detail: { op: "paginate", n: 1, fetched: 1, stop: "repeat" } }];
    const s = lastStop(ev)!;
    expect(stopNote(s).bad).toBe(true);
    expect(stopNote({ n: 3, fetched: 4, stop: "end" })).toEqual({ text: "3 pages of 4 fetched · stopped at the last page", bad: false });
  });
});

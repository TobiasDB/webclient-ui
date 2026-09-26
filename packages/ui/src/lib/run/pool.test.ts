import { describe, expect, it } from "vitest";
import fixture from "./fixtures/jobs-run.json";
import type { RunEvent } from "../stages";
import { poolAt } from "./pool";

// a real run (the lab's job board): the listing in a browser, then each job's detail page in one
const events = fixture.events as unknown as RunEvent[];

describe("the pool at a moment", () => {
  const end = poolAt(events);
  it("knows every page lease: the step and item that took it, and the page it rendered", () => {
    const pages = end.all.filter((l) => l.kind === "page");
    expect(pages.length).toBeGreaterThanOrEqual(5);           // the listing + 4 details
    expect(pages[0]!.step).toBe("0");                         // the listing's resolve
    const details = pages.filter((l) => l.step?.includes("kw:detail"));
    expect(new Set(details.map((l) => l.item))).toEqual(new Set(["0", "1", "2", "3"]));
    expect(details.every((l) => l.doc && l.url?.includes("/lab/jobs/detail"))).toBe(true);
    expect(end.held.filter((l) => l.kind === "page")).toHaveLength(0);  // all given back at the end
    expect(end.kinds.get("page")!.limit).toBeGreaterThan(0);
  });
  it("mid-run: what is held right then", () => {
    const i = events.findIndex((e) => e.topic === "resource" && (e.detail as { what?: string; kind?: string })?.what === "leased" && (e.detail as { kind?: string }).kind === "page" && String(e.step).includes("kw:detail"));
    const mid = poolAt(events, i + 1);
    expect(mid.held.some((l) => l.step?.includes("kw:detail"))).toBe(true);
    expect(mid.kinds.get("page")!.held).toBeGreaterThanOrEqual(1);
  });
});

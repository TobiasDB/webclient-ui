import { describe, expect, it } from "vitest";
import { addNode, compile, decompile, emptyGraph, opOf, setMod, updateNode, type Graph } from "./graph";
import { describe as describePlan } from "./plan";

/** Build the books graph the way a person does in the builder. */
function books(): Graph {
  let g = emptyGraph("https://books.toscrape.com/");
  const add = (parent: string, name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}, extra = {}) => { const r = addNode(g, parent, opOf(name, args, kwargs), {}, extra); g = r.graph; return r.id; };
  const page = add(g.root, "resolve", [], { browser: "auto" });
  g = setMod(g, page, opOf("paginate", [], { next: "li.next a", max_pages: 2 }));
  const li = add(page, "select_all", ["ol.row li"]);
  const a = add(li, "select", ["h3 a"]);
  add(a, "attr", ["title"], {}, { output: "title" });
  add(li, "select", ["p.price_color"]);
  const price = Object.values(g.nodes).find((n) => n.op?.args[0]?.value === "p.price_color")!.id;
  add(price, "attr", ["text"], {}, { output: "price" });
  const href = add(a, "attr", ["href"]);
  const detail = add(href, "resolve", [], { browser: "auto" }, { output: "detail" });
  const p = add(detail, "select", ["#product_description ~ p"]);
  add(p, "attr", ["text"], {}, { output: "description" });
  const tr = add(detail, "select_all", ["table tr"]);
  g = updateNode(g, tr, { output: "info" });
  const td = add(tr, "select", ["td"]);
  const th = { kind: "get" as const, name: "select" };
  add(td, "attr", ["text"], {}, { alias: [th, { kind: "call", name: "select", args: [{ value: "th" }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }] });
  return g;
}

describe("graph → plan", () => {
  it("compiles the books graph to the plan the package runs", () => {
    const d = describePlan(compile(books()));
    expect(d).toContain('Reference.resolve(browser="auto").paginate(next="li.next a", max_pages=2).select_all("ol.row li").extract(');
    expect(d).toContain('title=Document.select("h3 a").attr("title")');
    expect(d).toContain('price=Document.select("p.price_color").attr("text")');
    // the detail page: ONE resolve, its two outputs as a nested dict
    expect(d).toContain('Document.select("h3 a").attr("href").resolve(browser="auto").extract(description=Document.select("#product_description ~ p").attr("text"), info=Document.select_all("table tr").extract(Document.select("td").attr("text").alias(Document.select("th").attr("text"))).merge()).project()');
    expect(d.endsWith(".project()")).toBe(true);
  });
  it("round-trips through decompile", () => {
    const plan = compile(books());
    const again = compile(decompile(plan, "https://books.toscrape.com/"));
    expect(describePlan(again)).toBe(describePlan(plan));
  });
  it("a path compiles alone (the preview of one node)", () => {
    const g = books(); const tr = Object.values(g.nodes).find((n) => n.output === "info")!;
    expect(describePlan(compile(g, tr.id))).toBe('Reference.resolve(browser="auto").paginate(next="li.next a", max_pages=2).select_all("ol.row li").select("h3 a").attr("href").resolve(browser="auto").select_all("table tr")');
  });
  it("a page with one output is a dict, a single deep output flattens", () => {
    let g = emptyGraph("https://x/");
    const r = addNode(g, g.root, opOf("resolve")); g = r.graph;
    const h = addNode(g, r.id, opOf("select", ["h1"])); g = h.graph;
    g = addNode(g, h.id, opOf("attr", ["text"]), {}, { output: "title" }).graph;
    expect(describePlan(compile(g))).toBe('Reference.resolve().extract(title=Document.select("h1").attr("text")).project()');
  });
});

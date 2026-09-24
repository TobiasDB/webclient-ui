/** Fixture data for stories: the lab's shop page and a small trace, shaped exactly like the
 * API's JSON (captured from `webclient.lab` + `demo.py`'s trace). */
import type { Event, Flag, IndexedElement, PatternHint, PageCard } from "../types";

export const SHOP_HTML = `<!doctype html><html><head><title>Roasters Coffee</title></head><body>
<nav><a href="/lab/about">about</a><a href="/lab/login">sign in</a></nav>
<main><h1>Featured</h1>
<div class="card" data-rank="1"><h2 class="title">Aeropress</h2><a class="link" href="/lab/shop/items/1">view</a><span class="price" data-price="39.00">$39</span></div>
<div class="card" data-rank="2"><h2 class="title">Grinder</h2><a class="link" href="/lab/shop/items/2">view</a><span class="price" data-price="129.00">$129</span></div>
<div class="card" data-rank="3"><h2 class="title">Gooseneck Kettle</h2><a class="link" href="/lab/shop/items/3">view</a><span class="price" data-price="59.00">$59</span></div>
</main><footer>(c) Roasters</footer></body></html>`;

export const SHOP_CARD: PageCard = { url: "http://lab/lab/shop", final_url: "http://lab/lab/shop", kind: "html", status_code: 200, title: "Roasters Coffee", description: null, flags: [], final_tier: "static", escalation: ["static"] };

export const SHOP_SKELETON = `# skeleton: an HTML-tag outline (open tags only, indentation = nesting). "…"=sample text  "← RECORD LIST"=the repeating dataset region (select_all target)
<body>
  <nav>
    <a href>  "about"
    <a href>  "sign in"
  <main>  ← RECORD LIST · 3 items · select_all("div.card")
    <h1>  "Featured"
    <div class="card" data-rank="1">
      <h2 class="title">  "Aeropress"
      <a class="link" href>  "view"
      <span class="price" data-price="39.00">  "$39"
    <div class="card" data-rank="2">
      <h2 class="title">  "Grinder"
      <a class="link" href>  "view"
      <span class="price" data-price="129.00">  "$129"
    <div class="card" data-rank="3">
      <h2 class="title">  "Gooseneck Kettle"
      <a class="link" href>  "view"
      <span class="price" data-price="59.00">  "$59"
  <footer>  "(c) Roasters"`;

export const SHOP_PATTERNS: PatternHint[] = [
  { name: "record_list", kind: "dom", subject: "div.card", count: 3, confidence: 1, for_: ["extract"], evidence: "3 structurally identical siblings under <main>" },
  { name: "page_template", kind: "dom", subject: "baef87c9d5393ee3", count: 1, confidence: 1, for_: ["crawl"], evidence: "<body>(<nav>(…" },
];

export const SPA_FLAGS: Flag[] = [
  { name: "spa", present: true, confidence: 0.97, remedy: "browser", value: null, signals: [
    { name: "empty_root_shell", flag: "spa", stage: "static", confidence: 0.9, reason: "an empty hydration root a bundle populates" },
    { name: "empty_body_scripted", flag: "spa", stage: "static", confidence: 0.7, reason: "a near-empty body with a script" },
  ] },
];

export const SHOP_CONTROLS: IndexedElement[] = [
  { index: 1, role: "link", name: "about", kind: "interactive", selector: "html > body > nav > a:nth-of-type(1)", repeats: 1 },
  { index: 2, role: "link", name: "sign in", kind: "interactive", selector: "html > body > nav > a:nth-of-type(2)", repeats: 1 },
  { index: 3, role: "link", name: "view", kind: "interactive", selector: "a.link", repeats: 3 },
];
export const SHOP_RECORDS: IndexedElement[] = [{ index: 1, role: "record", name: "3 items", kind: "content", selector: "div.card", repeats: 3 }];
export const SHOP_FIELDS: IndexedElement[] = [
  { index: 1, role: "text", name: "Aeropress", kind: "content", selector: "h2.title", repeats: 1 },
  { index: 2, role: "link", name: "view", kind: "content", selector: "a.link", repeats: 1 },
  { index: 3, role: "text", name: "$39", kind: "content", selector: "span.price", repeats: 1 },
];
export const SHOP_ROWS = [
  { title: "Aeropress", price: "$39", link: "http://lab/lab/shop/items/1" },
  { title: "Grinder", price: "$129", link: "http://lab/lab/shop/items/2" },
  { title: "Gooseneck Kettle", price: "$59", link: "http://lab/lab/shop/items/3" },
];

const t = 1790151986.37;
export const TRACE_EVENTS: Event[] = [
  { topic: "snapshot", n: 1, seq: 1, ts: t + 0.007, document_id: "doc:000-002", phase: "fetch", url: "http://lab/lab/shop", kind: "html", status_code: 200, asset: "snapshots/1.html", tiers: ["static"] },
  { topic: "network.navigation", n: 2, seq: 2, ts: t + 0.008, document_id: "doc:000-002", status_code: 200, method: "get", url: "http://lab/lab/shop" },
  { topic: "error", n: 3, seq: 3, ts: t + 0.02, document_id: "doc:000-002", raised: false, error: { type: "LookupError", code: "select.no_match", message: "no match for '.nope'", remedy: "fix_selector", op: "select", subject: "doc:000-002", hint: "No element matches the selector; re-read the skeleton and pick a selector it shows." } },
  { topic: "loop", n: 4, seq: 1, ts: t + 0.1, loop: "locate", phase: "round", round: 1, detail: { budget: 20 } },
  { topic: "loop", n: 5, seq: 2, ts: t + 0.11, loop: "crawl", phase: "round", round: 1, detail: { pages: 0, frontier: 1 } },
  { topic: "loop", n: 6, seq: 3, ts: t + 0.12, loop: "crawl", phase: "decision", round: 1, detail: { picks: ["http://lab/lab/shop"], count: 1 } },
  { topic: "snapshot", n: 7, seq: 1, ts: t + 0.3, document_id: "doc:000-004", phase: "fetch", url: "http://lab/lab/about", kind: "html", status_code: 200, asset: "snapshots/7.html", tiers: ["static"] },
  { topic: "loop", n: 8, seq: 4, ts: t + 0.31, loop: "locate", phase: "done", round: 3, detail: { result: "found" } },
  { topic: "loop", n: 9, seq: 5, ts: t + 0.5, loop: "resolve", phase: "waiting", round: 1, detail: { ask: { reason: "render?", options: ["browser"] } } },
  { topic: "action", n: 10, seq: 1, ts: t + 1.2, document_id: "doc:000-009", action: "click", args: { selector: "#add" } },
  { topic: "snapshot", n: 11, seq: 2, ts: t + 1.4, document_id: "doc:000-009", phase: "action", url: "http://lab/lab/app", kind: "html", status_code: 200, asset: "snapshots/11.html", tiers: ["browser"] },
  { topic: "rrweb", n: 12, seq: 3, ts: t + 1.41, document_id: "doc:000-009", count: 9, asset: "rrweb/12.json" },
  { topic: "script", n: 13, seq: 4, ts: t + 1.42, document_id: "doc:000-009", script: "demo.title", phase: "load", detail: { result: "Cart" } },
  { topic: "resource", n: 14, seq: 6, ts: t + 1.5, source: "pool", detail: { what: "wait", kind: "page", waiting: 1, held: 4 } },
];

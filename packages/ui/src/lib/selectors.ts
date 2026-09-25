/** Selector candidates and field suggestions for a clicked element -- the reasoning behind the
 * selection card. A CANDIDATE is a selector that matches the clicked element inside the scope,
 * with how many elements it enumerates there: `li.card ×4`, `li ×21`, `main > li.card ×4`.
 * For select_all the interesting ones enumerate a GROUP (count > 1); for select the unique
 * ones (count 1) come first. Utility classes (tailwind-like) are kept out of the defaults
 * but stay available as toggles. */

import { looksLikeDate, toWhen } from "./plan";

/** Is a read MOSTLY a number (a price, a count, "In stock (22 available)") -- not a title that
 * happens to hold one? At most a few words around the digits. */
export const mostlyNumber = (v: string) => /\d/.test(v) && v.replace(/[\d.,\s£$€%()+-]/g, "").length <= 18 && v.length < 40;
/** Is a read MOSTLY a date (not a sentence that mentions one)? */
export const mostlyDate = (v: string) => looksLikeDate(v) && v.length <= 40;

export const UTILITY = /^(data-wc|wc-)|[0-9]|^(flex|grid|block|hidden|relative|absolute|border|rounded|text|font|p|m|px|py|mt|mb|ml|mr|w|h|gap|items|justify|bg|shadow|hover|focus|inline|min|max|overflow|truncate|whitespace|leading|tracking|uppercase|sm|md|lg|xl|space|divide|ring|outline|transition|duration|cursor|select|pointer|z|top|left|right|bottom|inset|col|row|order|flex-1|shrink|grow|self|place|content|list|decoration|underline|italic|not|group|peer|prose|container|sr-only|antialiased|table|align|object|aspect|opacity|mix|blur|filter|backdrop|scroll|snap|touch|will|resize|appearance|columns|break|box|float|clear|isolate|visible|invisible|collapse|static|fixed|sticky)(-|$)/;
export const semantic = (classes: string[]) => classes.filter((c) => !UTILITY.test(c));
const esc = (c: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(c) : c.replace(/([^\w-])/g, "\\$1"));

export type Candidate = { selector: string; count: number; /** the parts: depth of ancestors used */ depth: number; /** uses only tag/id/semantic classes */ clean: boolean; /** an ANCESTOR of the clicked element (the row when a cell was clicked) */ up?: number };

/** Every distinct selector built from the element (tag, id, its semantic classes) and up to
 * `depth` ancestors (each as tag or tag.class), that matches the element inside `root`, with
 * its match count -- deduplicated by (count, selector), cheap ones first. */
export function candidates(el: Element, root: ParentNode, depth = 3): Candidate[] {
  const own = partsOf(el);
  const chain: Element[] = []; let n = el.parentElement;
  while (n && chain.length < depth && n !== root && !["HTML", "BODY"].includes(n.tagName)) { if (n.tagName !== "TBODY") chain.push(n); n = n.parentElement; }
  const out = new Map<string, Candidate>();
  const tryOne = (raw: string, d: number, clean: boolean) => {
    const sel = portable(raw);
    if (!sel || out.has(sel)) return;
    let count = 0; try { const all = root.querySelectorAll(sel); if (![...all].includes(el)) return; count = all.length; } catch { return; }
    out.set(sel, { selector: sel, count, depth: d, clean });
  };
  // the element alone: tag · tag.class (each semantic class) · tag.all-semantic · #id · tag.utility (fallback)
  for (const p of own) tryOne(p.sel, 0, p.clean);
  // a stable ATTRIBUTE of its own (data-*, name, aria-label, title, for, type…): button[data-tab="Past"]
  const tag0 = el.tagName.toLowerCase();
  for (const at of [...el.attributes]) {
    const k = at.name; const v = at.value;
    if (!v || v.length > 60 || /^(class|id|style|href|src|srcset|d|data-wc.*|on.*)$/.test(k)) continue;
    if (!(/^data-/.test(k) || ["name", "aria-label", "title", "for", "type", "role", "placeholder", "value", "alt", "rel"].includes(k))) continue;
    tryOne(`${tag0}[${k}="${v.replace(/"/g, '\\"')}"]`, 0, true);
  }
  // positional forms, for an element with nothing of its own: after an id'd sibling (#desc ~ p),
  // the n-th of its kind under its parent (div > p:nth-of-type(2))
  const parent = el.parentElement;
  if (parent) {
    const tag = el.tagName.toLowerCase();
    let sib = el.previousElementSibling; while (sib && !sib.id) sib = sib.previousElementSibling;
    if (sib?.id) { tryOne(`#${esc(sib.id)} ~ ${tag}`, 1, true); if (el.previousElementSibling === sib) tryOne(`#${esc(sib.id)} + ${tag}`, 1, true); }
    const same = [...parent.children].filter((c) => c.tagName === el.tagName);
    if (same.length > 1) for (const a of partsOf(parent).filter((p) => p.clean).slice(0, 2)) tryOne(`${a.sel} > ${tag}:nth-of-type(${same.indexOf(el) + 1})`, 1, true);
  }
  // with one / two ancestors: "anc el" and "anc > el" for the leaf's clean forms
  const leafForms = own.filter((p) => p.clean).slice(0, 3);
  chain.slice(0, 2).forEach((anc, i) => {
    for (const a of partsOf(anc).filter((p) => p.clean).slice(0, 3)) for (const l of leafForms) { tryOne(`${a.sel} ${l.sel}`, i + 1, true); if (i === 0) tryOne(`${a.sel} > ${l.sel}`, 1, true); }
  });
  return [...out.values()].sort((a, b) => a.depth - b.depth || (b.clean ? 1 : 0) - (a.clean ? 1 : 0) || a.selector.length - b.selector.length);
}

/** A selector that means the same on the server: the browser inserts <tbody> into every table,
 * the raw HTML the server parses usually has none -- so `tbody` is never part of a selector. */
export function portable(sel: string): string {
  // compounds and the combinators between them; a compound whose TAG is tbody is dropped and the
  // combinators around it collapse to a descendant step (matches with or without the tbody)
  const toks = sel.trim().split(/(\s*[>+~]\s*|\s+)/).filter((t) => t !== "");
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const isComb = /^\s*[>+~]?\s*$/.test(t);
    if (!isComb && /^tbody(?![\w-])/i.test(t)) { if (out.length && /^\s*[>+~]?\s*$/.test(out[out.length - 1]!)) out[out.length - 1] = " "; if (i + 1 < toks.length && /^\s*[>+~]?\s*$/.test(toks[i + 1]!)) i++; continue; }
    out.push(t);
  }
  return out.join("").replace(/\s{2,}/g, " ").trim();
}

/** The forms of one element: [tag, tag.c1, tag.c2, tag.c1.c2, #id, tag.utility…] */
function partsOf(el: Element): { sel: string; clean: boolean }[] {
  const tag = el.tagName.toLowerCase(); const classes = [...el.classList].filter((c) => !/^(data-wc|wc-)/.test(c)); const sem = semantic(classes);
  const out: { sel: string; clean: boolean }[] = [{ sel: tag, clean: true }];
  if (el.id) out.push({ sel: `${tag}#${esc(el.id)}`, clean: true });
  for (const c of sem) out.push({ sel: `${tag}.${esc(c)}`, clean: true });
  if (sem.length > 1) out.push({ sel: `${tag}.${sem.map(esc).join(".")}`, clean: true });
  for (const c of classes.filter((c) => !sem.includes(c)).slice(0, 4)) out.push({ sel: `${tag}.${esc(c)}`, clean: false });
  return out;
}

/** How good a selector reads: a semantic class on the element (+3), a semantic class on an
 * ancestor (+2), an id (+3), a tag-only ancestor (+1), minus a little per extra part. */
function score(c: Candidate): number {
  const parts = c.selector.split(/\s+>?\s*/).filter(Boolean); const leaf = parts[parts.length - 1] ?? "";
  let s = 0;
  if (/#/.test(leaf)) s += 3; if (/\./.test(leaf)) s += c.clean ? 3 : 1;
  if (/\[[a-z-]+="/.test(leaf)) s += /\[(data-|name=|aria-label=|for=)/.test(leaf) ? 3.5 : 2;  // an identifying attribute
  if (/:nth-of-type/.test(c.selector)) s -= 2;  // position is the last resort: it breaks when the page shifts
  for (const a of parts.slice(0, -1)) s += /[.#]/.test(a) ? 2 : 1;
  return s - parts.length * 0.5 - c.selector.length * 0.01;
}
/** Candidates for select_all: ONE per enumerable group the element belongs to (a distinct
 * count > 1), the best-reading selector for each, smallest group first -- `ol.row li ×20`,
 * `li ×75`. `prefer` (a detected record count) puts that group first. */
export function groupCandidates(el: Element, root: ParentNode, prefer?: number): Candidate[] {
  const best = new Map<number, Candidate>();
  for (const c of candidates(el, root)) { if (c.count <= 1) continue; const cur = best.get(c.count); if (!cur || score(c) > score(cur)) best.set(c.count, c); }
  const out = [...best.values()];
  // the ancestors' own groups (a cell was clicked, the ROW repeats): the best one per ancestor level,
  // even when it has the same size as the element's own group (td ×7 and tr ×7 are different records)
  let anc = el.parentElement; let up = 1;
  while (anc && up <= 3 && anc !== root && !["HTML", "BODY"].includes(anc.tagName)) {
    const own = candidates(anc, root, 1).filter((c) => c.count > 1 && !out.some((o) => o.selector === c.selector)).sort((a, b) => score(b) - score(a));
    if (own[0]) out.push({ ...own[0], up });
    anc = anc.parentElement; up++;
  }
  return out.sort((a, b) => (a.count === prefer && !a.up ? -1 : 0) - (b.count === prefer && !b.up ? -1 : 0) || (a.up ?? 0) - (b.up ?? 0) || a.count - b.count);
}
/** Candidates for select: the unique ones (count 1) best-reading first, then one per group. */
export function uniqueCandidates(el: Element, root: ParentNode): Candidate[] {
  const all = candidates(el, root);
  const unique = all.filter((c) => c.count === 1).sort((a, b) => score(b) - score(a));
  return [...unique, ...groupCandidates(el, root)];
}

export type FieldSuggestion = { name: string; selector: string; attr: string; sample: string; coverage: number; /** read with a pattern */ pattern?: string; /** then .number() */ number?: boolean; /** then .date() */ date?: boolean };
/** a class that codes a number as a word (books.toscrape.com: `star-rating Three`) */
export const NUMBER_WORD = "(?i)\\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\\b";

/** What a group of records shares: the descendants (by a clean selector relative to the
 * record) present in most of the first records, with the attribute worth reading (text,
 * href, src, datetime) and a sample -- the suggested fields for select_all. */
export function suggestFields(records: Element[], max = 8): FieldSuggestion[] {
  const sample = records.slice(0, 6); if (!sample.length) return [];
  const seen = new Map<string, { attr: string; hits: number; sample: string; name: string }>();
  const first = sample[0]!;
  const add = (rel: string, attr: string, value: string, tag: string, suffix = "") => {
    const key = rel + "@" + attr; if (seen.has(key)) return;
    const hits = sample.filter((r) => { try { return !!r.querySelector(rel); } catch { return false; } }).length;
    seen.set(key, { attr, hits, sample: value.slice(0, 60), name: nameFromSelector(rel, tag) + suffix });
  };
  const walk = (node: Element, depth: number) => {
    if (depth > 5) return;
    for (let child of node.children) {
      // unwrap single-child wrappers (h3 > a, div.image_container > a > img): the leaf is the value
      while (child.children.length === 1 && !(child.textContent || "").trim().replace((child.firstElementChild!.textContent || "").trim(), "").trim()) child = child.firstElementChild!;
      const rel = relSelector(first, child); if (!rel) continue;
      const tag = child.tagName.toLowerCase(); const textish = (child.textContent || "").trim();
      if (tag === "a") { add(rel, "href", child.getAttribute("href") ?? "", tag); if (child.getAttribute("title")) add(rel, "title", child.getAttribute("title")!, tag, "_title"); if (textish) add(rel, "text", textish, tag, "_text"); continue; }
      if (tag === "img") { add(rel, "src", child.getAttribute("src") ?? "", tag); if (child.getAttribute("alt")) add(rel, "alt", child.getAttribute("alt")!, tag, "_alt"); continue; }
      if (tag === "time") { add(rel, "datetime", child.getAttribute("datetime") ?? textish, tag); continue; }
      if (textish && (child.children.length === 0 || textish.length <= 80)) { add(rel, "text", textish, tag); if (child.children.length && textish.length > 40) walk(child, depth + 1); continue; }
      if (!textish && child.classList.length > 1) { add(rel, "class", child.className, tag); if (child.children.length > 1) add(rel, "count", String(child.children.length), tag, "_count"); continue; }  // a value coded in the class (star-rating Three); its icons counted
      walk(child, depth + 1);
    }
  };
  walk(first, 0);
  const out: FieldSuggestion[] = [];
  for (const [key, s] of seen) if (s.hits >= Math.max(1, Math.ceil(sample.length * 0.6))) {
    const sel = key.slice(0, key.lastIndexOf("@"));
    // a number coded as a word in a class: offer it AS a number first (the star rating)
    if (s.attr === "class" && /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(s.sample)) out.push({ name: s.name.replace(/_?rating$/, "") + (s.name.includes("rating") ? "_rating" : "_number"), selector: sel, attr: "class", pattern: NUMBER_WORD, number: true, sample: `${/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(s.sample)![0]} → ${["zero","one","two","three","four","five","six","seven","eight","nine","ten"].indexOf(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(s.sample)![0].toLowerCase())}`, coverage: s.hits / sample.length });
    out.push({ name: s.name, selector: sel, attr: s.attr, sample: s.sample, coverage: s.hits / sample.length });
    // a date (a datetime attribute, a written date): offer it as a date too
    if ((s.attr === "datetime" || s.attr === "text") && mostlyDate(s.sample)) out.push({ name: `${s.name}_date`, selector: sel, attr: s.attr, date: true, sample: `${s.sample} → ${String(toWhen(s.sample))}`, coverage: s.hits / sample.length });
    // text with a number in it (a price, a stock count): offer the number too
    else if (s.attr === "text" && mostlyNumber(s.sample)) out.push({ name: `${s.name}_number`, selector: sel, attr: "text", number: true, sample: `${s.sample} → ${/-?\d[\d,]*(?:\.\d+)?/.exec(s.sample)![0].replace(/,/g, "")}`, coverage: s.hits / sample.length });
  }
  // unique names
  const taken = new Set<string>();
  for (const f of out) { let n = f.name; let i = 2; while (taken.has(n)) n = `${f.name}_${i++}`; taken.add(n); f.name = n; }
  return out.slice(0, max);
}

/** A selector for `el` relative to `root`: its cleanest unique form inside the root, else a short child path. */
export function relSelector(root: Element, el: Element): string {
  for (const p of partsOf(el).filter((p) => p.clean)) { try { const all = root.querySelectorAll(p.sel); if (all.length === 1 && all[0] === el) return p.sel; } catch { /* next */ } }
  const steps: string[] = []; let n: Element | null = el;
  while (n && n !== root) { const p: Element | null = n.parentElement; if (!p) break; if (n.tagName !== "TBODY") { const same = [...p.children].filter((c) => c.tagName === n!.tagName); steps.push(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase()); } n = p; }
  const path = portable(steps.reverse().join(" > "));
  try { const all = root.querySelectorAll(path); if (all.length === 1) return path; } catch { /* fall through */ }
  return path;
}

export function nameFromSelector(selector: string, tag: string): string {
  const leaf = selector.split(/\s*[> ]\s*/).filter(Boolean).pop() ?? selector;
  const cls = /\.([a-zA-Z0-9_-]+)/.exec(leaf)?.[1]; const id = /#([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const raw = cls ?? id ?? (tag === "a" ? "link" : tag === "img" ? "image" : tag === "time" ? "when" : tag === "h1" || tag === "h2" || tag === "h3" ? "title" : tag);
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
}

export type AttrRow = { attr: string; value: string; kind: "text" | "count" | "attribute"; /** read with a pattern, then .number() */ pattern?: string; number?: boolean; /** then .date() */ date?: boolean; label?: string };
/** Every attribute ANY of the elements has (text, own text, count, label, href, data-*, aria-*…),
 * the first value as the sample, plus the numeric reads worth having. */
export function attributesOfAll(els: Element[]): AttrRow[] {
  const out: AttrRow[] = []; const seen = new Set<string>();
  for (const el of els.slice(0, 30)) for (const a of attributesOf(el)) if (!seen.has(a.attr)) { seen.add(a.attr); out.push(a); }
  const extra: AttrRow[] = [];
  for (const a of out) {
    if (a.attr === "class" && /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(a.value)) extra.push({ attr: "class", value: a.value, kind: "attribute", pattern: NUMBER_WORD, number: true, label: "the number word in the class, as a number" });
    if ((a.attr === "text" || a.kind === "attribute") && a.attr !== "class" && mostlyDate(a.value)) extra.push({ attr: a.attr, value: a.value, kind: a.kind, date: true, label: `${a.attr} as a date → ${String(toWhen(a.value))}` });
    else if ((a.attr === "text" || a.kind === "attribute") && a.attr !== "class" && mostlyNumber(a.value)) extra.push({ attr: a.attr, value: a.value, kind: a.kind, number: true, label: `${a.attr} as a number` });
  }
  return [...extra, ...out];
}

/** Everything readable off one element: its text, its child count, every attribute. */
export function attributesOf(el: Element): AttrRow[] {
  const text = (el.textContent || "").trim();
  const out: AttrRow[] = [{ attr: "text", value: text.slice(0, 80), kind: "text" }];
  const own = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent?.trim()).filter(Boolean).join(" ");
  if (own && own !== text) out.push({ attr: "text:own", value: own.slice(0, 80), kind: "text" });
  if (el.children.length) out.push({ attr: "count", value: String(el.children.length), kind: "count" });
  // the element's label: <label for=id>, a wrapping <label>, aria-labelledby
  const d = el.ownerDocument;
  const lab = (el.id && d.querySelector(`label[for="${el.id}"]`)) || el.closest("label") || (el.getAttribute("aria-labelledby") && d.getElementById(el.getAttribute("aria-labelledby")!));
  if (lab && lab !== el) out.push({ attr: "label", value: (lab.textContent || "").trim().slice(0, 80), kind: "text" });
  const order = (n: string) => (n === "href" || n === "src" ? 0 : n.startsWith("data-") ? 1 : n.startsWith("aria-") ? 2 : 3);
  for (const a of [...el.attributes].sort((x, y) => order(x.name) - order(y.name))) if (a.name !== "class" && a.name !== "style" && !a.name.startsWith("data-wc")) out.push({ attr: a.name, value: a.value.slice(0, 80), kind: "attribute" });
  if (el.classList.length) out.push({ attr: "class", value: el.className.slice(0, 80), kind: "attribute" });
  return out;
}

/** does `sel` match EXACTLY `el` (one match, that element) under `root`? */
export function pointsTo(sel: string, el: Element, root: ParentNode): boolean {
  try { const all = root.querySelectorAll(sel); return all.length === 1 && all[0] === el; } catch { return false; }
}

/** A selector that points to THIS element and nothing else under `root` -- what an ACTION needs (a
 * click on the 3rd "Add to basket" must not click the 1st). The best readable candidate that matches
 * only it; else a structural path down from the nearest ancestor that is itself exactly
 * addressable (`#results > li:nth-of-type(3) > button`), else from the root. Always verified. */
export function exactSelector(el: Element, root: ParentNode = el.ownerDocument): string {
  for (const c of candidates(el, root)) if (c.count === 1 && pointsTo(c.selector, el, root)) return c.selector;
  // readable forms that only miss by position: keep them, add the position among their matches
  const step = (n: Element): string => {
    const tag = n.tagName.toLowerCase(); const p = n.parentElement; if (!p) return tag;
    const same = [...p.children].filter((c) => c.tagName === n.tagName);
    return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag;
  };
  const path: string[] = [step(el)];
  let n: Element | null = el.parentElement;
  while (n && n !== root && !["HTML"].includes(n.tagName)) {
    // an ancestor exactly addressable on its own: anchor the path there
    const anchor = candidates(n, root, 1).find((c) => c.count === 1 && c.clean && pointsTo(c.selector, n!, root));
    if (anchor) { const sel = `${anchor.selector} > ${path.join(" > ")}`; if (pointsTo(sel, el, root)) return sel; }
    path.unshift(step(n)); n = n.parentElement;
    const sel = path.join(" > "); if (n === root || n?.tagName === "HTML") { if (pointsTo(sel, el, root)) return sel; }
  }
  const full = path.join(" > "); if (pointsTo(full, el, root)) return full;
  return full;
}

/** THE PAGER: the package's `paginate(...)` as an editable value (spec: webclient docs/product/pagination.md).
 * A pager is ONE iterator -- next (a link) / pages (a URL-param integer iterator) / cursor (a token) / click /
 * scroll -- plus `until` (this page is the last) / `filter` (keep only these pages) and the bounds. The page's
 * detected hints (`doc.pagination()`) offer the iterators; nothing is guessed at run time.
 *
 * Pure: kwargs <-> Pager, a hint -> a Pager, the old `by=` kwargs -> a Pager, and the `.paginate(...)` code. */

import { call, type Arg, type Plan, type Step } from "./plan";

export type Mode = "next" | "pages" | "cursor" | "click" | "scroll";
export const MODES: Mode[] = ["next", "pages", "cursor", "click", "scroll"];

/** a page test: the first `selector` on the page, its `attr`, compared -- or just whether it is there */
export type Cond = { selector: string; attr: string; cmp: "exists" | "missing" | "eq" | "ne" | "lt" | "gt"; value: string };
export const CMPS: Cond["cmp"][] = ["exists", "missing", "eq", "ne", "lt", "gt"];
export const CMP_LABEL: Record<Cond["cmp"], string> = { exists: "is on the page", missing: "is not on the page", eq: "=", ne: "≠", lt: "<", gt: ">" };

export type Pager = {
  mode: Mode;
  /** next: "" follows rel=next / the HTTP Link header (`wq.doc.next_link()`); a selector: its href */
  next?: string;
  /** pages: the URL param, from `start` (unset: the URL's value) by `step` to `stop` (a number, or read off page one) */
  param?: string; start?: number; step?: number; stop?: number | { selector: string; attr: string };
  /** cursor: the token's element + attribute (carried in `param`) */
  cursor?: { selector: string; attr: string };
  /** click: the load-more control */
  click?: string;
  until?: Cond; filter?: Cond;
  max_pages: number;
  records?: string;
};

/** the package's PagerHint (a mode of the `pagination` flag's value) */
export type PagerHint = { mode: Mode; code: string; evidence?: string; confidence?: number; selector?: string; attr?: string; via?: string; param?: string; start?: number | null; step?: number; stop?: number; browser?: boolean };
/** the `pagination` flag's value */
export type PaginationHint = { modes: PagerHint[]; total_pages?: number; total_items?: number; page_size?: number };

export const DEFAULT_MAX = 20;

// -- sub-plans ---------------------------------------------------------------------------------

const doc = (steps: Step[]): Arg => ({ plan: { root: "Document", steps } });
const opt = { optional: true };
const readOf = (selector: string, attr: string): Step[] => [...call("select", [selector], opt), ...call("attr", [attr || "text"], opt)];

export function condArg(c: Cond): Arg {
  if (c.cmp === "exists") return doc(call("select", [c.selector], opt).concat(call("is_ok")));
  if (c.cmp === "missing") return doc([...call("select", [c.selector], opt), ...call("is_ok"), { kind: "op", name: "not", args: [], kwargs: {} }]);
  return doc([...readOf(c.selector, c.attr), { kind: "op", name: c.cmp, args: [{ value: c.value }], kwargs: {} }]);
}

type RawStep = { kind: string; name: string; args?: Arg[]; kwargs?: Record<string, Arg> };
/** the (get name, call args) pairs of a sub-plan, plus its trailing op */
function shapeOf(a: Arg | undefined): { calls: { name: string; args: unknown[] }[]; op?: { name: string; value: unknown } } | null {
  const steps = (a?.plan as Plan | undefined)?.steps as RawStep[] | undefined; if (!steps) return null;
  const calls: { name: string; args: unknown[] }[] = []; let op: { name: string; value: unknown } | undefined;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind === "get") { const c = steps[i + 1]; const has = c?.kind === "call"; calls.push({ name: s.name, args: has ? (c!.args ?? []).map((x) => x.value) : [] }); if (has) i++; }
    else if (s.kind === "op") op = { name: s.name, value: s.args?.[0]?.value };
    else return null;
  }
  return { calls, op };
}

export function parseCond(a: Arg | undefined): Cond | null {
  const s = shapeOf(a); if (!s) return null;
  const [sel, second] = s.calls;
  if (sel?.name !== "select" || typeof sel.args[0] !== "string") return null;
  const selector = sel.args[0];
  if (second?.name === "is_ok" && s.calls.length === 2) return { selector, attr: "", cmp: s.op?.name === "not" ? "missing" : "exists", value: "" };
  if (second?.name === "attr" && s.calls.length === 2 && s.op && (CMPS as string[]).includes(s.op.name)) return { selector, attr: String(second.args[0] ?? "text"), cmp: s.op.name as Cond["cmp"], value: String(s.op.value ?? "") };
  return null;
}

/** a `select(sel).attr(attr)` sub-plan (optionally `.number()`) -> its selector + attr */
function parseRead(a: Arg | undefined, tail?: string): { selector: string; attr: string } | null {
  const s = shapeOf(a); if (!s || s.op) return null;
  const want = tail ? 3 : 2;
  const [sel, at, t] = s.calls;
  if (s.calls.length !== want || sel?.name !== "select" || at?.name !== "attr" || (tail && t?.name !== tail)) return null;
  return { selector: String(sel.args[0] ?? ""), attr: String(at.args[0] ?? "text") };
}

const isNextLink = (a: Arg | undefined) => { const s = shapeOf(a); return !!s && s.calls.length === 1 && s.calls[0]!.name === "next_link"; };

// -- kwargs <-> Pager --------------------------------------------------------------------------

/** the `paginate` kwargs a pager writes */
export function toKwargs(p: Pager): Record<string, Arg> {
  const kw: Record<string, Arg> = {};
  if (p.mode === "next") kw.next = p.next ? { value: p.next } : doc(call("next_link"));
  if (p.mode === "pages") {
    kw.pages = { value: p.param || "page" };
    if (p.start != null) kw.start = { value: p.start };
    if ((p.step ?? 1) !== 1) kw.step = { value: p.step };
    if (typeof p.stop === "number" && p.stop > 0) kw.stop = { value: p.stop };
    else if (p.stop && typeof p.stop === "object" && p.stop.selector) kw.stop = doc([...call("select", [p.stop.selector]), ...call("attr", [p.stop.attr || "text"]), ...call("number")]);
  }
  if (p.mode === "cursor") { kw.cursor = doc(readOf(p.cursor?.selector ?? "", p.cursor?.attr ?? "text")); kw.param = { value: p.param || "cursor" }; }
  if (p.mode === "click") kw.click = { value: p.click || "button" };
  if (p.mode === "scroll") kw.scroll = { value: true };
  if (p.until?.selector) kw.until = condArg(p.until);
  if (p.filter?.selector && p.mode !== "click" && p.mode !== "scroll") kw.filter = condArg(p.filter);
  kw.max_pages = { value: p.max_pages || DEFAULT_MAX };
  if (p.records) kw.records = { value: p.records };
  return kw;
}

const num = (a: Arg | undefined): number | undefined => (typeof a?.value === "number" ? a.value : a?.value != null && /^\d+$/.test(String(a.value)) ? Number(a.value) : undefined);
const str = (a: Arg | undefined): string => (typeof a?.value === "string" ? a.value : "");

/** a pager from `paginate` kwargs (the old `by=` kwargs too); null when it is none of the five */
export function fromKwargs(kw: Record<string, Arg>): Pager | null {
  if ("by" in kw || "action" in kw || "name" in kw) return fromLegacy(kw);
  const base: Pager = { mode: "next", max_pages: num(kw.max_pages) ?? DEFAULT_MAX, records: str(kw.records) || undefined };
  const until = kw.until ? parseCond(kw.until) ?? undefined : undefined;
  const filter = kw.filter ? parseCond(kw.filter) ?? undefined : undefined;
  const conds = { ...(until ? { until } : {}), ...(filter ? { filter } : {}) };
  if (kw.next) {
    if (typeof kw.next.value === "string") return { ...base, ...conds, mode: "next", next: kw.next.value };
    if (isNextLink(kw.next)) return { ...base, ...conds, mode: "next", next: "" };
    const r = parseRead(kw.next); return r && r.attr === "href" ? { ...base, ...conds, mode: "next", next: r.selector } : null;
  }
  if (kw.pages && str(kw.pages)) {
    const stopRead = kw.stop?.plan ? parseRead(kw.stop, "number") : null;
    return { ...base, ...conds, mode: "pages", param: str(kw.pages), start: num(kw.start), step: num(kw.step) ?? 1, stop: stopRead ?? num(kw.stop) };
  }
  if (kw.cursor) {
    const r = typeof kw.cursor.value === "string" ? { selector: kw.cursor.value, attr: "text" } : parseRead(kw.cursor);
    return r ? { ...base, ...conds, mode: "cursor", cursor: r, param: str(kw.param) || "cursor" } : null;
  }
  if (kw.click) return typeof kw.click.value === "string" ? { ...base, ...conds, mode: "click", click: kw.click.value } : null;
  if (kw.scroll?.value) return { ...base, ...conds, mode: "scroll" };
  return null;
}

/** the removed `by=` API (a saved graph / an old plan) as the pager it meant */
export function fromLegacy(kw: Record<string, Arg>): Pager {
  const by = str(kw.by) || "auto"; const next = str(kw.next); const max_pages = num(kw.max_pages) ?? DEFAULT_MAX; const records = str(kw.records) || undefined;
  const act = shapeOf(kw.action)?.calls[0];
  if (by === "action" || by === "click") {
    if (act?.name === "scroll" || (by === "click" && !next)) return { mode: "scroll", max_pages, records };
    return { mode: "click", click: act ? String(act.args[0] ?? "button") : next || "button", max_pages, records };
  }
  if (by === "param") return { mode: "pages", param: str(kw.name) || "page", start: num(kw.start), step: num(kw.size) ?? num(kw.step) ?? 1, max_pages, records };
  if (by === "cursor") return { mode: "cursor", cursor: { selector: str(kw.cursor), attr: str(kw.cursor_attr) || "text" }, param: str(kw.name) || "cursor", max_pages, records };
  return { mode: "next", next, max_pages, records };
}

/** the pager a detected hint describes */
export function fromHint(h: PagerHint, max_pages = DEFAULT_MAX): Pager {
  if (h.mode === "next") return { mode: "next", next: h.via === "header" || (h.selector ?? "").includes("rel") ? "" : h.selector ?? "", max_pages };
  if (h.mode === "pages") return { mode: "pages", param: h.param || "page", start: h.start ?? undefined, step: h.step ?? 1, stop: h.stop || undefined, max_pages };
  if (h.mode === "cursor") return { mode: "cursor", cursor: { selector: h.selector ?? "", attr: h.attr || "text" }, param: h.param || "cursor", max_pages };
  if (h.mode === "click") return { mode: "click", click: h.selector || "button", max_pages };
  return { mode: "scroll", max_pages };
}

// -- reading it ----------------------------------------------------------------------------------

const q = (s: string) => JSON.stringify(s);
export function condCode(c: Cond): string {
  const sel = `wq.doc.select(${q(c.selector)}${c.cmp === "exists" || c.cmp === "missing" ? ", optional=True" : ""})`;
  if (c.cmp === "exists") return `${sel}.is_ok()`;
  if (c.cmp === "missing") return `~${sel}.is_ok()`;
  return `${sel}.attr(${q(c.attr || "text")}) ${{ eq: "==", ne: "!=", lt: "<", gt: ">" }[c.cmp]} ${q(c.value)}`;
}

/** the `.paginate(...)` this pager is (the package's own spelling) */
export function code(p: Pager): string {
  const a: string[] = [];
  if (p.mode === "next") a.push(p.next ? `next=${q(p.next)}` : "next=wq.doc.next_link()");
  if (p.mode === "pages") {
    a.push(`pages=${q(p.param || "page")}`);
    if (p.start != null) a.push(`start=${p.start}`);
    if ((p.step ?? 1) !== 1) a.push(`step=${p.step}`);
    if (typeof p.stop === "number" && p.stop > 0) a.push(`stop=${p.stop}`);
    else if (p.stop && typeof p.stop === "object" && p.stop.selector) a.push(`stop=wq.doc.select(${q(p.stop.selector)}).attr(${q(p.stop.attr || "text")}).number()`);
  }
  if (p.mode === "cursor") a.push(`cursor=wq.doc.select(${q(p.cursor?.selector ?? "")}).attr(${q(p.cursor?.attr || "text")})`, `param=${q(p.param || "cursor")}`);
  if (p.mode === "click") a.push(`click=${q(p.click || "button")}`);
  if (p.mode === "scroll") a.push("scroll=True");
  if (p.until?.selector) a.push(`until=${condCode(p.until)}`);
  if (p.filter?.selector && p.mode !== "click" && p.mode !== "scroll") a.push(`filter=${condCode(p.filter)}`);
  if ((p.max_pages || DEFAULT_MAX) !== DEFAULT_MAX) a.push(`max_pages=${p.max_pages}`);
  if (p.records) a.push(`records=${q(p.records)}`);
  return `.paginate(${a.join(", ")})`;
}

/** a few words: what the pager walks */
export function label(p: Pager): string {
  switch (p.mode) {
    case "next": return p.next ? `follow ${p.next}` : "follow rel=next";
    case "pages": return `?${p.param || "page"}=${p.start ?? "…"}${(p.step ?? 1) !== 1 ? ` +${p.step}` : ""}${typeof p.stop === "number" && p.stop ? `…${p.stop}` : p.stop ? "…(read)" : ""}`;
    case "cursor": return `cursor → ?${p.param || "cursor"}=`;
    case "click": return `click ${p.click || "button"}`;
    case "scroll": return "infinite scroll";
  }
}

/** the pagination hint in a flag list (the `pagination` flag's value), if it fired */
export function hintOf(flags: { name: string; present?: boolean; value?: unknown }[] | undefined): PaginationHint | null {
  const f = flags?.find((x) => x.name === "pagination");
  const v = f?.present ? (f.value as PaginationHint | undefined) : undefined;
  return v && Array.isArray(v.modes) ? v : null;
}

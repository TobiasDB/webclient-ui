/** The Author workspace's model: STAGES (the pages of a scrape -- the listing, the detail
 * pages followed from a link field), each with its record, its fields, the drive steps
 * recorded on it and its pagination; the plan is DERIVED from it (never the other way),
 * and the whole model rides in the URL so back / forward and a shared link restore it. */
import { call, plan as planBody } from "./session";

export type Tier = "false" | "auto" | "always";
export type Source = "text" | "href" | "html" | "attr";
export type Column = { name: string; selector: string; source: Source; attr?: string; all?: boolean; follow?: string };
export type Step = { op: "click" | "write" | "scroll" | "wait_for" | "goto"; selector?: string; text?: string; url?: string };
export type Stage = {
  id: string; kind: "listing" | "follow"; parent?: string; via?: string;
  url: string; tier: Tier; docId?: string; live?: boolean;
  record?: string; columns: Column[]; steps: Step[]; paginate?: { by: "link" | "param"; max_pages: number };
};
export type Mode = "look" | "pick" | "drive";
export type Author = { stages: Stage[]; active: string; mode: Mode };

let seq = 1;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export const empty = (): Author => ({ stages: [], active: "", mode: "look" });
export const activeStage = (a: Author): Stage | undefined => a.stages.find((s) => s.id === a.active);
export const rootStage = (a: Author): Stage | undefined => a.stages.find((s) => s.kind === "listing") ?? a.stages[0];
export const childrenOf = (a: Author, id: string) => a.stages.filter((s) => s.parent === id);

/** A fresh model for a URL: one listing stage, the look mode. */
export function fromUrl(url: string, tier: Tier = "auto"): Author {
  const s: Stage = { id: newId(), kind: "listing", url, tier, columns: [], steps: [] };
  return { stages: [s], active: s.id, mode: "look" };
}

// -- the URL form ------------------------------------------------------------------
export function encode(a: Author): string {
  const slim = { ...a, stages: a.stages.map((s) => ({ ...s })) };
  return btoa(unescape(encodeURIComponent(JSON.stringify(slim)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(s: string): Author | null {
  try {
    const json = decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
    const a = JSON.parse(json) as Author;
    if (!a || !Array.isArray(a.stages)) return null;
    return { stages: a.stages.map((st) => ({ ...st, columns: st.columns ?? [], steps: st.steps ?? [] })), active: a.active, mode: a.mode ?? "look" };
  } catch { return null; }
}

// -- the plan, derived -------------------------------------------------------------
const browserArg = (s: Stage): Record<string, unknown> => s.steps.length ? { browser: true } : s.tier === "false" ? {} : { browser: s.tier === "always" ? true : "auto" };

function stepCalls(s: Stage) {
  return s.steps.map((st) => st.op === "click" ? call("click", [st.selector]) : st.op === "write" ? call("write", [st.selector, st.text ?? ""]) : st.op === "scroll" ? call("scroll", st.selector ? [st.selector] : []) : st.op === "wait_for" ? call("wait_for", [st.selector]) : call("goto", [st.url]));
}

/** The sub-plan one column becomes inside `extract(name=<plan>)`. A column that FOLLOWS a
 * stage resolves its href and runs that stage's steps / record / fields -- the row nests. */
export function fieldPlan(a: Author, c: Column): Record<string, unknown> {
  const sub = c.follow ? a.stages.find((s) => s.id === c.follow) : undefined;
  if (sub) {
    const steps = [
      ...call("select", [c.selector]), ...call("attr", ["href"]), ...call("resolve", [], browserArg(sub)),
      ...stepCalls(sub).flat(),
      ...(sub.paginate ? call("paginate", [], { by: sub.paginate.by, max_pages: sub.paginate.max_pages }) : []),
      ...(sub.record ? call("select_all", [sub.record]) : []),
      ...(sub.columns.length ? extractCall(a, sub.columns) : []),
      ...call("project"),
    ];
    return { root: "Document", steps };
  }
  const sel = c.all ? call("select_all", [c.selector]) : call("select", [c.selector]);
  const attr = c.source === "text" ? "text" : c.source === "href" ? "href" : c.source === "html" ? "html" : c.attr ?? "text";
  return { root: "Document", steps: [...sel, ...call("attr", [attr])] };
}

function extractCall(a: Author, columns: Column[]) {
  return [{ kind: "get" as const, name: "extract" }, { kind: "call" as const, name: "extract", args: [], kwargs: Object.fromEntries(columns.map((c) => [c.name, { plan: fieldPlan(a, c) }])) as any }];
}

/** The whole scrape as ONE plan, rooted at the listing stage (the reference of its url). */
export function fullPlan(a: Author, sessionId?: string | null): Record<string, unknown> | null {
  const root = rootStage(a); if (!root) return null;
  return planBody("Reference", [
    call("resolve", [], browserArg(root)),
    ...stepCalls(root),
    ...(root.paginate ? [call("paginate", [], { by: root.paginate.by, max_pages: root.paginate.max_pages })] : []),
    ...(root.record ? [call("select_all", [root.record])] : []),
    ...(root.columns.length ? [extractCall(a, root.columns)] : []),
    call("project"),
  ], sessionId);
}

// -- local evaluation (the preview, in the rebuilt page) ------------------------------
export function project(recordEl: Element, columns: Column[], nested: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    if (c.follow) { out[c.name] = nested[c.follow] ?? `→ ${c.follow}`; continue; }
    let els: Element[] = []; try { els = c.all ? [...recordEl.querySelectorAll(c.selector)] : ([recordEl.querySelector(c.selector)].filter(Boolean) as Element[]); } catch { /* bad selector */ }
    const val = (el: Element): unknown => c.source === "text" ? (el.textContent || "").trim() : c.source === "href" ? el.getAttribute("href") : c.source === "html" ? el.innerHTML : el.getAttribute(c.attr ?? "");
    out[c.name] = c.all ? els.map(val) : els[0] ? val(els[0]) : null;
  }
  return out;
}

export function columnName(selector: string, tag: string, taken: string[]): string {
  const leaf = selector.split(/\s*[> ]\s*/).filter(Boolean).pop() ?? selector;
  const cls = /\.([a-zA-Z0-9_-]+)/.exec(leaf)?.[1]; const attr = /\[(?:data-)?([a-zA-Z0-9_-]+)/.exec(leaf)?.[1]; const id = /#([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const raw = cls ?? id ?? attr ?? (tag === "a" ? "link" : tag === "img" ? "image" : tag === "time" ? "when" : /^[a-z0-9]+/.exec(leaf)?.[0] ?? tag);
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
  return taken.includes(base) ? `${base}_${taken.length + 1}` : base;
}

/** A selector for `el` relative to `root`: tag.class when unique inside the record, else a short path. */
export function relativeSelector(root: Element, el: Element, describe: (e: Element) => { selector: string; classes: string[]; tag: string }): string {
  const d = describe(el);
  const tries = [d.selector, ...(d.classes.length > 1 ? [`${d.tag}.${d.classes.slice(0, 2).join(".")}`] : []), d.tag];
  for (const t of tries) { try { if (root.querySelectorAll(t).length === 1 && root.querySelector(t) === el) return t; } catch { /* next */ } }
  const steps: string[] = []; let n: Element | null = el;
  while (n && n !== root) { const p: Element | null = n.parentElement; if (!p) break; const same = [...p.children].filter((c) => c.tagName === n!.tagName); steps.push(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase()); n = p; }
  return steps.reverse().join(" > ");
}

/** From a click inside a page: the selector of the smallest repeating ancestor (the record). */
export function bestRecordSelector(pick: { path: string; selector: string }, doc: Document | null, describe: (e: Element) => { classes: string[]; tag: string }): string {
  if (!doc) return pick.selector;
  let el: Element | null = doc.querySelector(pick.path);
  while (el && el.tagName !== "BODY") {
    const d = describe(el);
    for (const c of d.classes) { const sel = `${d.tag}.${c}`; try { if (doc.querySelectorAll(sel).length >= 2) return sel; } catch { /* next */ } }
    el = el.parentElement;
  }
  return pick.selector;
}

export const absolute = (href: string, base: string) => { try { return new URL(href, base).toString(); } catch { return href; } };

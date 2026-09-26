import * as React from "react";
import { cn } from "../lib/cn";
import type { Pick } from "./Player";

/** One op of the object's surface, as `GET /ops` describes it (generated from the package's
 * backing tables -- the menu is built from this, never hand-listed). */
export type OpParam = { name: string; required: boolean; kind: "positional" | "keyword"; default?: unknown; type?: string | null };
export type OpSpec = { name: string; kind: "call" | "prop"; io: boolean; collection: boolean; bound?: boolean; params: OpParam[]; doc: string };

/** What the menu hands back: the op chosen, the selector built, its args / kwargs, and --
 * for a read -- the field name; for a browser action -- whether to record it in the plan. */
export type MenuOp = { name: string; selector: string; args: unknown[]; kwargs: Record<string, unknown>; field?: string; record?: boolean };

export type ElementMenuProps = {
  pick: Pick;
  /** where to draw it (px inside the player) */
  at: { x: number; y: number };
  /** the scope: the last object -- an element the selector is relative to (null = the page), its
   * selector (the ancestor the clicked element sits in is found by it, so a rebuilt page still
   * scopes right) and how to say it */
  scope: { el: Element | null; selector?: string; label: string };
  /** the op catalogue for the object (Document / Element) */
  ops: OpSpec[];
  /** pattern groups the element belongs to */
  groups?: { name: string; colour: string; count: number }[];
  /** field names already taken (for the suggested name) */
  taken?: string[];
  live?: boolean;
  onOp: (op: MenuOp) => void;
  onClose: () => void;
};

type Segment = { el: Element; tag: string; id?: string; classes: string[] };
const UTILITY = /^(data-wc|wc-)|[0-9]|^(flex|grid|block|hidden|relative|absolute|border|rounded|text|font|p|m|px|py|mt|mb|ml|mr|w|h|gap|items|justify|bg|shadow|hover|focus|inline|min|max|overflow|truncate|whitespace|leading|tracking|uppercase|sm|md|lg|xl)(-|$)/;
const SELECTOR_OPS_FIRST = ["select_all", "select", "click", "write", "scroll", "wait_for"];

function segmentsOf(el: Element, scope: Element | null, depth = 4): Segment[] {
  const out: Segment[] = [];
  let n: Element | null = el;
  while (n && n !== scope && n.tagName && !["HTML", "BODY"].includes(n.tagName) && out.length < depth) {
    out.unshift({ el: n, tag: n.tagName.toLowerCase(), id: n.id || undefined, classes: [...n.classList].filter((c) => !/^(data-wc|wc-)/.test(c)) });
    n = n.parentElement;
  }
  return out;
}
const semantic = (classes: string[]) => classes.filter((c) => !UTILITY.test(c));

/** The menu on a click in the page. Top: the SELECTOR being built -- the element's tag, id and
 * classes as toggles, its ancestors likewise, the live match count inside the scope -- so
 * `li` becomes `li.card` with one click. Below: the object's own ops, generated from the op
 * catalogue: the ones that take a selector (select / select_all / click / write / …), the reads
 * (attr shortcuts), the drill-down (a link → a new document under the same plan), the pager,
 * and every other op of the surface behind "more". */
export function ElementMenu({ pick, at, scope, ops, groups = [], taken = [], live, onOp, onClose }: ElementMenuProps) {
  const el = pick.el ?? null;
  /** the scope element as it stands in the clicked element's own page (by identity, else by its selector) */
  const scopeEl = React.useMemo<Element | null>(() => { if (!el || !scope.el) return null; if (scope.el.contains(el)) return scope.el; if (scope.selector) { try { const c = el.parentElement?.closest(scope.selector) ?? null; if (c) return c; } catch { /* bad */ } } return scope.el; }, [el, scope.el, scope.selector]);
  const segs = React.useMemo(() => (el ? segmentsOf(el, scopeEl) : []), [el, scopeEl]);
  // what is ON per segment: the leaf's tag + its first semantic class (or id); ancestors off
  const [on, setOn] = React.useState<{ tag: boolean; id: boolean; classes: string[] }[]>(() => segs.map((s, i) => {
    const leaf = i === segs.length - 1; const sem = semantic(s.classes);
    return { tag: leaf, id: leaf && !!s.id, classes: leaf && !s.id && sem[0] ? [sem[0]] : [] };
  }));
  const [custom, setCustom] = React.useState<string | null>(null);
  const built = React.useMemo(() => segs.map((s, i) => { const o = on[i]; if (!o) return ""; const parts = [o.tag ? s.tag : "", o.id && s.id ? `#${s.id}` : "", ...o.classes.map((c) => `.${CSS.escape(c)}`)]; return parts.join(""); }).filter(Boolean).join(" "), [segs, on]);
  const selector = custom ?? built;
  React.useEffect(() => { setCustom(null); }, [built]);
  const root: ParentNode | null = scopeEl ?? el?.ownerDocument ?? null;
  const count = React.useMemo(() => { if (!root || !selector) return 0; try { return root.querySelectorAll(selector).length; } catch { return -1; } }, [root, selector]);
  const pageCount = React.useMemo(() => { const d = el?.ownerDocument; if (!d || !selector || !scopeEl) return null; try { return d.querySelectorAll(selector).length; } catch { return null; } }, [el, selector, scopeEl]);
  const matchesSelf = React.useMemo(() => { if (!root || !el || !selector) return false; try { return [...root.querySelectorAll(selector)].includes(el); } catch { return false; } }, [root, el, selector]);
  const toggle = (i: number, part: "tag" | "id" | string) => setOn((prev) => prev.map((o, j) => j !== i ? o : part === "tag" ? { ...o, tag: !o.tag } : part === "id" ? { ...o, id: !o.id } : { ...o, classes: o.classes.includes(part) ? o.classes.filter((c) => c !== part) : [...o.classes, part] }));

  const [name, setName] = React.useState(() => nameFor(pick, taken));
  const [text, setText] = React.useState("");
  const [attrName, setAttrName] = React.useState(Object.keys(pick.attrs).find((a) => !["href", "class", "id"].includes(a)) ?? "data-id");
  const [recordIt, setRecordIt] = React.useState(true);
  const [more, setMore] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }; const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; const t = setTimeout(() => { document.addEventListener("mousedown", h); document.addEventListener("keydown", k, true); }, 0); return () => { clearTimeout(t); document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k, true); }; }, [onClose]);

  const byName = Object.fromEntries(ops.map((o) => [o.name, o]));
  const selectorOps = ops.filter((o) => o.kind === "call" && o.params[0]?.name === "selector" && o.name !== "screenshot").sort((a, b) => idx(a.name) - idx(b.name));
  const otherOps = ops.filter((o) => o.kind === "call" && o.params[0]?.name !== "selector" && !["attr", "extract", "project", "paginate", "limit", "evaluate", "goto", "reload", "screenshot", "regex", "regex_all", "events_of", "render", "iframe", "ref", "select", "select_all"].includes(o.name) && o.params.every((p) => !p.required));
  const isLink = !!pick.href && pick.tag === "a"; const isImg = pick.tag === "img";
  const isInput = ["input", "textarea", "select"].includes(pick.tag);
  const pager = pagerFor(pick, selector, !!scopeEl);
  const fire = (op: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}, extra: Partial<MenuOp> = {}) => onOp({ name: op, selector, args, kwargs, field: name, ...extra });
  const Btn = ({ children, onClick, hint, tone }: { children: React.ReactNode; onClick: () => void; hint?: string; tone?: "accent" | "io" }) => (
    <button type="button" className={cn("rounded border px-1.5 py-0.5 text-[11px] hover:bg-surface-2", tone === "accent" ? "border-accent/50 bg-accent-soft text-accent" : tone === "io" ? "border-topic-network/40 text-topic-network" : "border-line")} onClick={onClick} title={hint}>{children}</button>
  );
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div ref={ref} className="wc-pickmenu absolute z-20 w-[340px] rounded-lg border border-line bg-surface p-1.5 text-[12px] shadow-lg" style={{ left: at.x, top: at.y }} onClick={stop}>
      {/* the selector: toggles per segment, the count in scope */}
      <div className="mb-1 flex flex-col gap-0.5 px-1">
        {segs.map((s, i) => {
          const o = on[i]!; const leaf = i === segs.length - 1;
          return (
            <div key={i} className={cn("flex flex-wrap items-center gap-0.5 font-mono text-[11px]", !leaf && "opacity-80")} style={{ paddingLeft: i * 8 }}>
              {!leaf && <span className="text-muted">↳</span>}
              <Tog on={o.tag} onClick={() => toggle(i, "tag")}>{s.tag}</Tog>
              {s.id && <Tog on={o.id} onClick={() => toggle(i, "id")}>#{s.id}</Tog>}
              {s.classes.map((c) => <Tog key={c} on={o.classes.includes(c)} muted={UTILITY.test(c)} onClick={() => toggle(i, c)}>.{c}</Tog>)}
            </div>
          );
        })}
        <div className="mt-0.5 flex items-center gap-1">
          <input className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 font-mono text-[11px]" value={selector} onChange={(e) => setCustom(e.target.value)} title="the selector (edit it, or toggle the parts above)" />
          <span className={cn("shrink-0 rounded px-1 font-mono text-[10px]", count < 0 ? "bg-bad-soft text-bad" : count === 1 ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")} title={scopeEl ? `matches inside ${scope.label}` : "matches on the page"}>
            {count < 0 ? "bad selector" : `×${count}${scopeEl ? ` in ${scope.label}` : ""}`}{pageCount != null && pageCount !== count ? ` · ${pageCount} on the page` : ""}
          </span>
        </div>
        {!matchesSelf && count >= 0 && selector && <div className="text-[10px] text-warn">this selector no longer matches the element you clicked</div>}
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
          {groups.map((g) => <span key={g.name} className="rounded px-1 text-white" style={{ background: g.colour }}>{g.name} ×{g.count}</span>)}
          {pick.text && <span className="truncate">“{pick.text.slice(0, 60)}”</span>}
        </div>
      </div>
      {/* the ops that take the selector -- from the catalogue */}
      <div className="border-t border-line px-1 pt-1">
        <div className="flex flex-wrap items-center gap-1">
          {selectorOps.map((o) => {
            const extra = o.params.filter((p) => p.required && p.name !== "selector");
            const needsText = extra.some((p) => p.name === "text");
            if (needsText && !isInput) return null;
            return (
              <React.Fragment key={o.name}>
                {needsText && <input className="h-6 w-20 rounded border border-line bg-surface px-1 text-[11px]" value={text} placeholder="text" onChange={(e) => setText(e.target.value)} />}
                <Btn tone={o.io ? "io" : o.collection ? "accent" : undefined} hint={o.doc} onClick={() => fire(o.name, needsText ? [selector, text] : [selector], {}, { record: o.io ? recordIt : undefined })}>{o.name}{o.collection ? ` ×${count}` : ""}</Btn>
              </React.Fragment>
            );
          })}
          {isLink && byName.resolve === undefined && <Btn hint="open the linked page as a new document under this plan" onClick={() => fire("resolve", [], {}, {})}>follow ▸</Btn>}
        </div>
        {selectorOps.some((o) => o.io) && <label className="mt-0.5 flex items-center gap-1 text-[10px] text-muted"><input type="checkbox" checked={recordIt} onChange={(e) => setRecordIt(e.target.checked)} /> record browser actions in the plan{live ? "" : " (the page goes live first)"}</label>}
      </div>
      {/* reads: attr shortcuts -> a field */}
      {byName.attr && (
        <div className="mt-1 border-t border-line px-1 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-muted">read</span>
            <input className="h-6 w-20 rounded border border-line bg-surface px-1 text-[11px]" value={name} onChange={(e) => setName(e.target.value)} title="the field name" onKeyDown={(e) => { if (e.key === "Enter") fire("attr", ["text"]); }} />
            <Btn hint="the element's text" onClick={() => fire("attr", ["text"])}>text</Btn>
            {isLink && <Btn hint="the link target" onClick={() => fire("attr", ["href"])}>href</Btn>}
            {isImg && <Btn hint="the image source" onClick={() => fire("attr", ["src"])}>src</Btn>}
            <Btn hint="how many children the element has" onClick={() => fire("attr", ["count"])}>count</Btn>
            <input className="h-6 w-16 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={attrName} onChange={(e) => setAttrName(e.target.value)} title="an attribute name" />
            <Btn hint={`the ${attrName} attribute`} onClick={() => fire("attr", [attrName])}>attr</Btn>
          </div>
        </div>
      )}
      {/* drill down / pages */}
      {(isLink || pager) && (
        <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-line px-1 pt-1">
          {isLink && <Btn tone="accent" hint="open the linked page as a new document, joined under this plan" onClick={() => fire("resolve", [], {})}>open the link ▸</Btn>}
          {pager && <Btn tone="io" hint={pager.hint} onClick={() => fire("paginate", [], pager.kwargs)}>pages: {pager.label}</Btn>}
        </div>
      )}
      {/* everything else the surface has, on the selected element */}
      {otherOps.length > 0 && (
        <div className="mt-1 border-t border-line px-1 pt-1">
          <button type="button" className="text-[10px] text-muted hover:text-ink" onClick={() => setMore(!more)}>{more ? "▾" : "▸"} more ({otherOps.length} ops of the surface)</button>
          {more && <div className="mt-0.5 flex flex-wrap gap-1">{otherOps.map((o) => <Btn key={o.name} hint={o.doc} onClick={() => fire(o.name, [], {})}>{o.name}</Btn>)}</div>}
        </div>
      )}
    </div>
  );
}

function Tog({ on, muted, onClick, children }: { on: boolean; muted?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("rounded px-0.5", on ? "bg-accent-soft text-accent" : muted ? "text-muted/60 line-through decoration-transparent hover:decoration-current" : "text-muted hover:bg-surface-2")} title={on ? "in the selector — click to drop" : "click to add to the selector"}>{children}</button>;
}
const idx = (n: string) => { const i = SELECTOR_OPS_FIRST.indexOf(n); return i < 0 ? 99 : i; };

function nameFor(pick: Pick, taken: string[]): string {
  const cls = semantic(pick.classes)[0]; const id = pick.id;
  const raw = cls ?? id ?? (pick.tag === "a" ? "link" : pick.tag === "img" ? "image" : pick.tag === "time" ? "when" : pick.tag);
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
  if (!taken.includes(base)) return base;
  let i = 2; while (taken.includes(`${base}_${i}`)) i++; return `${base}_${i}`;
}

/** the URL params that page a listing (the package's crawl.canon table; `p` is left out -- too often a post id) */
const PAGE_PARAMS = new Set(["page", "pg", "pagenum", "paged", "pagina", "pn"]);
const OFFSET_PARAMS = new Set(["offset", "start", "skip"]);

/** How this element could page the dataset (only outside a record: paging is the page's). The kwargs are the
 * package's `paginate(...)`: `next=` (a selector whose href is followed), `pages=` (a URL param), `click=`. */
export function pagerFor(pick: Pick, selector: string, inScope: boolean): { label: string; hint: string; kwargs: Record<string, unknown> } | null {
  if (inScope) return null;
  const text = (pick.text ?? "").trim().toLowerCase();
  const nextish = /^(next|next\s*(page|»|›|>)|»|›|>|more|load more|show more|see more|older)\b/.test(text) || /\bnext\b|\bmore\b/.test((pick.attrs["aria-label"] ?? pick.attrs.title ?? "").toLowerCase());
  if (pick.tag === "a" && pick.href) {
    if (pick.attrs.rel === "next") return { label: "rel=next — walk every page", hint: "the site marks the next page; each page's rel=next link is followed", kwargs: { next: 'a[rel="next"]' } };
    let query: URLSearchParams | null = null;
    try { query = new URL(pick.href, "http://x/").searchParams; } catch { /* not a URL */ }
    for (const [k, val] of query ?? []) {
      const kl = k.toLowerCase(); if (!/^\d+$/.test(val) || !(PAGE_PARAMS.has(kl) || OFFSET_PARAMS.has(kl))) continue;
      if (OFFSET_PARAMS.has(kl)) return { label: `?${k}= — walk by ${val}`, hint: `the link is ?${k}=${val}: the plan walks ?${k}= from this page's value by ${val}`, kwargs: { pages: k, step: Number(val) || 1 } };
      return { label: `?${k}= — walk the numbered pages`, hint: `the link carries ?${k}=${val}; the plan walks ?${k}= from this page's value by 1`, kwargs: { pages: k } };
    }
    if (nextish) return { label: "this is the next link — walk every page", hint: "each page's next link (this selector) is followed", kwargs: { next: selector } };
    return null;
  }
  if (pick.tag === "button" || nextish || pick.attrs.role === "button") return { label: nextish ? "click this to load more" : "click this for more rows", hint: "on the live page: click it until nothing more loads (click=)", kwargs: { click: selector } };
  return null;
}

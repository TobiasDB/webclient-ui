import * as React from "react";
import { cn } from "../lib/cn";
import { CMP_LABEL, CMPS, code, DEFAULT_MAX, fromHint, label, type Cond, type Mode, type Pager, type PaginationHint } from "../lib/pager";

export type PagerEditorProps = {
  /** the pager (null: one page) */
  value: Pager | null;
  onChange?: (p: Pager | null) => void;
  /** what the page's detection hinted (each mode with its evidence) -- offered, never applied by itself */
  hints?: PaginationHint | null;
  readOnly?: boolean;
  className?: string;
};

const MODE_LABEL: Record<Mode, string> = { next: "follow the next link", pages: "page numbers (?page=)", cursor: "a cursor token", click: "click load more", scroll: "infinite scroll" };
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** THE PAGER EDITOR -- Author's page and the plan view share it. One iterator (chosen from the page's hints, each
 * with its evidence, or by hand), its inputs, then `until` (this page is the last) / `filter` (keep only these
 * pages) and the page budget. The `.paginate(...)` it writes is shown as the package spells it. */
export function PagerEditor({ value: p, onChange, hints, readOnly, className }: PagerEditorProps) {
  const set = (patch: Partial<Pager>) => p && onChange?.({ ...p, ...patch });
  const pick = (m: Mode | "") => onChange?.(m ? { ...blank(m), max_pages: p?.max_pages ?? DEFAULT_MAX, until: p?.until, filter: m === "click" || m === "scroll" ? undefined : p?.filter, records: p?.records } : null);
  if (readOnly) return p ? <code className={cn("font-mono text-[10px] text-topic-network", className)} title={code(p)}>{label(p)} · {p.max_pages} pages</code> : null;
  const size = hints && [hints.total_pages ? `${hints.total_pages} pages` : "", hints.total_items ? `${hints.total_items} items` : "", hints.page_size ? `${hints.page_size} per page` : ""].filter(Boolean).join(" · ");
  return (
    <div className={cn("flex flex-col gap-1 text-[11px] text-ink", className)} onClick={stop}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted">pages:</span>
        <select className={SEL} value={p?.mode ?? ""} onChange={(e) => pick(e.target.value as Mode | "")} title="how to reach the next page">
          <option value="">one page</option>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
        {p && <><input type="number" min={1} className={cn(IN, "w-12")} value={p.max_pages} onChange={(e) => set({ max_pages: Math.max(1, Number(e.target.value) || 1) })} title="max_pages: the page budget" /><span className="text-muted">max</span></>}
      </div>
      {hints && hints.modes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]" data-testid="pager-hints">
          <span className="text-muted">detected{size ? ` (${size})` : ""}:</span>
          {hints.modes.map((h, i) => (
            <button key={i} type="button" className="rounded border border-line bg-surface-2 px-1 font-mono hover:border-accent" title={`${h.evidence ?? ""} · ${Math.round((h.confidence ?? 0) * 100)}% — use ${h.code}`}
              onClick={() => onChange?.({ ...fromHint(h, p?.max_pages ?? DEFAULT_MAX), until: p?.until, filter: h.mode === "click" || h.mode === "scroll" ? undefined : p?.filter })}>
              {h.code.replace(/^\.paginate\(|\)$/g, "")}
            </button>
          ))}
        </div>
      )}
      {p && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {p.mode === "next" && <Text v={p.next ?? ""} w="w-40" ph="rel=next / Link header" title="the next link's selector (its href is followed); empty: rel=next or the HTTP Link header" on={(next) => set({ next })} />}
            {p.mode === "pages" && <>
              <Text v={p.param ?? ""} w="w-16" ph="page" title="the URL param" on={(param) => set({ param })} />
              <span className="text-muted">from</span><Num v={p.start} ph="URL's" title="start: the first value (empty: this URL's, else 1 -- 0 for an offset)" on={(start) => set({ start })} />
              <span className="text-muted">by</span><Num v={p.step ?? 1} ph="1" title="step: the increment (an offset's page size)" on={(step) => set({ step: step ?? 1 })} />
              <span className="text-muted">to</span>
              {typeof p.stop === "object"
                ? <><Text v={p.stop.selector} w="w-24" ph="last page element" title="stop: read off page one" on={(s) => set({ stop: { selector: s, attr: (p.stop as { attr: string }).attr } })} /><Text v={p.stop.attr} w="w-12" ph="text" title="its attribute (read as a number)" on={(a) => set({ stop: { selector: (p.stop as { selector: string }).selector, attr: a } })} /></>
                : <Num v={p.stop} ph="the end" title="stop: the last value (inclusive); empty: until a page is empty or repeats" on={(s) => set({ stop: s })} />}
              <button type="button" className="text-[10px] text-muted underline hover:text-ink" onClick={() => set({ stop: typeof p.stop === "object" ? undefined : { selector: "", attr: "text" } })} title="the last page: a number, or read off page one">{typeof p.stop === "object" ? "a number" : "read it"}</button>
            </>}
            {p.mode === "cursor" && <>
              <Text v={p.cursor?.selector ?? ""} w="w-28" ph="the token's element" title="the element carrying the next page's token" on={(s) => set({ cursor: { selector: s, attr: p.cursor?.attr ?? "text" } })} />
              <Text v={p.cursor?.attr ?? ""} w="w-16" ph="text" title="its attribute" on={(a) => set({ cursor: { selector: p.cursor?.selector ?? "", attr: a } })} />
              <span className="text-muted">in ?</span><Text v={p.param ?? ""} w="w-14" ph="cursor" title="the URL param the token rides in" on={(param) => set({ param })} />
            </>}
            {p.mode === "click" && <Text v={p.click ?? ""} w="w-32" ph="the load-more control" title="clicked on the live page until nothing more loads" on={(click) => set({ click })} />}
            {(p.mode === "click" || p.mode === "scroll" || p.records) && <Text v={p.records ?? ""} w="w-28" ph="record selector" title="records: measures what each load added, and what a repeated page is compared by" on={(r) => set({ records: r || undefined })} />}
          </div>
          <CondRow name="until" hint="this page is the LAST (it is kept) -- e.g. its oldest date is before a cutoff" c={p.until} on={(until) => set({ until })} />
          {p.mode !== "click" && p.mode !== "scroll" && <CondRow name="filter" hint="keep only the pages where this holds; the walk goes on" c={p.filter} on={(filter) => set({ filter })} />}
          <code className="truncate font-mono text-[10px] text-topic-network" title={code(p)} data-testid="pager-code">{code(p)}</code>
        </>
      )}
    </div>
  );
}

function blank(m: Mode): Pager {
  switch (m) {
    case "next": return { mode: "next", next: "", max_pages: DEFAULT_MAX };
    case "pages": return { mode: "pages", param: "page", step: 1, max_pages: DEFAULT_MAX };
    case "cursor": return { mode: "cursor", cursor: { selector: "", attr: "text" }, param: "cursor", max_pages: DEFAULT_MAX };
    case "click": return { mode: "click", click: "", max_pages: DEFAULT_MAX };
    case "scroll": return { mode: "scroll", max_pages: DEFAULT_MAX };
  }
}

function CondRow({ name, hint, c, on }: { name: string; hint: string; c?: Cond; on: (c: Cond | undefined) => void }) {
  if (!c) return <button type="button" className="self-start text-[10px] text-muted hover:text-ink" title={hint} onClick={() => on({ selector: "", attr: "text", cmp: "exists", value: "" })}>+ {name}</button>;
  const cmp = c.cmp === "exists" || c.cmp === "missing";
  return (
    <div className="flex flex-wrap items-center gap-1" title={hint}>
      <span className="w-9 text-muted">{name}</span>
      <Text v={c.selector} w="w-28" ph="selector" title="the first match on the page" on={(selector) => on({ ...c, selector })} />
      {!cmp && <Text v={c.attr} w="w-16" ph="text" title="its attribute" on={(attr) => on({ ...c, attr })} />}
      <select className={SEL} value={c.cmp} onChange={(e) => on({ ...c, cmp: e.target.value as Cond["cmp"] })}>{CMPS.map((k) => <option key={k} value={k}>{CMP_LABEL[k]}</option>)}</select>
      {!cmp && <Text v={c.value} w="w-24" ph="value" title="compared as text (ISO dates sort)" on={(value) => on({ ...c, value })} />}
      <button type="button" className="text-muted hover:text-bad" onClick={() => on(undefined)} title={`remove ${name}`}>×</button>
    </div>
  );
}

const IN = "h-6 rounded border border-line bg-surface px-1 text-[10px]";
const SEL = "h-6 rounded border border-line bg-surface px-1 text-[11px]";
const Text = ({ v, w, ph, title, on }: { v: string; w: string; ph: string; title: string; on: (v: string) => void }) =>
  <input className={cn(IN, "font-mono", w)} value={v} placeholder={ph} title={title} onChange={(e) => on(e.target.value)} onClick={stop} />;
const Num = ({ v, ph, title, on }: { v: number | undefined; ph: string; title: string; on: (v: number | undefined) => void }) =>
  <input type="number" className={cn(IN, "w-14")} value={v ?? ""} placeholder={ph} title={title} onChange={(e) => on(e.target.value === "" ? undefined : Number(e.target.value))} onClick={stop} />;

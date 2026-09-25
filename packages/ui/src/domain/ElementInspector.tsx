import * as React from "react";
import { cn } from "../lib/cn";
import { attributesOfAll, groupCandidates, nameFromSelector, semantic, suggestFields, uniqueCandidates, UTILITY, type Candidate } from "../lib/selectors";
import type { Pick } from "./Player";
import { pagerFor, type OpSpec } from "./ElementMenu";

/** A read the inspector hands back: the path from the new node to the value (select a
 * descendant, then an attribute), and its name -- a literal, or a selector (relative to the
 * record) whose text is the name. */
export type InspectRead = { select?: string; attr: string; name?: string; nameFrom?: string; /** read through a regex */ pattern?: string; /** then .number() */ number?: boolean };
export type InspectAdd = { op: string; selector: string; args?: unknown[]; kwargs?: Record<string, unknown>; reads?: InspectRead[]; record?: boolean };

export type ElementInspectorProps = {
  pick: Pick;
  /** the element the new ops are relative to: the scope node's element (a record, an element) or null = the page */
  scopeEl: Element | null;
  scopeLabel: string;
  /** the surface of the scope object (from GET /ops) */
  ops: OpSpec[];
  groups?: { name: string; colour: string; count: number }[];
  live?: boolean;
  /** the selector under construction and the matches to outline */
  onSelector?: (selector: string, mode: "each" | "one") => void;
  onAdd: (a: InspectAdd) => void;
  /** the focused node takes THIS selector (it is waiting for one): the primary action */
  applyTo?: { label: string } | null;
  onApply?: (selector: string, reads: InspectRead[]) => void;
  onClose: () => void;
  className?: string;
};

type Seg = { el: Element; tag: string; id?: string; classes: string[] };
const esc = (c: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(c) : c);

/** The ELEMENT INSPECTOR: what you clicked, and everything the builder can make of it.
 *  - its PARENTS, each a row of toggles (tag · #id · .classes): build the selector from any of
 *    them; ↑ re-targets the inspector to that parent;
 *  - CANDIDATES: one per group the element (or a parent) belongs to -- `ol.row li ×20`, `li ×75`,
 *    `↑1 tr ×7` -- and the unique forms for a single element; every match is outlined on the page;
 *  - its ATTRIBUTES: text, own text, child count, its label, href, src, data-*, aria-*, every
 *    other attribute -- tick to read them (named, or named from the page); for a group, the
 *    fields its records share;
 *  - the OPS of the object (select_all / select / click / type / scroll / wait / open the link /
 *    pages), which add nodes to the graph with the ticked reads as their children. */
export function ElementInspector({ pick, scopeEl, scopeLabel, ops, groups = [], live, onSelector, onAdd, applyTo, onApply, onClose, className }: ElementInspectorProps) {
  const [target, setTarget] = React.useState<Element | null>(pick.el ?? null);
  React.useEffect(() => { setTarget(pick.el ?? null); }, [pick.el]);
  const el = target;
  const scope = React.useMemo<Element | null>(() => { if (!el || !scopeEl) return null; return scopeEl.contains(el) ? scopeEl : null; }, [el, scopeEl]);
  const root: ParentNode | null = scope ?? el?.ownerDocument ?? null;
  const segs = React.useMemo<Seg[]>(() => { const out: Seg[] = []; let n: Element | null = el; while (n && n !== scope && !["HTML", "BODY"].includes(n.tagName) && out.length < 6) { out.unshift({ el: n, tag: n.tagName.toLowerCase(), id: n.id || undefined, classes: [...n.classList].filter((c) => !/^(data-wc|wc-)/.test(c)) }); n = n.parentElement; } return out; }, [el, scope]);
  const prefer = groups.find((g) => g.count > 1)?.count;
  const groupsC = React.useMemo(() => (el && root ? groupCandidates(el, root, prefer) : []), [el, root, prefer]);
  const uniqueC = React.useMemo(() => (el && root ? uniqueCandidates(el, root).filter((c) => c.count === 1) : []), [el, root]);
  const [mode, setMode] = React.useState<"each" | "one">("each");
  const [selector, setSelector] = React.useState("");
  const [custom, setCustom] = React.useState(false);
  // inside a record (or an element) the default is the ONE match there; on the page, the group
  React.useEffect(() => { const m = (scope && uniqueC.length) || !groupsC.length ? "one" : "each"; setMode(m); setSelector((m === "each" ? groupsC[0] : uniqueC[0])?.selector ?? pick.selector); setCustom(false); setTicks({}); setNames({}); setFrom({}); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);
  React.useEffect(() => { onSelector?.(selector, mode); }, [selector, mode, onSelector]);
  const matches = React.useMemo<Element[]>(() => { if (!root || !selector) return []; try { return [...root.querySelectorAll(selector)]; } catch { return []; } }, [root, selector]);
  const bad = React.useMemo(() => { if (!root || !selector) return false; try { root.querySelectorAll(selector); return false; } catch { return true; } }, [root, selector]);
  const first = matches[0] ?? el;
  const attrs = React.useMemo(() => attributesOfAll(matches.length ? matches : first ? [first] : []), [matches, first]);
  const keyOf = (a: { attr: string; number?: boolean; pattern?: string }) => `self@${a.attr}${a.number ? "#n" : ""}${a.pattern ? "~" : ""}`;
  const shared = React.useMemo(() => (mode === "each" && matches.length > 1 ? suggestFields(matches, 10) : []), [mode, matches]);
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [from, setFrom] = React.useState<Record<string, string>>({});
  const [text, setText] = React.useState("");
  const [recordIt, setRecordIt] = React.useState(true);
  const [toggled, setToggled] = React.useState<Record<number, Set<string>>>({});
  // building the selector from the parent toggles (tag / #id / .class per segment)
  const fromToggles = (next: Record<number, Set<string>>) => segs.map((s, i) => { const on = next[i]; if (!on || !on.size) return ""; return [on.has("tag") ? s.tag : "", s.id && on.has("#") ? `#${esc(s.id)}` : "", ...s.classes.filter((c) => on.has(c)).map((c) => `.${esc(c)}`)].join(""); }).filter(Boolean).join(" ");
  const toggle = (i: number, part: string) => { const next = { ...toggled, [i]: new Set(toggled[i] ?? []) }; const set = next[i]!; set.has(part) ? set.delete(part) : set.add(part); if (part !== "tag" && set.size && !set.has("tag") && i === segs.length - 1) set.add("tag"); setToggled(next); setSelector(fromToggles(next)); setCustom(true); };
  const reads = (): InspectRead[] => {
    const out: InspectRead[] = [];
    for (const a of attrs) { const k = keyOf(a); if (ticks[k]) out.push({ attr: a.attr, pattern: a.pattern, number: a.number, name: names[k] || undefined, nameFrom: from[k] || undefined }); }
    for (const f of shared) { const k = `${f.selector}@${f.attr}${f.number ? "#n" : ""}`; if (ticks[k]) out.push({ select: f.selector, attr: f.attr, pattern: f.pattern, number: f.number, name: names[k] || f.name, nameFrom: from[k] || undefined }); }
    return out;
  };
  const byName = Object.fromEntries(ops.map((o) => [o.name, o]));
  const isLink = pick.tag === "a" && !!pick.href;
  const linkSel = first === el ? selector : (uniqueC[0]?.selector ?? selector);  // the link op always follows the element you clicked
  const isInput = ["input", "textarea", "select"].includes(pick.tag);
  const pager = pagerFor(pick, pick.tag === "a" ? (first === el ? selector : (uniqueC[0]?.selector ?? selector)) : selector, !!scope);
  const add = (op: string, extra: Partial<InspectAdd> = {}) => onAdd({ op, selector, ...extra });
  const nReads = Object.values(ticks).filter(Boolean).length;
  if (!el) return null;
  const Cand = ({ c, m }: { c: Candidate; m: "each" | "one" }) => (
    <button type="button" onClick={() => { setMode(m); setSelector(c.selector); setCustom(false); }} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]", selector === c.selector ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2", !c.clean && "opacity-70")} title={c.up ? `a parent, ${c.up} up — the record is the ${c.selector.split(" ").pop()}` : c.count === 1 ? "unique in the scope" : `a group of ${c.count}`}>
      {c.up ? <span className="text-muted">↑{c.up}</span> : null}{c.selector}<span className={cn("rounded px-1 text-[10px]", c.count === 1 ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>×{c.count}</span>
    </button>
  );
  const Row = ({ k, label, value, nameHint }: { k: string; label: React.ReactNode; value: string; nameHint: string }) => (
    <div className="flex items-center gap-1">
      <input type="checkbox" checked={!!ticks[k]} onChange={() => setTicks((t) => ({ ...t, [k]: !t[k] }))} />
      <span className="w-28 shrink-0 truncate font-mono text-[10px]" title={typeof label === "string" ? label : undefined}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={value}>{value || "—"}</span>
      <input className="h-5 w-20 rounded border border-line bg-surface px-1 text-[10px]" placeholder={nameHint} value={names[k] ?? ""} onChange={(e) => { setNames((x) => ({ ...x, [k]: e.target.value })); if (!ticks[k]) setTicks((t) => ({ ...t, [k]: true })); }} title="the column name" disabled={!!from[k]} />
      <input className="h-5 w-16 rounded border border-line bg-surface px-1 font-mono text-[10px]" placeholder="name from" value={from[k] ?? ""} onChange={(e) => { setFrom((x) => ({ ...x, [k]: e.target.value })); if (!ticks[k]) setTicks((t) => ({ ...t, [k]: true })); }} title="name the column from the page: a selector (relative to the record, e.g. th for a td) whose text is the name — .alias(expr)" />
    </div>
  );
  return (
    <section className={cn("wc-inspector flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-surface p-2 text-[12px]", className)}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Element</span>
        <span className="truncate font-mono text-[11px]">{pick.text ? `“${pick.text.slice(0, 50)}”` : `<${pick.tag}>`}</span>
        {groups.map((g) => <span key={`${g.name}:${g.count}`} className="rounded px-1 text-[10px] text-white" style={{ background: g.colour }}>{g.name} ×{g.count}</span>)}
        <span className="flex-1" /><span className="text-[10px] text-muted">in {scopeLabel}</span>
        <button type="button" className="text-muted hover:text-ink" onClick={onClose} title="close (Esc)">×</button>
      </div>
      {/* the parents: toggles build the selector; ↑ re-targets */}
      <div className="flex flex-col gap-0.5 rounded border border-line/70 p-1">
        {segs.map((s, i) => { const on = toggled[i] ?? new Set<string>(); const leaf = i === segs.length - 1; return (
          <div key={i} className="flex flex-wrap items-center gap-0.5 font-mono text-[11px]" style={{ paddingLeft: i * 6 }}>
            {!leaf ? <button type="button" className="text-muted hover:text-accent" title="inspect this parent instead" onClick={() => setTarget(s.el)}>↑</button> : <span className="text-accent">●</span>}
            <Tog on={on.has("tag")} onClick={() => toggle(i, "tag")}>{s.tag}</Tog>
            {s.id && <Tog on={on.has("#")} onClick={() => toggle(i, "#")}>#{s.id}</Tog>}
            {s.classes.map((c) => <Tog key={c} on={on.has(c)} dim={UTILITY.test(c)} onClick={() => toggle(i, c)}>.{c}</Tog>)}
          </div>
        ); })}
      </div>
      {/* candidates by group */}
      {groupsC.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] text-muted">each</span>{groupsC.slice(0, 6).map((c) => <Cand key={c.selector} c={c} m="each" />)}</div>}
      {uniqueC.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] text-muted">one</span>{uniqueC.slice(0, 4).map((c) => <Cand key={c.selector} c={c} m="one" />)}</div>}
      <div className="flex items-center gap-1">
        <input className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 font-mono text-[11px]" value={selector} onChange={(e) => { setSelector(e.target.value); setCustom(true); }} title="the selector" />
        <span className={cn("shrink-0 rounded px-1 font-mono text-[10px]", bad ? "bg-bad-soft text-bad" : matches.length === 1 ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")}>{bad ? "bad" : `×${matches.length}`}</span>
        {custom && <span className="text-[10px] text-muted">edited</span>}
      </div>
      {/* the ops of the object */}
      <div className="flex flex-wrap items-center gap-1 border-t border-line pt-1">
        {applyTo && <Btn tone="accent" onClick={() => onApply?.(selector, reads())} hint="set the focused node's selector">use for {applyTo.label}{nReads ? ` + ${nReads}` : ""}</Btn>}
        {applyTo && <span className="text-[10px] text-muted">or add under it:</span>}
        {byName.select_all && matches.length > 1 && <Btn tone="accent" onClick={() => add("select_all", { reads: reads() })} hint={byName.select_all.doc}>select_all ×{matches.length}{nReads ? ` + ${nReads}` : ""}</Btn>}
        {byName.select && <Btn tone={matches.length === 1 ? "accent" : undefined} onClick={() => add("select", { reads: reads() })} hint={byName.select.doc}>select{matches.length > 1 ? " (first)" : ""}{nReads ? ` + ${nReads}` : ""}</Btn>}
        {isLink && <Btn onClick={() => onAdd({ op: "resolve", selector: linkSel, reads: [] })} hint="open the linked page as a new Document node (per record when inside one)">open the link ▸</Btn>}
        {["click", "scroll", "wait_for"].filter((n) => byName[n]).map((n) => <Btn key={n} tone="io" onClick={() => add(n, { record: recordIt })} hint={byName[n]!.doc}>{n === "wait_for" ? "wait for" : n}</Btn>)}
        {isInput && byName.write && <><input className="h-6 w-24 rounded border border-line bg-surface px-1 text-[11px]" value={text} placeholder="text" onChange={(e) => setText(e.target.value)} /><Btn tone="io" onClick={() => add("write", { args: [selector, text], record: recordIt })}>type</Btn></>}
        {pager && <Btn tone="io" onClick={() => add("paginate", { kwargs: pager.kwargs })} hint={pager.hint}>pages: {pager.label}</Btn>}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-muted"><input type="checkbox" checked={recordIt} onChange={(e) => setRecordIt(e.target.checked)} /> browser actions become nodes of the plan{live ? "" : " (the page goes live first)"}</label>
      {/* attributes */}
      <div className="flex flex-col gap-0.5 border-t border-line pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">read off {matches.length > 1 && mode === "each" ? "each match" : "it"} — tick to add as outputs</div>
        {attrs.map((a) => <Row key={keyOf(a)} k={keyOf(a)} label={a.number ? `${a.attr} → number` : a.attr} value={a.label ?? a.value} nameHint={a.attr === "text" ? nameFromSelector(selector, pick.tag) : a.attr.replace(/[^a-z0-9]+/gi, "_")} />)}
        {shared.length > 0 && <>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">inside each match — the fields they share</div>
          {shared.map((f) => <Row key={`${f.selector}@${f.attr}${f.number ? "#n" : ""}`} k={`${f.selector}@${f.attr}${f.number ? "#n" : ""}`} label={<>{f.selector} <span className="text-muted">· {f.attr}{f.number ? " → number" : ""}</span></>} value={`${f.sample}${f.coverage < 1 ? ` (${Math.round(f.coverage * 100)}%)` : ""}`} nameHint={f.name} />)}
        </>}
      </div>
      <div className="text-[10px] text-muted">{semantic(pick.classes).length ? "" : "no semantic classes: use a parent (↑) or a position"}</div>
    </section>
  );
}

function Tog({ on, dim, onClick, children }: { on: boolean; dim?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("rounded px-0.5", on ? "bg-accent-soft text-accent" : dim ? "text-muted/60 hover:bg-surface-2" : "text-muted hover:bg-surface-2")} title={on ? "in the selector — click to drop" : "add to the selector"}>{children}</button>;
}
function Btn({ children, onClick, hint, tone }: { children: React.ReactNode; onClick: () => void; hint?: string; tone?: "accent" | "io" }) {
  return <button type="button" data-act="" className={cn("rounded border px-1.5 py-0.5 text-[11px] hover:bg-surface-2", tone === "accent" ? "border-accent/50 bg-accent-soft text-accent" : tone === "io" ? "border-topic-network/40 text-topic-network" : "border-line")} onClick={onClick} title={hint}>{children}</button>;
}

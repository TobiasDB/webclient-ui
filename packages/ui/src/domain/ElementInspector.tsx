import * as React from "react";
import { cn } from "../lib/cn";
import { attributesOfAll, groupCandidates, nameFromSelector, suggestFields, uniqueCandidates, UTILITY, type Candidate } from "../lib/selectors";
import type { Pick } from "./Player";

/** A read added with the op: the path from the new node to the value (select a descendant,
 * then an attribute), its name (a literal, or a selector whose text is the name), an optional
 * regex, then .number(). */
export type InspectRead = { select?: string; attr: string; name?: string; nameFrom?: string; pattern?: string; number?: boolean; date?: boolean };
/** (kept for callers that describe an op + selector together) */
export type InspectAdd = { op: string; selector: string; args?: unknown[]; kwargs?: Record<string, unknown>; reads?: InspectRead[]; record?: boolean };

export type ElementInspectorProps = {
  pick: Pick;
  /** the element the selector is relative to (the focus root that holds the pick), or null = the page */
  scopeEl: Element | null;
  scopeLabel: string;
  /** the op being added: `select_all` shows groups first, `select` unique forms first */
  op: string;
  /** re-editing: the selector the op has now (the editor starts from it) */
  initial?: string;
  groups?: { name: string; colour: string; count: number }[];
  /** the selector under construction (the page outlines every match) */
  onSelector?: (selector: string) => void;
  /** ADD the op with this selector (and any reads ticked below) */
  onAdd: (selector: string, reads: InspectRead[]) => void;
  onCancel: () => void;
  className?: string;
};

type Seg = { el: Element; tag: string; id?: string; classes: string[] };
const esc = (c: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(c) : c);

/** The SELECTOR EDITOR for the op being added: the picked element's parents (tag / #id / .class
 * toggles; ↑ re-targets a parent), the candidates -- one per group it belongs to, or its unique
 * forms -- the selector text with its live count (every match outlined on the page), optional
 * reads to add with it, and ONE action: Add. */
export function ElementInspector({ pick, scopeEl, scopeLabel, op, initial, groups = [], onSelector, onAdd, onCancel, className }: ElementInspectorProps) {
  const [target, setTarget] = React.useState<Element | null>(pick.el ?? null);
  React.useEffect(() => { setTarget(pick.el ?? null); }, [pick.el]);
  const el = target;
  const scope = React.useMemo<Element | null>(() => (el && scopeEl && scopeEl.contains(el) ? scopeEl : null), [el, scopeEl]);
  const root: ParentNode | null = scope ?? el?.ownerDocument ?? null;
  const segs = React.useMemo<Seg[]>(() => { const out: Seg[] = []; let n: Element | null = el; while (n && n !== scope && !["HTML", "BODY"].includes(n.tagName) && out.length < 6) { out.unshift({ el: n, tag: n.tagName.toLowerCase(), id: n.id || undefined, classes: [...n.classList].filter((c) => !/^(data-wc|wc-)/.test(c)) }); n = n.parentElement; } return out; }, [el, scope]);
  const prefer = groups.find((g) => g.count > 1)?.count;
  const many = op === "select_all";
  const cands = React.useMemo<Candidate[]>(() => { if (!el || !root) return []; return many ? groupCandidates(el, root, prefer) : uniqueCandidates(el, root); }, [el, root, prefer, many]);
  const [selector, setSelector] = React.useState("");
  React.useEffect(() => { setSelector(initial || cands[0]?.selector || pick.selector); setTicks({}); setNames({}); setFrom({}); setToggled({}); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, op, initial]);
  React.useEffect(() => { onSelector?.(selector); }, [selector, onSelector]);
  const matches = React.useMemo<Element[]>(() => { if (!root || !selector) return []; try { return [...root.querySelectorAll(selector)]; } catch { return []; } }, [root, selector]);
  const bad = React.useMemo(() => { if (!root || !selector) return false; try { root.querySelectorAll(selector); return false; } catch { return true; } }, [root, selector]);
  const attrs = React.useMemo(() => attributesOfAll(matches.length ? matches.slice(0, many ? 30 : 1) : el ? [el] : []), [matches, el, many]);
  const shared = React.useMemo(() => (many && matches.length > 1 ? suggestFields(matches, 10) : []), [many, matches]);
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [from, setFrom] = React.useState<Record<string, string>>({});
  const [toggled, setToggled] = React.useState<Record<number, Set<string>>>({});
  const [showReads, setShowReads] = React.useState(false);
  const fromToggles = (next: Record<number, Set<string>>) => segs.map((s, i) => { const on = next[i]; if (!on || !on.size) return ""; return [on.has("tag") ? s.tag : "", s.id && on.has("#") ? `#${esc(s.id)}` : "", ...s.classes.filter((c) => on.has(c)).map((c) => `.${esc(c)}`)].join(""); }).filter(Boolean).join(" ");
  const toggle = (i: number, part: string) => { const next = { ...toggled, [i]: new Set(toggled[i] ?? []) }; const set = next[i]!; set.has(part) ? set.delete(part) : set.add(part); if (part !== "tag" && set.size && !set.has("tag") && i === segs.length - 1) set.add("tag"); setToggled(next); setSelector(fromToggles(next)); };
  const keyOf = (a: { attr: string; number?: boolean; date?: boolean; select?: string }) => `${a.select ?? ""}@${a.attr}${a.number ? "#n" : ""}${a.date ? "#d" : ""}`;
  const reads = (): InspectRead[] => {
    const out: InspectRead[] = [];
    for (const a of attrs) { const k = keyOf(a); if (ticks[k]) out.push({ attr: a.attr, pattern: a.pattern, number: a.number, date: a.date, name: names[k] || undefined, nameFrom: from[k] || undefined }); }
    for (const f of shared) { const k = keyOf(f); if (ticks[k]) out.push({ select: f.selector, attr: f.attr, pattern: f.pattern, number: f.number, date: f.date, name: names[k] || f.name, nameFrom: from[k] || undefined }); }
    return out;
  };
  const nReads = Object.values(ticks).filter(Boolean).length;
  if (!el) return null;
  const Row = ({ k, label, value, hint }: { k: string; label: React.ReactNode; value: string; hint: string }) => (
    <div className="flex items-center gap-1">
      <input type="checkbox" checked={!!ticks[k]} onChange={() => setTicks((t) => ({ ...t, [k]: !t[k] }))} />
      <span className="w-28 shrink-0 truncate font-mono text-[10px]">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted" title={value}>{value || "—"}</span>
      {ticks[k] && <><input className="h-5 w-16 rounded border border-line bg-surface px-1 text-[10px]" placeholder={hint} value={names[k] ?? ""} onChange={(e) => setNames((x) => ({ ...x, [k]: e.target.value }))} title="its output name" disabled={!!from[k]} />
        <input className="h-5 w-12 rounded border border-line bg-surface px-1 font-mono text-[10px]" placeholder="from" value={from[k] ?? ""} onChange={(e) => setFrom((x) => ({ ...x, [k]: e.target.value }))} title="or name it from the page: a selector (relative to the record) whose text is the name" /></>}
    </div>
  );
  return (
    <section className={cn("wc-inspector flex flex-col gap-1 text-[11px]", className)}>
      {/* the parents: toggles build the selector; ↑ re-targets */}
      <div className="flex flex-col gap-0.5 rounded border border-line/70 p-1">
        {segs.map((s, i) => { const on = toggled[i] ?? new Set<string>(); const leaf = i === segs.length - 1; return (
          <div key={i} className="flex flex-wrap items-center gap-0.5 font-mono text-[10px]" style={{ paddingLeft: i * 5 }}>
            {!leaf ? <button type="button" className="text-muted hover:text-accent" title="use this parent instead" onClick={() => setTarget(s.el)}>↑</button> : <span className="text-accent">●</span>}
            <Tog on={on.has("tag")} onClick={() => toggle(i, "tag")}>{s.tag}</Tog>
            {s.id && <Tog on={on.has("#")} onClick={() => toggle(i, "#")}>#{s.id}</Tog>}
            {s.classes.map((c) => <Tog key={c} on={on.has(c)} dim={UTILITY.test(c)} onClick={() => toggle(i, c)}>.{c}</Tog>)}
          </div>
        ); })}
      </div>
      {cands.length > 0 && <div className="flex flex-wrap items-center gap-1">{cands.slice(0, 6).map((c) => (
        <button key={c.selector} type="button" onClick={() => setSelector(c.selector)} className={cn("inline-flex items-center gap-1 rounded border px-1 py-px font-mono text-[10px]", selector === c.selector ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2", !c.clean && "opacity-70")} title={c.up ? `a parent, ${c.up} up` : c.count === 1 ? "unique" : `a group of ${c.count}`}>
          {c.up ? <span className="text-muted">↑{c.up}</span> : null}{c.selector}<span className={cn("rounded px-0.5", c.count === 1 ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>×{c.count}</span>
        </button>
      ))}</div>}
      <div className="flex items-center gap-1">
        <input className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 font-mono text-[11px]" value={selector} onChange={(e) => setSelector(e.target.value)} title="the selector" />
        <span className={cn("shrink-0 rounded px-1 font-mono text-[10px]", bad ? "bg-bad-soft text-bad" : matches.length === 1 ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")}>{bad ? "bad" : `×${matches.length}`}</span>
      </div>
      <div className="text-[10px] text-muted">in {scopeLabel}{!many && matches.length > 1 ? " · select takes the first match" : ""}</div>
      {/* optional reads to add with it */}
      <button type="button" className="self-start text-[10px] text-muted hover:text-ink" onClick={() => setShowReads(!showReads)}>{showReads ? "▾" : "▸"} also output values from it{nReads ? ` (${nReads})` : ""}</button>
      {showReads && <div className="flex max-h-56 flex-col gap-0.5 overflow-auto">
        {attrs.map((a) => <Row key={keyOf(a)} k={keyOf(a)} label={a.number ? `${a.attr} → number` : a.date ? `${a.attr} → date` : a.attr} value={a.label ?? a.value} hint={a.attr === "text" ? nameFromSelector(selector, pick.tag) : a.attr.replace(/[^a-z0-9]+/gi, "_")} />)}
        {shared.map((f) => <Row key={keyOf(f)} k={keyOf(f)} label={<>{f.selector} <span className="text-muted">· {f.attr}{f.number ? " → n" : f.date ? " → date" : ""}</span></>} value={f.sample} hint={f.name} />)}
      </div>}
      <div className="flex items-center gap-1 border-t border-line pt-1">
        <button type="button" data-act="" disabled={bad || !selector} onClick={() => onAdd(selector, reads())} className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white hover:brightness-110 disabled:opacity-40">{initial ? "Update" : "Add"} .{op}("{selector.length > 28 ? selector.slice(0, 28) + "…" : selector}"){nReads ? ` + ${nReads}` : ""}</button>
        <button type="button" onClick={onCancel} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-ink">cancel</button>
      </div>
    </section>
  );
}

function Tog({ on, dim, onClick, children }: { on: boolean; dim?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("rounded px-0.5", on ? "bg-accent-soft text-accent" : dim ? "text-muted/60 hover:bg-surface-2" : "text-muted hover:bg-surface-2")} title={on ? "in the selector -- click to drop" : "add to the selector"}>{children}</button>;
}

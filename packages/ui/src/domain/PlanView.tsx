import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "../lib/cn";
import { calls, moveCall, planAt, removeCall, splitAlias, updateCall, v, withPlanAt, type Call, type Path, type Plan } from "../lib/plan";
import { fieldColour } from "./Player";

export type PlanViewProps = {
  plan: Plan;
  /** the page the root resolves (shown on the root node) */
  url?: string;
  onChange?: (p: Plan) => void;
  /** the call you are working at: [plan path…, callIndex]; clicking a node selects it */
  selected?: Path | null;
  onSelect?: (path: Path) => void;
  /** open a followed page (a field whose chain resolves an href) in the Player */
  onOpen?: (path: Path) => void;
  className?: string;
  readOnly?: boolean;
  /** live counts per call path (e.g. "0" -> 4 matches), from the local preview */
  counts?: Record<string, number | string>;
};

const IO = new Set(["resolve", "click", "write", "scroll", "wait_for", "goto", "paginate", "reload"]);
const key = (path: Path) => path.join("/");

/** THE plan, live and editable: every call of the chain is a node in order (the page's
 * resolve, the recorded actions, the pagination, the record's select_all, the extract
 * with a lane per field -- each field's own chain inline, a followed page as a nested
 * chain you can open). Select a node to work at that point; edit a selector or a name
 * in place; toggle optional; reorder; remove. What you see is what runs. */
export function PlanView({ plan, url, onChange, selected, onSelect, onOpen, className, readOnly, counts = {} }: PlanViewProps) {
  return (
    <div className={cn("wc-plan flex flex-col gap-1 text-[12px]", className)}>
      <Chain plan={plan} path={[]} url={url} onChange={onChange} selected={selected} onSelect={onSelect} onOpen={onOpen} readOnly={readOnly} counts={counts} depth={0} />
    </div>
  );
}

function Chain({ plan, path, url, onChange, selected, onSelect, onOpen, readOnly, counts = {}, depth, colour }: PlanViewProps & { path: Path; depth: number; colour?: string }) {
  const cs = calls(plan);
  const root = depth === 0;
  const patch = (next: Plan) => onChange?.(next);
  return (
    <ol className={cn("flex flex-col gap-1", depth > 0 && "ml-3 border-l-2 pl-2", depth > 0 && "border-line")} style={depth > 0 && colour ? { borderColor: colour } : undefined}>
      {root && <li className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1"><span className="font-mono text-[10px] uppercase text-muted">{plan.root}</span><span className="truncate font-mono text-[11px] text-muted">{url ?? ""}</span></li>}
      {cs.length === 0 && <li className="px-2 py-1 text-[11px] text-muted">{root ? "click an element in the page to start" : "empty"}</li>}
      {cs.map((c, i) => {
        const p: Path = [...path, i]; const k = key(p); const isSel = selected && key(selected) === k;
        const count = counts[k];
        return (
          <li key={k}>
            <CallNode c={c} i={i} n={cs.length} path={p} selected={!!isSel} count={count} readOnly={readOnly} onSelect={() => onSelect?.(p)}
              onName={(name) => patch(updateCall(plan, path, i, (x) => ({ ...x, name })))}
              onArg={(j, value) => patch(updateCall(plan, path, i, (x) => ({ ...x, args: x.args.map((a, q) => (q === j ? { value } : a)) })))}
              onKw={(kw, value) => patch(updateCall(plan, path, i, (x) => ({ ...x, kwargs: value === undefined ? Object.fromEntries(Object.entries(x.kwargs).filter(([q]) => q !== kw)) : { ...x.kwargs, [kw]: { value } } })))}
              onKws={(kws) => patch(updateCall(plan, path, i, (x) => { const out = { ...x.kwargs }; for (const [k, value] of Object.entries(kws)) { if (value === undefined) delete out[k]; else out[k] = { value }; } return { ...x, kwargs: out }; }))}
              onRemove={() => patch(removeCall(plan, path, i))} onMove={(d) => patch(moveCall(plan, path, i, d))}
              onRenameField={(from, to) => patch(updateCall(plan, path, i, (x) => ({ ...x, kwargs: Object.fromEntries(Object.entries(x.kwargs).map(([q, a]) => [q === from ? to : q, a])) })))}
              onRemoveField={(name) => patch(updateCall(plan, path, i, (x) => ({ ...x, kwargs: Object.fromEntries(Object.entries(x.kwargs).filter(([q]) => q !== name)) })))}
              onOpen={onOpen} plan={plan} onChange={onChange} selectedPath={selected} onSelectPath={onSelect} counts={counts} depth={depth} />
          </li>
        );
      })}
    </ol>
  );
}

/** The pagination node: how to advance (rel=next / a next link / ?page= / a cursor / click a
 * load-more control / infinite scroll), the record it counts, and where to stop. */
function Paginate({ c, readOnly, onKw, onKws }: { c: Call; readOnly?: boolean; onKw: (k: string, v: unknown) => void; onKws: (kws: Record<string, unknown>) => void }) {
  const by = String(v(c.kwargs.by) ?? "link"); const next = String(v(c.kwargs.next) ?? "");
  const mode = by === "click" ? (next ? "load more" : "infinite scroll") : by === "param" ? `?${String(v(c.kwargs.name) ?? "page")}=` : by === "cursor" ? "cursor" : next ? "next link" : "rel=next";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const In = ({ k, w, ph, mono = true }: { k: string; w: string; ph: string; mono?: boolean }) => readOnly ? (v(c.kwargs[k]) != null ? <code className="font-mono text-[10px]">{k}={String(v(c.kwargs[k]))}</code> : null)
    : <input className={cn("h-6 rounded border border-line bg-surface px-1 text-[10px]", w, mono && "font-mono")} value={String(v(c.kwargs[k]) ?? "")} placeholder={ph} title={k} onChange={(e) => onKw(k, e.target.value || undefined)} onClick={stop} />;
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 font-mono text-[10px] text-muted">
      {readOnly ? <span className="rounded bg-surface-2 px-1">{mode}</span>
        : <select className="h-6 rounded border border-line bg-surface px-1 text-[10px]" value={by === "click" ? (next ? "more" : "scroll") : by === "link" && next ? "next" : by} onChange={(e) => { const m = e.target.value; onKws(m === "more" ? { by: "click", next: next || "button" } : m === "scroll" ? { by: "click", next: undefined } : m === "next" ? { by: "link", next: next || "a.next" } : { by: m, next: m === "link" ? undefined : next || undefined }); }} onClick={stop} title="how to reach the next page">
            <option value="link">rel=next</option><option value="next">a next link</option><option value="param">?page= param</option><option value="cursor">cursor token</option><option value="more">click load more</option><option value="scroll">infinite scroll</option>
          </select>}
      {(next || by === "click") && by !== "param" && by !== "cursor" && <In k="next" w="w-28" ph={by === "click" ? "load-more selector" : "next link selector"} />}
      {by === "param" && <><In k="name" w="w-16" ph="page" /><In k="start" w="w-10" ph="1" /></>}
      {by === "cursor" && <><In k="cursor" w="w-24" ph="cursor selector" /><In k="cursor_attr" w="w-16" ph="attr" /><In k="name" w="w-14" ph="param" /></>}
      <span>·</span>{readOnly ? <span>{String(v(c.kwargs.max_pages) ?? 20)} pages</span> : <><input type="number" min={1} className="h-6 w-12 rounded border border-line bg-surface px-1 text-[10px]" value={Number(v(c.kwargs.max_pages) ?? 5)} onChange={(e) => onKw("max_pages", Number(e.target.value))} onClick={stop} title="max_pages" /><span>pages</span></>}
      {(by === "click" || v(c.kwargs.max_rows) != null || v(c.kwargs.records) != null) && <><In k="records" w="w-24" ph="record selector" /><In k="max_rows" w="w-12" ph="rows" /></>}
    </span>
  );
}

const LABEL: Record<string, string> = { resolve: "open the page", select_all: "each", select: "the", attr: "read", extract: "fields", project: "rows", paginate: "pages", alias: "named by", merge: "as one dict", click: "click", write: "type", scroll: "scroll", wait_for: "wait for", goto: "go to", limit: "first", count: "count", filter: "keep" };

function CallNode({ c, i, n, path, selected, count, readOnly, onSelect, onName, onArg, onKw, onKws, onRemove, onMove, onRenameField, onRemoveField, onOpen, plan, onChange, selectedPath, onSelectPath, counts, depth }: {
  c: Call; i: number; n: number; path: Path; selected: boolean; count?: number | string; readOnly?: boolean; onSelect: () => void;
  onName: (s: string) => void; onArg: (j: number, v: unknown) => void; onKw: (k: string, v: unknown) => void; onKws: (kws: Record<string, unknown>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void;
  onRenameField: (a: string, b: string) => void; onRemoveField: (a: string) => void; onOpen?: (p: Path) => void;
  plan: Plan; onChange?: (p: Plan) => void; selectedPath?: Path | null; onSelectPath?: (p: Path) => void; counts: Record<string, number | string>; depth: number;
}) {
  const [open, setOpen] = React.useState(true);
  const io = IO.has(c.name);
  const optional = !!v(c.kwargs.optional);
  const label = LABEL[c.name] ?? c.name;
  const first = c.args[0];
  const isExtract = c.name === "extract";
  const canOptional = c.name === "select" || c.name === "select_all" || c.name === "attr" || c.name === "wait_for" || c.name === "click";
  return (
    <div className={cn("rounded-md border px-2 py-1", selected ? "border-accent bg-accent-soft" : "border-line bg-surface", io && !selected && "border-dashed")} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <div className="flex items-center gap-1.5">
        {isExtract && <button type="button" className="text-muted" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}
        <span className={cn("shrink-0 rounded px-1 font-mono text-[10px] uppercase", io ? "bg-topic-network/15 text-topic-network" : c.name === "select_all" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")} title={c.name}>{label}</span>
        {first && !first.plan && (readOnly ? <code className="truncate font-mono">{String(first.value)}</code>
          : <input className="h-6 min-w-[80px] flex-1 rounded border border-line bg-surface px-1 font-mono text-[11px]" value={String(first.value ?? "")} onChange={(e) => onArg(0, e.target.value)} onClick={(e) => e.stopPropagation()} />)}
        {c.name === "write" && <input className="h-6 w-28 rounded border border-line bg-surface px-1 text-[11px]" value={String(v(c.args[1]) ?? "")} placeholder="text" onChange={(e) => onArg(1, e.target.value)} onClick={(e) => e.stopPropagation()} readOnly={readOnly} />}
        {c.name === "attr" && !readOnly && <input className="h-6 w-24 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={String(v(c.args[1]) ?? "")} placeholder="regex?" title="a pattern: the value is the first group (or the match)" onChange={(e) => onArg(1, e.target.value || undefined)} onClick={(e) => e.stopPropagation()} />}
        {c.name === "paginate" && <Paginate c={c} readOnly={readOnly} onKw={onKw} onKws={onKws} />}
        {c.name === "resolve" && <span className="font-mono text-[10px] text-muted">{v(c.kwargs.browser) === true ? "browser" : v(c.kwargs.browser) === "auto" ? "auto tier" : v(c.kwargs.browser) === false ? "static" : "auto tier"}</span>}
        {c.name === "limit" && <span className="text-muted">rows</span>}
        {count != null && <span className="rounded bg-ok-soft px-1 font-mono text-[10px] text-ok">×{count}</span>}
        {optional && <span className="rounded bg-warn-soft px-1 text-[10px] text-warn">optional</span>}
        <span className="flex-1" />
        {!readOnly && canOptional && <label className="inline-flex items-center gap-0.5 text-[10px] text-muted" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={optional} onChange={(e) => onKw("optional", e.target.checked ? true : undefined)} />opt</label>}
        {!readOnly && <>
          <button type="button" className="text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={(e) => { e.stopPropagation(); onMove(-1); }} title="move up"><ArrowUp size={11} /></button>
          <button type="button" className="text-muted hover:text-ink disabled:opacity-30" disabled={i === n - 1} onClick={(e) => { e.stopPropagation(); onMove(1); }} title="move down"><ArrowDown size={11} /></button>
          <button type="button" className="text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="remove"><X size={11} /></button>
        </>}
      </div>
      {isExtract && open && (
        <div className="mt-1 flex flex-col gap-1">
          {c.args.map((a, ai) => {  // a positional column: named by its .alias(...) -- a literal or a chain read off the element
            if (!a.plan) return null;
            const fp: Path = [...path, `arg:${ai}`]; const { name } = splitAlias(a.plan); const fi = ai;
            const dynamic = !!name && typeof name === "object";
            return (
              <div key={`arg${ai}`} className="rounded-md border border-line/70 p-1" style={{ borderLeft: `3px solid ${fieldColour(fi)}` }}>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm" style={{ background: fieldColour(fi) }} />
                  {dynamic ? <span className="text-[11px] font-semibold" title="the column's name is read off each element (the chain under 'named by')">name from the page</span> : <b className="text-[11px]">{String(name ?? "field")}</b>}
                  <span className="text-[10px] text-muted">positional · .alias(…)</span>
                  <span className="flex-1" />
                  {!readOnly && <button type="button" className="text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); onChange?.(replaceArg(plan, path, ai, null)); }}><X size={11} /></button>}
                </div>
                <Chain plan={a.plan} path={fp} onChange={onChange ? (np) => onChange(replaceSub(plan, fp, np)) : undefined} selected={selectedPath} onSelect={onSelectPath} onOpen={onOpen} readOnly={readOnly} counts={counts} depth={depth + 1} colour={fieldColour(fi)} />
              </div>
            );
          })}
          {Object.entries(c.kwargs).map(([name, a], fi0) => { const fi = fi0 + c.args.length;
            const fp: Path = [...path, `kw:${name}`];
            const sub = a.plan ?? { root: "Document" as const, steps: [] };
            const follows = calls(sub).some((x) => x.name === "resolve");
            return (
              <div key={name} className="rounded-md border border-line/70 p-1" style={{ borderLeft: `3px solid ${fieldColour(fi)}` }}>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm" style={{ background: fieldColour(fi) }} />
                  {readOnly ? <b>{name}</b> : <input className="h-6 w-28 rounded border border-line bg-surface px-1 text-[11px] font-semibold" value={name} onChange={(e) => onRenameField(name, e.target.value)} onClick={(e) => e.stopPropagation()} />}
                  <span className="text-[10px] text-muted">{a.plan ? "" : `= ${JSON.stringify(a.value)}`}</span>
                  <span className="flex-1" />
                  {follows && onOpen && <button type="button" className="rounded border border-line px-1 text-[10px] hover:bg-surface-2" onClick={(e) => { e.stopPropagation(); onOpen(fp); }}>open that page ▸</button>}
                  {!readOnly && <button type="button" className="text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); onRemoveField(name); }}><X size={11} /></button>}
                </div>
                {a.plan && <Chain plan={sub} path={fp} onChange={onChange ? (np) => onChange(replaceSub(plan, fp, np)) : undefined} selected={selectedPath} onSelect={onSelectPath} onOpen={onOpen} readOnly={readOnly} counts={counts} depth={depth + 1} colour={fieldColour(fi)} />}
              </div>
            );
          })}
          {Object.keys(c.kwargs).length === 0 && c.args.length === 0 && <span className="px-1 text-[11px] text-muted">no fields yet — click a value inside a record</span>}
        </div>
      )}
    </div>
  );
}

/** `plan` with the sub-plan at the field path `fp` (…, "kw:name") replaced -- from the ROOT. */
function replaceSub(root: Plan, fp: Path, sub: Plan): Plan {
  // walk down building the replacement bottom-up
  const rebuild = (p: Plan, path: Path): Plan => {
    if (path.length === 0) return sub;
    const [idx, k, ...rest] = path as [number, string, ...Path];
    const cs = calls(p); const c = cs[idx]; if (!c) return p;
    const steps = p.steps.slice(); const cs1 = steps[c.index + 1]; if (!cs1 || cs1.kind !== "call") return p;
    const nc = { ...cs1, kwargs: { ...(cs1.kwargs ?? {}) }, args: [...(cs1.args ?? [])] };
    const inner = k.startsWith("kw:") ? nc.kwargs[k.slice(3)] : nc.args[Number(k.slice(4))];
    const np = rebuild(inner?.plan ?? { root: "Document", steps: [] }, rest);
    if (k.startsWith("kw:")) nc.kwargs[k.slice(3)] = { plan: np }; else nc.args[Number(k.slice(4))] = { plan: np };
    steps[c.index + 1] = nc;
    return { ...p, steps };
  };
  return rebuild(root, fp);
}

/** Rebuild the plan with positional column `ai` of the extract at `path` removed (null) or replaced. */
function replaceArg(root: Plan, path: Path, ai: number, sub: Plan | null): Plan {
  const target = planAt(root, path.slice(0, -1)); const idx = path[path.length - 1] as number;
  const next = updateCall(target, [], idx, (c) => ({ ...c, args: sub ? c.args.map((a, q) => (q === ai ? { plan: sub } : a)) : c.args.filter((_, q) => q !== ai) }));
  return withPlanAt(root, path.slice(0, -1), next);
}

export { planAt as planAtPath };

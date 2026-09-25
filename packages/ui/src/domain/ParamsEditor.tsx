import * as React from "react";
import { cn } from "../lib/cn";
import type { OpParam } from "./ElementMenu";

type Arg = { value?: unknown; plan?: unknown };
export type ParamsOp = { name: string; args: Arg[]; kwargs: Record<string, Arg> };

export type ParamsEditorProps = {
  op: ParamsOp;
  /** the op's signature, from GET /ops */
  params: OpParam[];
  /** params edited elsewhere (the selector a picker edits): not shown here */
  skip?: string[];
  onChange: (op: ParamsOp) => void;
  className?: string;
};

/** the choices a type string offers: a Literal's values (+ True/False when it is also a bool) */
function choicesOf(type: string | null | undefined): unknown[] | null {
  const t = String(type ?? "").replace(/^['"]|['"]$/g, "");
  const lit = /Literal\[([^\]]*)\]/.exec(t); if (!lit) return null;
  const vals: unknown[] = [...lit[1]!.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  if (/\bbool\b/.test(t)) vals.unshift(false, true);
  return vals;
}
const kindOf = (type: string | null | undefined): "bool" | "int" | "float" | "json" | "text" => {
  const t = String(type ?? "");
  if (/^bool$/.test(t.trim())) return "bool";
  if (/\bint\b/.test(t) && !/\bstr\b/.test(t)) return "int";
  if (/\bfloat\b/.test(t) && !/\bstr\b/.test(t)) return "float";
  if (/dict|list|Any/.test(t) && !/\bstr\b/.test(t)) return "json";
  return "text";
};

/** Edit an op's PARAMETERS from its signature: each positional / keyword parameter as the input its
 * type calls for (a choice for a Literal, a checkbox for a bool, a number, text, JSON); an empty one
 * falls back to its default (and leaves the plan). */
export function ParamsEditor({ op, params, skip = [], onChange, className }: ParamsEditorProps) {
  const positional = params.filter((p) => p.kind === "positional");
  const get = (p: OpParam): unknown => { if (p.kind === "positional") { const i = positional.indexOf(p); return op.args[i]?.value; } return op.kwargs[p.name]?.value; };
  const set = (p: OpParam, v: unknown) => {
    const unset = v === undefined || v === "" || (v === p.default && !p.required);
    if (p.kind === "positional") {
      const i = positional.indexOf(p); const args = [...op.args];
      while (args.length <= i) args.push({ value: positional[args.length]?.default ?? null });
      args[i] = { value: unset ? (p.default ?? null) : v };
      // trailing defaults leave the call
      while (args.length && args.length - 1 >= 0 && !positional[args.length - 1]?.required && args[args.length - 1]!.value === (positional[args.length - 1]?.default ?? null)) args.pop();
      onChange({ ...op, args });
    } else {
      const kwargs = { ...op.kwargs }; if (unset) delete kwargs[p.name]; else kwargs[p.name] = { value: v }; onChange({ ...op, kwargs });
    }
  };
  const shown = params.filter((p) => !skip.includes(p.name) && p.name !== "error");
  if (!shown.length) return <div className={cn("text-[10.5px] text-muted", className)}>.{op.name}() takes no other parameters.</div>;
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-[10.5px]", className)}>
      {shown.map((p) => {
        const v = get(p); const choices = choicesOf(p.type); const k = kindOf(p.type); const set_ = v !== undefined && v !== null && v !== p.default;
        return (
          <React.Fragment key={p.name}>
            <label className={cn("font-mono", set_ ? "text-ink" : "text-muted")} title={`${p.type ?? ""}${p.default !== undefined && p.default !== null ? ` · default ${JSON.stringify(p.default)}` : ""}`}>{p.name}{p.required ? "*" : ""}</label>
            {choices ? (
              <select className="h-5 rounded border border-line bg-surface px-1 font-mono text-[10.5px]" value={JSON.stringify(v ?? p.default ?? null)} onChange={(e) => set(p, JSON.parse(e.target.value))}>
                {(choices.some((c) => c === (v ?? p.default)) ? choices : [v ?? p.default, ...choices]).map((c) => <option key={JSON.stringify(c)} value={JSON.stringify(c)}>{String(c)}{c === p.default ? " (default)" : ""}</option>)}
              </select>
            ) : k === "bool" ? (
              <input type="checkbox" className="justify-self-start" checked={!!(v ?? p.default)} onChange={(e) => set(p, e.target.checked)} />
            ) : k === "json" ? (
              <input className="h-5 rounded border border-line bg-surface px-1 font-mono text-[10.5px]" placeholder={p.default === null || p.default === undefined ? "(none)" : JSON.stringify(p.default)} defaultValue={v === undefined || v === null ? "" : JSON.stringify(v)} onBlur={(e) => { const t = e.target.value.trim(); if (!t) return set(p, undefined); try { set(p, JSON.parse(t)); } catch { e.target.classList.add("border-bad"); } }} />
            ) : (
              <input className="h-5 rounded border border-line bg-surface px-1 font-mono text-[10.5px]" type={k === "text" ? "text" : "number"} step={k === "float" ? "any" : undefined} placeholder={p.default === null || p.default === undefined ? "(none)" : String(p.default)} value={v === undefined || v === null ? "" : String(v)} onChange={(e) => { const t = e.target.value; set(p, t === "" ? undefined : k === "int" ? parseInt(t, 10) : k === "float" ? parseFloat(t) : t); }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

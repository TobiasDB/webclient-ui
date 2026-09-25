import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { EmptyState } from "../primitives/EmptyState";

export type DataFrameProps = {
  rows: Record<string, unknown>[];
  /** Column order + colours (index-matched to the field highlights); default: the union of keys. */
  columns?: string[];
  colours?: Record<string, string> | string[];
  className?: string;
  emptyHint?: React.ReactNode;
  emptyAction?: React.ReactNode;
  max?: number;
  /** A row was clicked (e.g. to highlight that record in the player). */
  onRow?: (index: number) => void;
  selected?: number | null;
  dense?: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Rows as a dataframe: nested objects and arrays render as expandable cells (a sub-table
 * for an array of objects, a key/value list for an object), scalars inline. The 0-row
 * state explains itself. */
export function DataFrame({ rows, columns, colours, className, emptyHint, emptyAction, max = 500, onRow, selected, dense }: DataFrameProps) {
  const cols = columns ?? Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const colour = (c: string, i: number) => Array.isArray(colours) ? colours[i] : colours?.[c];
  if (!rows.length) return <EmptyState title="0 rows" hint={emptyHint ?? "The record selector matched nothing on this page."} action={emptyAction} />;
  return (
    <div className={cn("overflow-auto", className)}>
      <table className={cn("w-full border-collapse", dense ? "text-[11px]" : "text-[12px]")}>
        <thead className="sticky top-0 z-[1] bg-surface text-left shadow-[0_1px_0_var(--color-line)]">
          <tr><th className="w-8 px-2 py-1 text-[11px] text-muted">#</th>
            {cols.map((c, i) => <th key={c} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted"><span className="inline-flex items-center gap-1">{colour(c, i) && <span className="inline-block size-2 rounded-sm" style={{ background: colour(c, i) }} />}{c}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(i) : undefined} className={cn("border-t border-line/70 align-top", onRow && "cursor-pointer hover:bg-surface-2", selected === i && "bg-accent-soft")}>
              <td className="px-2 py-1 font-mono text-[10px] text-muted">{i + 1}</td>
              {cols.map((c) => <td key={c} className="max-w-[360px] px-2 py-1"><Cell value={r[c]} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <div className="px-2 py-1 text-[11px] text-muted">… {rows.length - max} more rows</div>}
    </div>
  );
}

/** a file value (Document.download()): {filename, content_type, size, base64} */
const isFile = (v: unknown): v is { filename: string; content_type: string; size: number; base64: string } => isObj(v) && typeof v.base64 === "string" && typeof v.filename === "string";
function FileCell({ f }: { f: { filename: string; content_type: string; size: number; base64: string } }) {
  const href = React.useMemo(() => `data:${f.content_type || "application/octet-stream"};base64,${f.base64}`, [f]);
  return <a href={href} download={f.filename} className="inline-flex items-center gap-1 rounded border border-line px-1.5 text-accent hover:bg-surface-2" title={`${f.content_type} · ${f.size} bytes`}>⬇ {f.filename} <span className="text-[10px] text-muted">{f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1048576).toFixed(1)} MB`}</span></a>;
}

function Cell({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = React.useState(depth < 1);
  if (isFile(value)) return <FileCell f={value} />;
  if (value == null) return <span className="text-muted">—</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted">[]</span>;
    const objs = value.every(isObj);
    return (
      <div>
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1 font-mono text-[10px] text-muted">{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}{value.length} items</button>
        {open && (objs ? <div className="mt-1 rounded border border-line"><DataFrame rows={value as Record<string, unknown>[]} dense max={50} /></div>
          : <ul className="mt-1 flex flex-col gap-0.5">{value.slice(0, 50).map((v, i) => <li key={i} className="flex gap-1"><span className="font-mono text-[10px] text-muted">{i}</span><Cell value={v} depth={depth + 1} /></li>)}</ul>)}
      </div>
    );
  }
  if (isObj(value)) {
    const entries = Object.entries(value);
    return (
      <div>
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1 font-mono text-[10px] text-muted">{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}{`{${entries.length}}`}</button>
        {open && <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">{entries.map(([k, v]) => <React.Fragment key={k}><dt className="font-mono text-[10px] text-muted">{k}</dt><dd><Cell value={v} depth={depth + 1} /></dd></React.Fragment>)}</dl>}
      </div>
    );
  }
  if (typeof value === "string" && /^https?:\/\//.test(value)) return <a href={value} target="_blank" rel="noreferrer" className="truncate text-accent" title={value}>{value.replace(/^https?:\/\//, "").slice(0, 60)}</a>;
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

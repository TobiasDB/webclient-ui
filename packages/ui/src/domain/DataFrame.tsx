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
      <table className={cn("w-full border-collapse", dense ? "text-[10px] leading-[14px]" : "text-[12px]")}>
        <thead className="sticky top-0 z-[1] bg-surface text-left shadow-[0_1px_0_var(--color-line)]">
          <tr><th className="w-8 px-2 py-1 text-[11px] text-muted">#</th>
            {cols.map((c, i) => { const col = colour(c, i); return <th key={c} className={cn("px-2 py-1 text-[11px] font-semibold uppercase tracking-wide", !col && "text-muted", dense && "px-1 py-px text-[9.5px]")} style={col ? { color: col, boxShadow: `inset 0 -2px 0 ${col}`, background: `${col}14` } : undefined}>{c}</th>; })}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(i) : undefined} className={cn("border-t border-line/70 align-top", onRow && "cursor-pointer hover:bg-surface-2", selected === i && "bg-accent-soft")}>
              <td className={cn("px-2 py-1 font-mono text-[10px] text-muted", dense && "px-1 py-px text-[9px]")}>{i + 1}</td>
              {cols.map((c, ci) => { const col = colour(c, ci); return <td key={c} className={cn("max-w-[360px] px-2 py-1", dense && "max-w-[300px] px-1 py-px")} style={col ? { background: `${col}0d`, boxShadow: `inset 1px 0 0 ${col}33` } : undefined}><Cell value={r[c]} /></td>; })}
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

/** a one-line PREVIEW of a value: strings clipped, objects as {key: value, …}, lists as [n] */
export function preview(v: unknown, room = 90): string {
  if (v == null) return "—";
  if (typeof v === "string") { const t = v.replace(/\s+/g, " ").trim(); return t.length > room ? `"${t.slice(0, Math.max(room - 1, 4))}…"` : `"${t}"`; }
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  const parts: string[] = []; let left = room;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (left <= 8) { parts.push("…"); break; } const p = `${k}: ${preview(x, Math.min(28, left - k.length - 2))}`; parts.push(p); left -= p.length + 2; }
  return `{${parts.join(", ")}}`;
}

/** A cell: long text is CLAMPED to two lines (click to read it all, click again to fold), nested
 * objects and lists are FOLDED to a one-line preview (click to open) -- so a row stays one glance tall. */
function Cell({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = React.useState(false);
  if (isFile(value)) return <FileCell f={value} />;
  if (value == null) return <span className="text-muted">—</span>;
  const toggle = (e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open); };
  const head = (label: string) => (
    <button type="button" onClick={toggle} className="flex max-w-full min-w-0 items-center gap-1 rounded bg-surface-2 px-1 text-left font-mono text-[10px] text-muted hover:text-ink" title={open ? "fold" : "open"}>
      {open ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}<span className="min-w-0 truncate">{label}</span>
    </button>
  );
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted">[]</span>;
    const objs = value.every(isObj);
    return (
      <div className="min-w-0">
        {head(open ? `${value.length} items` : `${value.length} items · ${value.slice(0, 3).map((x) => preview(x, 30)).join(", ")}${value.length > 3 ? ", …" : ""}`)}
        {open && (objs ? <div className="mt-1 rounded border border-line"><DataFrame rows={value as Record<string, unknown>[]} dense max={50} /></div>
          : <ul className="mt-1 flex flex-col gap-0.5">{value.slice(0, 50).map((v, i) => <li key={i} className="flex min-w-0 gap-1"><span className="font-mono text-[10px] text-muted">{i}</span><Cell value={v} depth={depth + 1} /></li>)}</ul>)}
      </div>
    );
  }
  if (isObj(value)) {
    const entries = Object.entries(value);
    return (
      <div className="min-w-0">
        {head(open ? `{${entries.length}}` : preview(value))}
        {open && <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">{entries.map(([k, v]) => <React.Fragment key={k}><dt className="font-mono text-[10px] text-muted">{k}</dt><dd className="min-w-0"><Cell value={v} depth={depth + 1} /></dd></React.Fragment>)}</dl>}
      </div>
    );
  }
  if (typeof value === "string" && /^https?:\/\//.test(value)) return <a href={value} target="_blank" rel="noreferrer" className="block truncate text-accent" title={value}>{value.replace(/^https?:\/\//, "").slice(0, 60)}</a>;
  const text = String(value);
  if (text.length <= 90 && !text.includes("\n")) return <span className="break-words">{text}</span>;
  return <span onClick={toggle} className={cn("block cursor-pointer break-words", open ? "whitespace-pre-wrap" : "line-clamp-2")} title={open ? "click to fold" : `${text.length.toLocaleString()} characters -- click to read it all`}>{text}</span>;
}

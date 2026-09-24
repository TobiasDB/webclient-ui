import * as React from "react";
import { cn } from "../lib/cn";
import { EmptyState } from "../primitives/EmptyState";
import type { Row } from "../types";

export type RowsTableProps = {
  rows: Row[];
  /** Column order + colours (index-matched to the field highlights). */
  columns?: string[];
  colours?: string[];
  className?: string;
  /** Why there are no rows (the ledger hint) and what to do. */
  emptyHint?: React.ReactNode;
  emptyAction?: React.ReactNode;
  max?: number;
};

const cell = (v: unknown) => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** Extracted rows as a table. The 0-row state is a designed state (story 2.1): it explains
 * why and offers the next action rather than showing an empty grid. */
export function RowsTable({ rows, columns, colours, className, emptyHint, emptyAction, max = 200 }: RowsTableProps) {
  const cols = columns ?? Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  if (!rows.length) return <EmptyState title="0 rows" hint={emptyHint ?? "The record selector matched nothing on this page."} action={emptyAction} />;
  return (
    <div className={cn("overflow-auto", className)}>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface text-left">
          <tr>
            <th className="w-8 px-2 py-1 text-[11px] text-muted">#</th>
            {cols.map((c, i) => (
              <th key={c} className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted">
                <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm" style={{ background: colours?.[i] ?? "var(--color-line-2)" }} />{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-line hover:bg-surface-2">
              <td className="px-2 py-1 font-mono text-muted">{i + 1}</td>
              {cols.map((c) => <td key={c} className="max-w-64 truncate px-2 py-1 text-ink" title={cell(r[c])}>{cell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <div className="p-2 text-[11px] text-muted">… {rows.length - max} more</div>}
    </div>
  );
}

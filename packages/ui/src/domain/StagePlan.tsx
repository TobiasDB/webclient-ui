import * as React from "react";
import { cn } from "../lib/cn";
import type { Stage, StageStat } from "../lib/stages";

export type StagePlanProps = {
  stages: Stage[];
  stats: Record<string, StageStat>;
  /** the event index the view is at (for "active" = touched in the last few events) */
  at: number;
  running: boolean;
  onStage?: (s: Stage) => void;
  className?: string;
};

const KIND_COLOUR: Record<string, string> = { FETCH: "#2563eb", PAGES: "#2563eb", EACH: "#7c3aed", FIND: "#0891b2", READ: "#16a34a", CAST: "#16a34a", COLUMNS: "#ca8a04", EMIT: "#64748b", MERGE: "#64748b", ACT: "#db2777" };

/** The run as an EXPLAIN tree that realises live: each stage (FETCH, PAGES, EACH, FIND, READ,
 * CAST, COLUMNS, EMIT…) with how many times it ran so far, lit while active, dim until reached,
 * red where it failed -- the columns of a record branch under COLUMNS. */
export function StagePlan({ stages, stats, at, running, onStage, className }: StagePlanProps) {
  const max = Math.max(1, ...Object.values(stats).map((s) => s.count));
  const row = (s: Stage): React.ReactNode => {
    const st: StageStat = stats[s.id] ?? { count: 0, errors: [], fanout: 0 };
    const active = running && st.last !== undefined && at - st.last < 12;
    const reached = st.count > 0 || st.errors.length > 0;
    return (
      <li key={s.id}>
        <button type="button" onClick={() => onStage?.(s)} className={cn("flex w-full items-center gap-1 rounded-sm px-1 text-left font-mono text-[10px] leading-[16px] hover:bg-surface-2", !reached && "opacity-45", active && "bg-accent-soft")}>
          <span className="w-12 shrink-0 rounded-sm px-0.5 text-center text-[8.5px] font-semibold text-white" style={{ background: KIND_COLOUR[s.kind] ?? "#64748b" }}>{s.kind}</span>
          <span className="min-w-0 truncate"><span className="text-muted">{s.op}</span>{s.arg ? <span className="text-ok"> {s.arg.length > 34 ? s.arg.slice(0, 33) + "…" : s.arg}</span> : null}{s.column ? <span className="text-accent"> → {s.column}</span> : null}</span>
          <span className="flex-1" />
          {st.errors.length > 0 && <span className="shrink-0 rounded-sm bg-bad-soft px-0.5 text-[9px] text-bad" title={st.errors.slice(0, 3).map((e) => `${e.code}: ${e.message}`).join("\n")}>✕{st.errors.length}</span>}
          <span className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(st.count / max) * 100}%`, background: KIND_COLOUR[s.kind] ?? "#64748b" }} /></span>
          <span className="w-8 shrink-0 text-right text-[9px] tabular-nums text-muted">{st.count || ""}</span>
          <span className={cn("size-1.5 shrink-0 rounded-full", st.errors.length ? "bg-bad" : active ? "animate-pulse bg-accent" : reached ? "bg-ok" : "bg-line")} />
        </button>
        {s.children.length > 0 && <ul className="ml-2 border-l border-line/60 pl-1">{s.children.map(row)}</ul>}
      </li>
    );
  };
  return <ul className={cn("flex flex-col", className)}>{stages.map(row)}</ul>;
}

import * as React from "react";
import { cn } from "../lib/cn";
import { Chip } from "../primitives/Chip";
import type { IndexedElement } from "../types";

export type ElementTableProps = {
  elements: IndexedElement[];
  /** The selected index (a picked record / control). */
  selected?: number | null;
  onSelect?: (el: IndexedElement) => void;
  onHover?: (el: IndexedElement | null) => void;
  className?: string;
  emptyHint?: string;
};

/** The numbered, class-free element table -- exactly what a model sees (stories 1.2, 2.1,
 * 4.1): index · role · name · repeats. Selectors are never shown here (the "as code" drawer
 * has them); the user reasons in numbers, like the loops do. */
export function ElementTable({ elements, selected, onSelect, onHover, className, emptyHint = "No elements of this kind." }: ElementTableProps) {
  if (!elements.length) return <div className="p-3 text-[12px] text-muted">{emptyHint}</div>;
  return (
    <table className={cn("w-full border-collapse text-[12px]", className)}>
      <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
        <tr><th className="w-10 px-2 py-1">#</th><th className="w-24 px-2 py-1">role</th><th className="px-2 py-1">name</th><th className="w-16 px-2 py-1">repeats</th></tr>
      </thead>
      <tbody>
        {elements.map((e) => (
          <tr key={e.index} onClick={() => onSelect?.(e)} onMouseEnter={() => onHover?.(e)} onMouseLeave={() => onHover?.(null)}
            className={cn("cursor-pointer border-t border-line hover:bg-surface-2", selected === e.index && "bg-accent-soft")}>
            <td className="px-2 py-1 font-mono text-muted">{e.index}</td>
            <td className="px-2 py-1"><Chip tone={e.kind === "interactive" ? "accent" : "neutral"}>{e.role}</Chip></td>
            <td className="truncate px-2 py-1 text-ink" title={e.name}>{e.name || <span className="text-muted">(no label)</span>}</td>
            <td className="px-2 py-1 text-muted">{e.repeats > 1 ? `×${e.repeats}` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

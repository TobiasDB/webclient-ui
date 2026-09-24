import * as React from "react";
import { cn } from "../lib/cn";

export type SkeletonPaneProps = {
  skeleton: string;
  /** The line to highlight (e.g. the element hovered in the preview, matched by its open tag). */
  active?: string | null;
  onLineClick?: (line: string) => void;
  className?: string;
};

/** The token-lean DOM outline, one line per element, with the legend folded into a header;
 * `← RECORD LIST` lines are emphasised (story 1.2). Click a line to copy its tag. */
export function SkeletonPane({ skeleton, active, onLineClick, className }: SkeletonPaneProps) {
  const lines = React.useMemo(() => skeleton.split("\n"), [skeleton]);
  const header = lines.filter((l) => l.startsWith("#"));
  const body = lines.filter((l) => !l.startsWith("#"));
  return (
    <div className={cn("h-full overflow-auto font-mono text-[12px] leading-5", className)}>
      {header.length > 0 && (
        <details className="mb-1 text-muted">
          <summary className="cursor-pointer select-none">legend · {header.length} note(s)</summary>
          {header.map((l, i) => <div key={i} className="whitespace-pre-wrap pl-2">{l}</div>)}
        </details>
      )}
      {body.map((l, i) => {
        const record = l.includes("← RECORD LIST");
        const injected = l.includes("[xhr]") || l.includes("[js]");
        const isActive = !!active && l.trim().startsWith(active);
        return (
          <div key={i} onClick={() => onLineClick?.(l.trim())}
            className={cn("cursor-pointer whitespace-pre rounded px-1 hover:bg-surface-2", record && "bg-ok-soft/60 text-ok", injected && "text-tier-browser", isActive && "bg-accent-soft")}>
            {l}
          </div>
        );
      })}
    </div>
  );
}

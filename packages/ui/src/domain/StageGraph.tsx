import * as React from "react";
import { cn } from "../lib/cn";

export type StageNode = { id: string; label: string; sub?: string; active?: boolean; live?: boolean; ok?: boolean; count?: number; steps?: number };
export type StageEdge = { from: string; to: string; label?: string };

/** The plan's pages as a graph: the listing, the detail pages followed from a link field,
 * each node with its record count and recorded steps; click a node to make it the stage
 * you are working on. Laid out left to right by depth. */
export function StageGraph({ nodes, edges, onSelect, onAdd, className, height = 150 }: { nodes: StageNode[]; edges: StageEdge[]; onSelect?: (id: string) => void; onAdd?: () => void; className?: string; height?: number }) {
  const depth = new Map<string, number>();
  const parentOf = new Map(edges.map((e) => [e.to, e.from]));
  const d = (id: string): number => { if (depth.has(id)) return depth.get(id)!; const p = parentOf.get(id); const v = p ? d(p) + 1 : 0; depth.set(id, v); return v; };
  nodes.forEach((n) => d(n.id));
  const cols = new Map<number, StageNode[]>();
  for (const n of nodes) { const k = depth.get(n.id) ?? 0; if (!cols.has(k)) cols.set(k, []); cols.get(k)!.push(n); }
  const W = 210, H = 56, GX = 60, GY = 12;
  const pos = new Map<string, { x: number; y: number }>();
  [...cols.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, list]) => list.forEach((n, i) => pos.set(n.id, { x: 12 + k * (W + GX), y: 12 + i * (H + GY) })));
  const width = 24 + (cols.size) * (W + GX);
  const rows = Math.max(1, ...[...cols.values()].map((l) => l.length));
  const h = Math.max(height, 24 + rows * (H + GY));
  return (
    <div className={cn("overflow-auto rounded-lg border border-line bg-surface-2", className)} style={{ height: Math.min(h, 320) }}>
      <svg width={width} height={h} className="block">
        {edges.map((e, i) => { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return null; const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2; return (
          <g key={i}><path d={`M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`} className="fill-none stroke-accent/60" strokeWidth={1.5} />
            {e.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="fill-accent font-mono text-[9px]">{e.label}</text>}</g>); })}
        {nodes.map((n) => { const p = pos.get(n.id)!; return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => onSelect?.(n.id)}>
            <rect width={W} height={H} rx={8} className={cn("stroke-[1.5]", n.active ? "fill-accent-soft stroke-accent" : "fill-surface stroke-line")} />
            {n.live && <circle cx={W - 12} cy={12} r={4} className="fill-ok"><title>live page</title></circle>}
            <text x={10} y={20} className="fill-ink text-[12px] font-semibold">{n.label.slice(0, 26)}</text>
            <text x={10} y={36} className="fill-muted font-mono text-[10px]">{(n.sub ?? "").slice(0, 34)}</text>
            <text x={10} y={50} className="fill-muted text-[10px]">{n.count != null ? `${n.count} rows` : "no record"}{n.steps ? ` · ${n.steps} step${n.steps > 1 ? "s" : ""}` : ""}{n.ok === false ? " · !" : ""}</text>
          </g>); })}
        {onAdd && <g transform={`translate(${width - 10},${12})`} className="cursor-pointer" onClick={onAdd}><title>follow a link field into each record</title></g>}
      </svg>
    </div>
  );
}

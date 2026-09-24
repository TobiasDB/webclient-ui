import * as React from "react";
import { cn } from "../lib/cn";

export type MapPage = { url: string; title?: string | null; depth?: number };
export type MapEdge = { url: string; text?: string; depth: number; score: number; parent?: string };
export type MapFailure = { url: string; reason: string };

export type FrontierMapProps = {
  seeds: string[];
  pages: MapPage[];
  frontier: MapEdge[];
  failures?: MapFailure[];
  /** frontier urls the reader has picked for the next step */
  picked?: Set<string>;
  onPick?: (url: string) => void;
  onOpen?: (url: string) => void;
  className?: string;
  height?: number;
};

const short = (u: string) => { try { const x = new URL(u); return (x.pathname + x.search).replace(/\/$/, "") || "/"; } catch { return u; } };

/** The crawl as a map: fetched pages (solid) and the unresolved frontier (hollow, sized by
 * score), laid out in columns by depth, with a line from each edge to the page it was
 * found on. Click a frontier node to pick it for the next step (story 3.1). */
export function FrontierMap({ seeds, pages, frontier, failures = [], picked, onPick, onOpen, className, height = 420 }: FrontierMapProps) {
  const nodes = React.useMemo(() => {
    type N = { id: string; kind: "page" | "edge" | "fail"; depth: number; label: string; score: number; parent?: string; title?: string | null };
    const byUrl = new Map<string, N>();
    const depthOf = new Map<string, number>();
    seeds.forEach((s) => depthOf.set(s, 0));
    // pages get their depth from the edge that led to them (else 0 for seeds, 1 otherwise)
    for (const e of frontier) if (!depthOf.has(e.url)) depthOf.set(e.url, e.depth);
    for (const p of pages) { const d = p.depth ?? depthOf.get(p.url) ?? (seeds.includes(p.url) ? 0 : 1); byUrl.set(p.url, { id: p.url, kind: "page", depth: d, label: short(p.url), score: 1, title: p.title }); }
    for (const f of failures) if (!byUrl.has(f.url)) byUrl.set(f.url, { id: f.url, kind: "fail", depth: depthOf.get(f.url) ?? 1, label: short(f.url), score: 0.5, title: f.reason });
    for (const e of frontier.slice(0, 80)) if (!byUrl.has(e.url)) byUrl.set(e.url, { id: e.url, kind: "edge", depth: e.depth, label: short(e.url), score: e.score, parent: e.parent, title: e.text });
    // pages whose parent is known (from an edge that was later fetched) keep the line
    for (const e of frontier) { const n = byUrl.get(e.url); if (n && !n.parent && e.parent) n.parent = e.parent; }
    return [...byUrl.values()];
  }, [seeds, pages, frontier, failures]);
  const cols = React.useMemo(() => { const m = new Map<number, typeof nodes>(); for (const n of nodes) { if (!m.has(n.depth)) m.set(n.depth, []); m.get(n.depth)!.push(n); } return [...m.entries()].sort((a, b) => a[0] - b[0]); }, [nodes]);
  const W = Math.max(640, cols.length * 240), colW = W / Math.max(1, cols.length);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach(([, list], ci) => { const rowH = Math.min(28, (height - 40) / Math.max(1, list.length)); list.forEach((n, ri) => pos.set(n.id, { x: ci * colW + 24, y: 30 + ri * rowH })); });
  const maxScore = Math.max(1, ...frontier.map((e) => e.score));
  return (
    <div className={cn("overflow-auto rounded-lg border border-line bg-surface-2", className)} style={{ height }}>
      <svg width={W} height={Math.max(height, 40 + Math.max(...cols.map(([, l]) => l.length), 1) * 28)} className="block">
        {cols.map(([d], ci) => <text key={d} x={ci * colW + 24} y={16} className="fill-muted font-mono text-[10px]">depth {d}</text>)}
        {nodes.map((n) => { const p = pos.get(n.id); const q = n.parent ? pos.get(n.parent) : undefined; if (!p || !q) return null; return <path key={`l-${n.id}`} d={`M${q.x + 6},${q.y} C${(q.x + p.x) / 2},${q.y} ${(q.x + p.x) / 2},${p.y} ${p.x - 6},${p.y}`} className={cn("fill-none", n.kind === "page" ? "stroke-ok/50" : "stroke-line")} strokeWidth={1} />; })}
        {nodes.map((n) => { const p = pos.get(n.id)!; const r = n.kind === "edge" ? 3 + 4 * Math.max(0, n.score) / maxScore : 5; const isPicked = picked?.has(n.id);
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} className={n.kind === "edge" && onPick ? "cursor-pointer" : onOpen ? "cursor-pointer" : ""} onClick={() => (n.kind === "edge" ? onPick?.(n.id) : onOpen?.(n.id))}>
              <title>{n.id}{n.title ? ` — ${n.title}` : ""}{n.kind === "edge" ? ` · score ${n.score.toFixed(2)}` : ""}</title>
              <circle r={r} className={cn(n.kind === "page" && "fill-ok", n.kind === "fail" && "fill-bad", n.kind === "edge" && (isPicked ? "fill-accent" : "fill-surface stroke-accent"))} strokeWidth={1.5} />
              <text x={r + 5} y={3.5} className={cn("font-mono text-[10px]", n.kind === "edge" ? "fill-muted" : "fill-ink")}>{n.label.slice(0, 34)}</text>
            </g>
          ); })}
      </svg>
    </div>
  );
}

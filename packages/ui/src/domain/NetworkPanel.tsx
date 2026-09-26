import * as React from "react";
import { cn } from "../lib/cn";
import { bytes, fieldGroups, hostOf, pathOfUrl, prettyBody, readItCode, type NetNode, type NetRequest, type NetworkView } from "../lib/network";

export type NetworkPanelProps = {
  view: NetworkView | null | undefined;
  /** a request's full body, when the view does not carry it (a recorded run: fetched from its event) */
  loadBody?: (r: NetRequest) => Promise<string | null>;
  /** outline these page nodes (CSS paths into the page), or clear (null) */
  onHighlight?: (selectors: string[] | null) => void;
  /** a request picked from outside (a node on the page was clicked: the request that filled it) */
  pick?: number | null;
  className?: string;
};

const TYPE_TONE: Record<string, string> = { document: "text-accent", xhr: "text-ok", fetch: "text-ok", script: "text-muted", stylesheet: "text-muted", image: "text-muted", font: "text-muted" };

/** THE PAGE'S NETWORK: every request its load made, on one time axis (a waterfall), data requests first-class --
 * each says how many of the page's nodes it filled. Open one: its facts, WHAT IT FILLED (grouped by the response
 * field each node shows -- hover a group to outline it on the page), its body, and the plan that reads it directly. */
export function NetworkPanel({ view, loadBody, onHighlight, pick, className }: NetworkPanelProps) {
  const [filter, setFilter] = React.useState<"data" | "all" | string>("data");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<number | null>(null);
  React.useEffect(() => { if (pick != null) { setOpen(pick); setFilter("all"); } }, [pick]);
  const reqs = view?.requests ?? [];
  const span = Math.max(0.05, ...reqs.map((r) => (r.at ?? 0) + (r.elapsed ?? 0)));
  const shown = reqs.filter((r) => (filter === "all" ? true : filter === "data" ? r.data : r.type === filter) && (!q || r.url.toLowerCase().includes(q.toLowerCase())));
  const types = Object.entries(view?.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const cur = reqs.find((r) => r.n === open) ?? null;
  if (!view) return <div className={cn("p-2 text-[10px] text-muted", className)}>no network recorded for this page (a static fetch, or a run from before network views)</div>;
  return (
    <div className={cn("flex min-h-0 flex-col text-[10px]", className)} data-testid="network">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-1 py-0.5">
        {(["data", "all"] as const).map((f) => <Tab key={f} on={filter === f} onClick={() => setFilter(f)}>{f === "data" ? `data ${reqs.filter((r) => r.data).length}` : `all ${reqs.length}`}</Tab>)}
        {types.map(([t, n]) => <Tab key={t} on={filter === t} onClick={() => setFilter(t)}>{t} {n}</Tab>)}
        <input className="ml-auto h-5 w-32 rounded border border-line bg-surface px-1" placeholder="filter urls" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {view.summary && <div className="shrink-0 truncate px-1 py-0.5 text-muted" title={view.summary}>{view.summary}</div>}
      <div className={cn("min-h-0 overflow-auto", cur ? "max-h-[45%] shrink-0" : "flex-1")}>
        {shown.map((r) => (
          <button key={r.n} type="button" data-testid="net-row" onClick={() => setOpen(open === r.n ? null : r.n)}
            onMouseEnter={() => r.produced?.length && onHighlight?.(r.produced.map((x) => x.selector))} onMouseLeave={() => onHighlight?.(null)}
            className={cn("grid w-full grid-cols-[28px_minmax(0,1fr)_46px_34px_52px_110px] items-center gap-1 px-1 text-left leading-[16px] hover:bg-surface-2", open === r.n && "bg-accent-soft")}
            title={`${r.method ?? "GET"} ${r.url}${r.frame ? `\nfrom the frame ${r.frame}` : ""}`}>
            <span className="text-right font-mono text-muted">{r.n}</span>
            <span className="min-w-0 truncate font-mono">
              {r.method && r.method !== "GET" && <b className="mr-0.5">{r.method}</b>}
              <span className="text-muted">{hostOf(r.url)}</span>{pathOfUrl(r.url)}
              {r.frame && <span className="ml-1 rounded bg-surface-3 px-0.5 text-muted">frame</span>}
              {!!r.matched && <span className="ml-1 rounded bg-ok-soft px-0.5 text-ok" title="page nodes showing a value of this response">fills {r.matched}</span>}
            </span>
            <span className={cn("truncate", TYPE_TONE[r.type ?? ""] ?? "text-muted")}>{r.type}</span>
            <span className={cn("font-mono", (r.status ?? 200) >= 400 ? "text-bad" : "text-muted")}>{r.status ?? ""}</span>
            <span className="text-right font-mono text-muted">{bytes(r.size)}</span>
            <span className="relative h-2 rounded-sm bg-surface-2" title={r.at != null ? `starts at ${r.at.toFixed(3)}s · takes ${((r.elapsed ?? 0) * 1000).toFixed(0)} ms` : "no timing"}>
              {r.at != null && <span className={cn("absolute inset-y-0 rounded-sm", r.data ? "bg-ok" : "bg-muted/50")} style={{ left: `${(r.at / span) * 100}%`, width: `${Math.max(0.8, ((r.elapsed ?? 0) / span) * 100)}%` }} />}
            </span>
          </button>
        ))}
        {!shown.length && <div className="p-2 text-muted">{filter === "data" ? "no data requests: this page's content is in its HTML" : "none"}</div>}
      </div>
      {cur && <Detail r={cur} loadBody={loadBody} onHighlight={onHighlight} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Detail({ r, loadBody, onHighlight, onClose }: { r: NetRequest; loadBody?: (r: NetRequest) => Promise<string | null>; onHighlight?: (s: string[] | null) => void; onClose: () => void }) {
  const [body, setBody] = React.useState<string | null>(r.body ?? null);
  const [loading, setLoading] = React.useState(false);
  const [q, setQ] = React.useState("");
  React.useEffect(() => { setBody(r.body ?? null); setQ(""); }, [r.n, r.body]);
  const fetchBody = async () => { if (!loadBody) return; setLoading(true); try { setBody(await loadBody(r)); } finally { setLoading(false); } };
  const groups = fieldGroups(r);
  const pretty = React.useMemo(() => (body ? prettyBody(body) : null), [body]);
  const lines = React.useMemo(() => (pretty ? pretty.text.split("\n") : []), [pretty]);
  const hits = q ? lines.map((l, i) => (l.toLowerCase().includes(q.toLowerCase()) ? i : -1)).filter((i) => i >= 0) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line" data-testid="net-detail">
      <div className="flex shrink-0 items-center gap-1 px-1 py-0.5">
        <b className="font-mono">{r.method ?? "GET"}</b>
        <span className="min-w-0 flex-1 truncate font-mono" title={r.url}>{r.url}</span>
        <button type="button" className="text-muted hover:text-ink" onClick={() => navigator.clipboard?.writeText(readItCode(r))} title={`copy the plan that reads it directly:\n${readItCode(r)}`}>copy as plan</button>
        <button type="button" className="text-muted hover:text-ink" onClick={onClose}>✕</button>
      </div>
      <div className="shrink-0 px-1 text-muted">
        {r.status} · {r.type}{r.content_type ? ` · ${r.content_type}` : ""} · {bytes(r.size)}{r.at != null ? ` · at ${r.at.toFixed(3)}s, ${((r.elapsed ?? 0) * 1000).toFixed(0)} ms` : ""}{r.frame ? ` · from the frame ${r.frame}` : ""}
      </div>
      {groups.length > 0 && (
        <div className="shrink-0 px-1 py-0.5" data-testid="net-fills">
          <div className="font-semibold text-muted">filled on the page</div>
          {groups.map((g) => (
            <div key={g.shape} className="flex items-baseline gap-1" onMouseEnter={() => onHighlight?.(g.nodes.map((n) => n.selector))} onMouseLeave={() => onHighlight?.(null)}>
              <span className="shrink-0 cursor-default rounded bg-ok-soft px-0.5 font-mono text-ok" title="hover: outline them on the page">{g.shape} ×{g.nodes.length}</span>
              <span className="min-w-0 truncate text-muted">{g.nodes.slice(0, 4).map((n: NetNode) => n.text).filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 px-1">
        <span className="font-semibold text-muted">body</span>
        {!body && loadBody && r.data && <button type="button" className="text-accent hover:underline" onClick={fetchBody} disabled={loading}>{loading ? "loading…" : "load it"}</button>}
        {body && <input className="h-5 w-28 rounded border border-line bg-surface px-1" placeholder="find in body" value={q} onChange={(e) => setQ(e.target.value)} />}
        {q && <span className="text-muted">{hits.length} lines</span>}
        {r.truncated && <span className="text-warn">(its head: the body was large)</span>}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-1 font-mono text-[9.5px] leading-[13px]" data-testid="net-body">
        {!body ? <span className="text-muted">{r.data ? (loadBody ? "" : "no body kept") : "not a data request: its body is not kept"}</span>
          : q ? hits.slice(0, 400).map((i) => <div key={i}><span className="text-muted">{i + 1} </span>{lines[i]}</div>) : pretty!.text.slice(0, 200_000)}
      </pre>
    </div>
  );
}

const Tab = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
  <button type="button" onClick={onClick} className={cn("rounded px-1", on ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>{children}</button>;

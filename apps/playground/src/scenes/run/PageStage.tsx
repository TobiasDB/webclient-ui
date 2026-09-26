/** THE PAGES of the item on screen, at the moment on screen. One page: the Document the step ran on -- its
 * snapshot at that moment, or its browser recording seeked there -- with the step's own element spotlit, the
 * current event as a card over it, and that page's requests below.
 *
 * A NESTED CRAWL (a link read off a page and opened, up to n deep) is shown as the CHAIN it is: the page the
 * item came from (smaller, the link it followed spotlit), an ARROW from that link to the page it opened (the main
 * pane, the step on screen), and any pages further back folded into chips -- never more than two panes, so it
 * stays readable and never swaps back and forth. */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageFrame, Player, cn, graphLib, runLib, stagesLib, withAgent, type RunEvent } from "@webclient/ui";
import { api } from "../../lib/api";

type Rect = { left: number; top: number; width: number; height: number };
type Props = {
  traceId: string | null;
  events: RunEvent[];
  model: runLib.PlanModel | null;
  /** the run at the cursor, and all of it (a page's recording is known before the moment reaches it) */
  state: runLib.RunState;
  full: runLib.RunState;
  addr: string | null;
  item: runLib.ItemKey;
  maxHeight: number;
  /** how many pages the item's chain shows (the Run layout gives a chain more room) */
  onChain?: (n: number) => void;
};

export function PageStage({ traceId, events, model, state, full, addr, item, maxHeight, onChain }: Props) {
  // the step on screen: the one selected, else this item's latest
  const latest = React.useMemo(() => runLib.latestFor(state, item), [state, item]);
  const target = addr ?? latest?.addr ?? null;
  const chain = React.useMemo(() => (model && target != null ? runLib.pageChain(model, state, target, item) : []), [model, state, target, item]);
  const shown = chain.slice(-2); const folded = chain.slice(0, -2);
  React.useEffect(() => { onChain?.(Math.max(1, shown.length)); }, [shown.length, onChain]);

  // the current event for this item: the caption on the main pane
  const ev = React.useMemo(() => { for (let i = state.n - 1; i >= 0 && state.n - i < 4000; i--) { const e = events[i]!; const k = runLib.keyOf(e.item); if ((item === "" || k === item || k.startsWith(`${item}.`)) && runLib.MOMENT(e)) return { e, i }; } return null; }, [events, state.n, item]);
  const told = ev ? runLib.tell(ev.e, model) : null;
  const node = model && target ? model.byAddr.get(target) : undefined;
  const colour = node ? stagesLib.ACTION_COLOUR[stagesLib.actionOf(node.op)] : "#2457e6";
  const card = told && ev ? <EventCard key={ev.i} told={told} colour={colour} item={runLib.keyOf(ev.e.item)} n={(ev.e as { n?: number }).n} /> : null;

  // no plan / nothing located: the page last touched, alone
  if (shown.length <= 1) {
    const where = shown[0] ?? (lastDoc(state) ? { doc: lastDoc(state)!, hops: [], op: "", addr: "", via: "" } : null);
    return <PagePane traceId={traceId} events={events} state={state} full={full} where={where} item={item} colour={colour} label={node?.label ?? ""} card={card} requests maxHeight={maxHeight} />;
  }
  return <Chain traceId={traceId} events={events} model={model} state={state} full={full} item={item} shown={shown} folded={folded} colour={colour} label={node?.label ?? ""} card={card} maxHeight={maxHeight} />;
}

/** two panes, the link on the first drawn to the second */
function Chain({ traceId, events, model, state, full, item, shown, folded, colour, label, card, maxHeight }: { traceId: string | null; events: RunEvent[]; model: runLib.PlanModel | null; state: runLib.RunState; full: runLib.RunState; item: string; shown: runLib.ChainLink[]; folded: runLib.ChainLink[]; colour: string; label: string; card: React.ReactNode; maxHeight: number }) {
  const box = React.useRef<HTMLDivElement>(null); const toPane = React.useRef<HTMLDivElement>(null);
  const [from, setFrom] = React.useState<Rect | null>(null);
  const [, bump] = React.useState(0);
  React.useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => bump((x) => x + 1)); ro.observe(el); return () => ro.disconnect(); }, []);
  const [a, b] = shown as [runLib.ChainLink, runLib.ChainLink];
  const opens = a.opens && model ? model.byAddr.get(a.opens) : undefined;
  const via = model ? model.byAddr.get(a.via) : undefined;
  const linkColour = "#2563eb";
  // the arrow: from the link (its right edge, mid-height) to the opened page's pane (its top-left, under the header)
  let arrow: React.ReactNode = null;
  const c = box.current?.getBoundingClientRect(); const t = toPane.current?.getBoundingClientRect();
  if (c && t) {
    const x2 = t.left - c.left + 2, y2 = t.top - c.top + 34;
    const fromOk = from && from.width > 0 && from.left + from.width / 2 > c.left && from.left < t.left;
    const x1 = fromOk ? Math.min(from!.left + from!.width, t.left - 12) - c.left : x2 - 60, y1 = fromOk ? from!.top + from!.height / 2 - c.top : y2;
    const dx = Math.max(30, (x2 - x1) * 0.5);
    arrow = (
      <svg key={`${a.doc}>${b.doc}`} className="pointer-events-none absolute inset-0 z-30 overflow-visible" width="100%" height="100%">
        <defs><marker id="wc-chain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={linkColour} /></marker></defs>
        {fromOk && <circle cx={x1} cy={y1} r={4} fill={linkColour} />}
        <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none" stroke={linkColour} strokeWidth={2.2} strokeDasharray={fromOk ? undefined : "4 3"} markerEnd="url(#wc-chain-arrow)" className="wc-chain-arrow" />
        <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 6} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill={linkColour} className="wc-chain-label">{opens?.label ?? "resolve()"}</text>
      </svg>
    );
  }
  return (
    <div ref={box} className="relative flex h-full min-h-0 gap-2">
      {folded.length > 0 && (
        <div className="flex w-[92px] shrink-0 flex-col gap-1 overflow-auto border-r border-line py-1 pr-1" title="the pages before: each opened the next">
          {folded.map((f, i) => { const d = state.docs.get(f.doc); return (
            <div key={f.doc} className="rounded border border-line bg-surface-2 px-1 py-0.5 text-[9px] leading-tight">
              <div className="font-semibold text-muted">page {i + 1}</div>
              <div className="truncate font-mono" title={d?.url}>{shortPath(d?.url)}</div>
              <div className="text-muted">↓ {f.hops.map((h) => h.sel).join(" › ") || "link"}</div>
            </div>); })}
        </div>
      )}
      {/* the page it came from: smaller, the link it followed spotlit */}
      <div className="flex min-w-0 flex-[1] flex-col overflow-hidden rounded border border-line">
        <PagePane traceId={traceId} events={events} state={state} full={full} where={a} item={item} colour={linkColour} label={`${via?.label ?? "the link"} → followed`} compact title={`page ${folded.length + 1} · the link it followed`} onSpot={setFrom} maxHeight={maxHeight} />
      </div>
      {/* the page it opened: the step on screen */}
      <div ref={toPane} className="flex min-w-0 flex-[1.7] flex-col overflow-hidden rounded border-2 border-accent/50">
        <PagePane traceId={traceId} events={events} state={state} full={full} where={b} item={item} colour={colour} label={label} card={card} requests title={`page ${folded.length + 2}`} maxHeight={maxHeight} />
      </div>
      {arrow}
    </div>
  );
}

/** ONE page at the moment: its snapshot or recording, the element spotlit, (optionally) the event card and its requests */
function PagePane({ traceId, events, state, full, where, item, colour, label, card, requests, compact, title, onSpot, maxHeight }: { traceId: string | null; events: RunEvent[]; state: runLib.RunState; full: runLib.RunState; where: { doc: string; hops: runLib.Hop[] } | null; item: string; colour: string; label: string; card?: React.ReactNode; requests?: boolean; compact?: boolean; title?: string; onSpot?: (r: Rect | null) => void; maxHeight: number }) {
  const docId = where?.doc;
  const dr = docId ? state.docs.get(docId) : undefined;
  const recorded = !!(docId && full.docs.get(docId)?.rrweb.length);
  const snapN = dr?.snaps.length ? (events[dr.snaps[dr.snaps.length - 1]!.i] as { n?: number } | undefined)?.n : undefined;
  const page = useQuery({ queryKey: ["run-doc", traceId, docId, snapN], queryFn: () => api.traceDocument(traceId!, docId!, snapN), enabled: !!traceId && !!docId && !recorded && snapN != null, staleTime: Infinity, retry: 1, placeholderData: (p) => (p && p.document_id === docId ? p : undefined) });
  const rr = useQuery({ queryKey: ["run-rrweb", traceId, docId], queryFn: () => api.traceRrweb(traceId!, docId!), enabled: !!traceId && !!docId && recorded, staleTime: Infinity, retry: 1 });
  const hops = where?.hops;
  const parsed = React.useMemo(() => (page.data?.content ? new DOMParser().parseFromString(withAgent(page.data.content, page.data.final_url ?? page.data.url, true), "text/html") : null), [page.data]);
  const found = React.useMemo(() => (parsed && hops ? runLib.resolveHops(parsed, hops) : null), [parsed, hops]);
  const highlights = React.useMemo(() => {
    if (!found?.el) return [];
    const others = found.all.filter((x) => x !== found.el).slice(0, 60);
    return [...(others.length ? [{ paths: others.map(graphLib.pathOf), colour, dashed: true }] : []), { paths: [graphLib.pathOf(found.el)], colour, label, spot: true }];
  }, [found, colour, label]);
  const [pDoc, setPDoc] = React.useState<Document | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { const a = setTimeout(() => setTick((x) => x + 1), 150); const b = setTimeout(() => setTick((x) => x + 1), 700); return () => { clearTimeout(a); clearTimeout(b); }; }, [state.n, pDoc]);
  const pFound = React.useMemo(() => (recorded && pDoc && hops ? runLib.resolveHops(pDoc, hops) : null), [recorded, pDoc, hops, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pHighlights = React.useMemo(() => {
    if (!pFound?.el || !pFound.el.isConnected) return [];
    const others = pFound.all.filter((x) => x !== pFound.el).slice(0, 60);
    return [...(others.length ? [{ selector: "", els: others, colour, dashed: true, key: "others" }] : []), { selector: "", els: [pFound.el], colour, label, key: "own", spot: true }];
  }, [pFound, colour, label]);
  const at = events[Math.max(0, state.n - 1)];
  const reqs = requests && dr ? dr.requests.map((k) => state.requests[k]!).filter(Boolean) : [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex min-w-0 items-center gap-1.5 border-b border-line px-1.5 py-0.5", compact ? "text-[9.5px]" : "text-[10px]")}>
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">{title ?? "page"}</span>
        {!compact && <span className="shrink-0 rounded bg-surface-2 px-1 font-mono">{item ? `item ${item}` : "the run"}</span>}
        {dr ? <>
          <span className="min-w-0 truncate font-mono" title={dr.url}>{(dr.url ?? dr.id).replace(/^https?:\/\//, "")}</span>
          {dr.status != null && <span className={cn("shrink-0 font-mono", dr.status >= 400 ? "text-bad" : "text-ok")}>{dr.status}</span>}
          {!compact && <span className="shrink-0 rounded bg-surface-2 px-1 text-muted" title={recorded ? "a browser recording, played to this moment" : "the page as captured at this moment"}>{recorded ? "recording" : "snapshot"}</span>}
          {!compact && hops && hops.length > 0 && <span className="min-w-0 truncate text-muted" title="the way down to this item's element">{hops.map((h) => `${h.sel}${h.index != null ? `[${h.index}]` : ""}`).join(" › ")}</span>}
        </> : <span className="text-muted">{state.n ? "no page yet" : "the plan has not run: press Run ▶, or open a recorded run"}</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {card}
        {!docId ? null
          : !traceId ? <div className="p-2 text-muted">this run is not recorded: no pages to show</div>
          : recorded ? (rr.data?.length ? <Player events={rr.data as never} seekTo={at?.ts ? at.ts * 1000 : null} controls={false} pulses={false} glide pace={0} highlights={pHighlights} scrollTo={pFound?.el ?? null} onDocument={setPDoc} onSpot={onSpot} maxHeight={maxHeight} /> : <div className="p-2 text-muted">{rr.isLoading ? "loading the recording…" : "no recording of this page"}</div>)
          : page.data?.content ? <PageFrame html={page.data.content} base={page.data.final_url ?? page.data.url} stripScripts highlights={highlights} scrollTo={found?.el ? graphLib.pathOf(found.el) : null} onSpot={onSpot} maxHeight={maxHeight} width={compact ? 1100 : 1180} />
          : <div className="p-2 text-muted">{page.isLoading ? "loading the page…" : snapN == null ? "the page is being fetched…" : "no snapshot of this page"}</div>}
        {hops && hops.length > 0 && found && !found.el && page.data && <div className="absolute bottom-1 left-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">this item's element is not on the page as captured</div>}
      </div>
      {reqs.length > 0 && (
        <div className="max-h-[76px] shrink-0 overflow-auto border-t border-line font-mono text-[9.5px]">
          {reqs.slice(-40).map((r) => (
            <div key={r.i} className="flex items-center gap-1.5 px-1.5 leading-[14px]" title={r.url}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: r.failed ? "#dc2626" : r.kind === "navigation" ? "#2563eb" : r.kind === "request" ? "#ea580c" : "#94a3b8" }} />
              <span className="w-9 shrink-0 text-muted">{r.method}</span>
              <span className="min-w-0 flex-1 truncate">{r.url.replace(/^https?:\/\/[^/]+/, "") || r.url}</span>
              <span className={cn("shrink-0", r.failed ? "text-bad" : "text-muted")}>{r.status ?? ""}</span>
              <span className="w-12 shrink-0 text-right text-muted">{r.ms ? `${Math.round(r.ms)} ms` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** the moment, in words, over the page (it slides in anew with each one) */
function EventCard({ told, colour, item, n }: { told: runLib.Told; colour: string; item: string; n?: number }) {
  return (
    <div className="wc-evcard pointer-events-none absolute right-2 top-2 z-20 max-w-[min(360px,75%)] rounded-md px-2 py-1 font-mono text-[10.5px] leading-snug shadow-lg" style={{ ["--c" as never]: told.bad ? "#dc2626" : colour }}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide opacity-75">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: told.bad ? "#dc2626" : colour }} /><span>{told.kind}</span>
        {item && <span>· item {item}</span>}{n != null && <span className="ml-auto">#{n}</span>}
      </div>
      <div className="break-words font-semibold [overflow-wrap:anywhere]">{told.text}</div>
      {told.detail && <div className="line-clamp-2 break-words opacity-80 [overflow-wrap:anywhere]">{told.detail}</div>}
    </div>
  );
}

const shortPath = (u?: string) => (u ?? "").replace(/^https?:\/\/[^/]+/, "") || u || "";
const lastDoc = (s: runLib.RunState): string | undefined => { let best: runLib.DocRun | undefined; for (const d of s.docs.values()) if (!best || d.last > best.last) best = d; return best?.id; };

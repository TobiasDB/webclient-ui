/** THE PAGE of the item on screen, at the moment on screen: the Document the step ran on -- its snapshot at
 * that moment, or its browser recording seeked there -- with the step's own element spotlit (found exactly:
 * `runLib.locate`), the current event as a card over it (tell), and that page's requests below. */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageFrame, Player, cn, graphLib, runLib, stagesLib, withAgent, type RunEvent } from "@webclient/ui";
import { api } from "../../lib/api";

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
};

export function PageStage({ traceId, events, model, state, full, addr, item, maxHeight }: Props) {
  // the step on screen: the one selected, else this item's latest
  const latest = React.useMemo(() => runLib.latestFor(state, item), [state, item]);
  const target = addr ?? latest?.addr ?? null;
  const where = React.useMemo(() => (model && target != null ? runLib.locate(model, state, target, item) : null), [model, state, target, item]);
  // no plan (or nothing located yet): the page last touched
  const docId = where?.doc ?? lastDoc(state);
  const dr = docId ? state.docs.get(docId) : undefined;
  const recorded = !!(docId && full.docs.get(docId)?.rrweb.length);
  // the snapshot AT this moment: the latest captured up to the cursor
  const snapN = dr?.snaps.length ? (events[dr.snaps[dr.snaps.length - 1]!.i] as { n?: number } | undefined)?.n : undefined;
  const page = useQuery({ queryKey: ["run-doc", traceId, docId, snapN], queryFn: () => api.traceDocument(traceId!, docId!, snapN), enabled: !!traceId && !!docId && !recorded && snapN != null, staleTime: Infinity, retry: 1, placeholderData: (p) => (p && p.document_id === docId ? p : undefined) });
  const rr = useQuery({ queryKey: ["run-rrweb", traceId, docId], queryFn: () => api.traceRrweb(traceId!, docId!), enabled: !!traceId && !!docId && recorded, staleTime: Infinity, retry: 1 });

  // the current event for this item: the caption
  const ev = React.useMemo(() => { for (let i = state.n - 1; i >= 0 && state.n - i < 4000; i--) { const e = events[i]!; const k = runLib.keyOf(e.item); if ((item === "" || k === item || k.startsWith(`${item}.`)) && runLib.MOMENT(e)) return { e, i }; } return null; }, [events, state.n, item]);
  const told = ev ? runLib.tell(ev.e, model) : null;
  const node = model && target ? model.byAddr.get(target) : undefined;
  const colour = node ? stagesLib.ACTION_COLOUR[stagesLib.actionOf(node.op)] : "#2457e6";
  const label = node ? node.label : "";

  // the element: the hops, applied to exactly what the frame renders
  const parsed = React.useMemo(() => (page.data?.content ? new DOMParser().parseFromString(withAgent(page.data.content, page.data.final_url ?? page.data.url, true), "text/html") : null), [page.data]);
  const found = React.useMemo(() => (parsed && where ? runLib.resolveHops(parsed, where.hops) : null), [parsed, where]);
  const highlights = React.useMemo(() => {
    if (!found?.el) return [];
    const others = found.all.filter((x) => x !== found.el).slice(0, 60);
    return [...(others.length ? [{ paths: others.map(graphLib.pathOf), colour, dashed: true }] : []), { paths: [graphLib.pathOf(found.el)], colour, label, spot: true }];
  }, [found, colour, label]);
  // the recording: its rebuilt DOM at this moment
  const [pDoc, setPDoc] = React.useState<Document | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { const a = setTimeout(() => setTick((x) => x + 1), 150); const b = setTimeout(() => setTick((x) => x + 1), 700); return () => { clearTimeout(a); clearTimeout(b); }; }, [state.n, pDoc]);
  const pFound = React.useMemo(() => (recorded && pDoc && where ? runLib.resolveHops(pDoc, where.hops) : null), [recorded, pDoc, where, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pHighlights = React.useMemo(() => {
    if (!pFound?.el || !pFound.el.isConnected) return [];
    const others = pFound.all.filter((x) => x !== pFound.el).slice(0, 60);
    return [...(others.length ? [{ selector: "", els: others, colour, dashed: true, key: "others" }] : []), { selector: "", els: [pFound.el], colour, label, key: "own", spot: true }];
  }, [pFound, colour, label]);
  const at = events[Math.max(0, state.n - 1)];

  const requests = dr ? dr.requests.map((k) => state.requests[k]!).filter(Boolean) : [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-line px-1.5 py-0.5 text-[10px]">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">page</span>
        <span className="shrink-0 rounded bg-surface-2 px-1 font-mono">{item ? `item ${item}` : "the run"}</span>
        {dr ? <>
          <span className="min-w-0 truncate font-mono" title={dr.url}>{(dr.url ?? dr.id).replace(/^https?:\/\//, "")}</span>
          {dr.status != null && <span className={cn("shrink-0 font-mono", dr.status >= 400 ? "text-bad" : "text-ok")}>{dr.status}</span>}
          <span className="shrink-0 rounded bg-surface-2 px-1 text-muted" title={recorded ? "a browser recording, played to this moment" : "the page as captured at this moment"}>{recorded ? "recording" : "snapshot"}</span>
          {where && where.hops.length > 0 && <span className="min-w-0 truncate text-muted" title="the way down to this item's element">{where.hops.map((h) => `${h.sel}${h.index != null ? `[${h.index}]` : ""}`).join(" › ")}</span>}
        </> : <span className="text-muted">{state.n ? "no page yet" : "the plan has not run: press Run ▶, or open a recorded run"}</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {told && ev && <EventCard key={ev.i} told={told} colour={colour} item={runLib.keyOf(ev.e.item)} n={(ev.e as { n?: number }).n} />}
        {!docId ? null
          : !traceId ? <div className="p-2 text-muted">this run is not recorded: no pages to show</div>
          : recorded ? (rr.data?.length ? <Player events={rr.data as never} seekTo={at?.ts ? at.ts * 1000 : null} controls={false} pulses={false} highlights={pHighlights} scrollTo={pFound?.el ?? null} onDocument={setPDoc} maxHeight={maxHeight} /> : <div className="p-2 text-muted">{rr.isLoading ? "loading the recording…" : "no recording of this page"}</div>)
          : page.data?.content ? <PageFrame html={page.data.content} base={page.data.final_url ?? page.data.url} stripScripts highlights={highlights} scrollTo={found?.el ? graphLib.pathOf(found.el) : null} maxHeight={maxHeight} width={1180} />
          : <div className="p-2 text-muted">{page.isLoading ? "loading the page…" : snapN == null ? "the page is being fetched…" : "no snapshot of this page"}</div>}
        {where && where.hops.length > 0 && found && !found.el && page.data && <div className="absolute bottom-1 left-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">this item's element is not on the page as captured</div>}
      </div>
      {requests.length > 0 && (
        <div className="max-h-[76px] shrink-0 overflow-auto border-t border-line font-mono text-[9.5px]">
          {requests.slice(-40).map((r) => (
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

const lastDoc = (s: runLib.RunState): string | undefined => { let best: runLib.DocRun | undefined; for (const d of s.docs.values()) if (!best || d.last > best.last) best = d; return best?.id; };

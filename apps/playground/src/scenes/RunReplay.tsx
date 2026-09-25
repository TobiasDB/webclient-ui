/** The Run workspace's REPLAY pieces (docs/product/run-replay.md): the replay screen (the page the
 * selected item is on, the step's OWN element outlined) and the events grouped Stage ▸ Item ▸ event. */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageFrame, cn, graphLib, replayLib, stagesLib, type RunEvent } from "@webclient/ui";
import { api } from "../lib/api";

type Stage = ReturnType<typeof stagesLib.stagesOf>[number];
type Stats = ReturnType<typeof stagesLib.stageStats>;
/** what is being watched: a stage and / or an item (its index path joined, "" = the root); null = follow */
export type Pick = { stage?: string | null; item?: string | null } | null;

const keyOf = (e: RunEvent) => (e.item ?? []).join(".");
const docOf = (e: RunEvent) => (e as { document_id?: string }).document_id;
const selectorOf = (e: RunEvent) => e.detail?.selector as string | undefined;

/** the moment on screen: the last step / action / fetch (up to `at`) of the picked item / stage (or any: follow) */
export function currentStep(events: RunEvent[], stageOf: (string | null)[], at: number, pick: Pick): number {
  for (let i = Math.min(at, events.length) - 1; i >= 0; i--) {
    const e = events[i]!;
    if (pick?.item != null && keyOf(e) !== pick.item) continue;
    if (pick?.stage && stageOf[i] !== pick.stage) continue;
    if ((e.topic === "plan" && e.phase === "step") || e.topic === "action" || e.topic === "snapshot") return i;
  }
  return -1;
}

export function ReplayScreen({ traceId, events, stageOf, stages, stats, at, pick, maxHeight }: { traceId: string | null; events: RunEvent[]; stageOf: (string | null)[]; stages: Stage[]; stats: Stats; at: number; pick: Pick; maxHeight: number }) {
  const all = React.useMemo(() => stagesLib.flatStages(stages), [stages]);
  const j = currentStep(events, stageOf, at, pick);
  const ev = j >= 0 ? events[j]! : null;
  // where the step is: its own page; a record's step (on an element: no page id) is on the page whose span of the
  // fan-out holds the record; anything else on its item's last page (its detail page's fetch)
  const place = React.useMemo(() => {
    if (!ev || j < 0) return null;
    const own = docOf(ev); const st = all.find((x) => x.id === stageOf[j]);
    const feed = st ? stats[st.id]?.feed : undefined; const fan = feed ? all.find((x) => x.id === feed) : undefined;
    const idx = (ev.item ?? []).length ? ev.item![ev.item!.length - 1]! : undefined;
    const spans = fan ? replayLib.pageSpans(events, stageOf, fan.id) : [];
    if (own) { const sp = spans.find((x) => x.doc === own); return { doc: own, fan, local: idx != null && sp ? idx - sp.from : idx }; }
    if (fan && idx != null) { const hit = replayLib.pageOfItem(spans, idx); if (hit) return { doc: hit.doc, fan, local: hit.local }; }
    const key = keyOf(ev);
    for (let k = j - 1; k >= 0 && j - k < 5000; k--) { const e = events[k]!; const d = docOf(e); if (d && keyOf(e) === key) return { doc: d, fan, local: idx }; }
    return null;
  }, [ev, j, events, stageOf, stats, all]);
  const doc = place?.doc;
  const page = useQuery({ queryKey: ["trace-doc", traceId, doc], queryFn: () => api.traceDocument(traceId!, doc!), enabled: !!traceId && !!doc, staleTime: Infinity, retry: 1 });
  const parsed = React.useMemo(() => (page.data?.content ? new DOMParser().parseFromString(page.data.content, "text/html") : null), [page.data?.content]);

  // the step whose element to outline: this one if it names a selector, else the last selecting step of the same item
  const target = React.useMemo(() => {
    if (!parsed || !ev || j < 0 || !place) return null;
    let k = j; const key = keyOf(ev);
    while (k >= 0) { const e = events[k]!; if (e.topic === "plan" && e.phase === "step" && keyOf(e) === key && (!docOf(e) || docOf(e) === doc) && selectorOf(e) && ["select", "select_all", "click", "write", "wait_for", "scroll"].includes(String(e.detail?.op))) break; k--; if (j - k > 400) { k = -1; break; } }
    if (k < 0) return null;
    const step = events[k]!;
    const fanSel = place.fan?.op === "select_all" ? place.fan.arg : undefined;
    const t = replayLib.targetOf(parsed, String(step.detail?.op), selectorOf(step), fanSel, place.local);
    return { t, step, label: `${String(ev.detail?.op ?? ev.topic)}${selectorOf(ev) ? ` ${selectorOf(ev)}` : ""}` };
  }, [parsed, ev, j, events, place, doc]);
  const colour = ev ? stagesLib.ACTION_COLOUR[stagesLib.actionOf(String(ev.detail?.op ?? "select"))] : "#2563eb";
  const highlights = React.useMemo(() => {
    if (!target) return [];
    const others = target.t.els.filter((e) => e !== target.t.own);
    return [
      ...(others.length ? [{ paths: others.slice(0, 60).map(graphLib.pathOf), colour, dashed: true }] : []),
      ...(target.t.own ? [{ paths: [graphLib.pathOf(target.t.own)], colour, label: target.label }] : []),
    ];
  }, [target, colour]);
  const scrollTo = target?.t.own ? graphLib.pathOf(target.t.own) : null;

  const item = ev ? keyOf(ev) : "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-line px-1.5 py-0.5 text-[10px]">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted">replay</span>
        {ev ? <>
          <span className="shrink-0 rounded bg-surface-2 px-1 font-mono">{item ? `item ${item}` : "root"}</span>
          <span className="min-w-0 truncate font-mono" style={{ color: colour }}>{target?.label ?? String(ev.detail?.op ?? ev.topic)}</span>
          {target && <span className="shrink-0 text-muted">{target.t.how === "item" ? `this item's element${target.t.els.length > 1 ? ` (1 of ${target.t.els.length})` : ""}` : "on the page"}</span>}
          <span className="flex-1" />
          <span className="min-w-0 truncate text-muted" title={page.data?.final_url ?? page.data?.url}>{(page.data?.final_url ?? page.data?.url ?? "").replace(/^https?:\/\//, "")}{page.data?.status_code ? ` · ${page.data.status_code}` : ""}</span>
        </> : <span className="text-muted">nothing on a page yet</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!traceId ? <div className="p-2 text-muted">the run is not recorded: no pages to replay</div>
          : page.isLoading ? <div className="p-2 text-muted">loading the page…</div>
          : page.data?.content ? <PageFrame html={page.data.content} base={page.data.final_url ?? page.data.url} stripScripts highlights={highlights} scrollTo={scrollTo} maxHeight={maxHeight} width={1180} />
          : <div className="p-2 text-muted">{doc ? "no snapshot of this page in the trace" : "…"}</div>}
      </div>
    </div>
  );
}

/** the events GROUPED: Stage ▸ Item ▸ events (counts, errors; only what is opened renders) */
export function EventTree({ events, stageOf, stages, at, onSeek, onPick, pick }: { events: RunEvent[]; stageOf: (string | null)[]; stages: Stage[]; at: number; onSeek: (i: number) => void; onPick: (p: Pick) => void; pick: Pick }) {
  const all = React.useMemo(() => stagesLib.flatStages(stages), [stages]);
  const groups = React.useMemo(() => {
    const byStage = new Map<string, Map<string, number[]>>();
    const n = Math.min(at, events.length);
    for (let i = 0; i < n; i++) {
      const e = events[i]!; if (e.topic === "resources") continue;
      const s = stageOf[i] ?? (docOf(e) ? "__page" : "__other");
      let m = byStage.get(s); if (!m) { m = new Map(); byStage.set(s, m); }
      const k = keyOf(e); const l = m.get(k); if (l) l.push(i); else m.set(k, [i]);
    }
    const order = [...all.map((s) => s.id), "__page", "__other"];
    return order.filter((id) => byStage.has(id)).map((id) => ({ id, stage: all.find((s) => s.id === id), items: byStage.get(id)! }));
  }, [events, stageOf, all, at]);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const line = (i: number) => {
    const e = events[i]!; const d = e.detail ?? {};
    const text = e.topic === "plan" ? `${e.phase}${d.op ? ` ${String(d.op)}` : ""}${d.selector ? ` ${String(d.selector)}` : ""}${d.n != null ? ` ×${String(d.n)}` : ""}${d.status ? ` ${String(d.status)}` : ""}`
      : e.topic === "error" ? `${(e as { error?: { code?: string; message?: string } }).error?.code ?? "error"} ${(e as { error?: { message?: string } }).error?.message ?? ""}`
      : `${e.phase ?? ""} ${String((e as { url?: string; final_url?: string }).url ?? (e as { final_url?: string }).final_url ?? "")}`;
    return <li key={i}><button type="button" onClick={() => onSeek(i + 1)} className={cn("flex w-full min-w-0 gap-1 px-1 text-left hover:bg-surface-2", i === at - 1 && "bg-accent-soft")}><span className="w-10 shrink-0 text-right text-muted">{i}</span><span className={cn("w-14 shrink-0 truncate", e.topic === "error" ? "text-bad" : e.topic === "plan" ? "text-accent" : "text-topic-network")}>{e.topic}</span><span className="min-w-0 flex-1 truncate" title={text}>{text}</span></button></li>;
  };
  return (
    <div className="min-h-0 overflow-auto font-mono text-[9.5px] leading-[14px]">
      {groups.map((g) => {
        const nEv = [...g.items.values()].reduce((a, l) => a + l.length, 0);
        const errs = [...g.items.values()].reduce((a, l) => a + l.filter((i) => events[i]!.topic === "error").length, 0);
        const label = g.stage ? `${g.stage.kind} ${g.stage.op}${g.stage.arg ? ` ${g.stage.arg}` : ""}${g.stage.column ? ` → ${g.stage.column}` : ""}` : g.id === "__page" ? "page & network" : "other";
        const isOpen = open.has(g.id);
        const keys = [...g.items.keys()];
        return (
          <div key={g.id} className="border-b border-line/60">
            <button type="button" onClick={() => { toggle(g.id); if (g.stage) onPick({ stage: g.id, item: pick?.item ?? null }); }} className={cn("flex w-full min-w-0 items-center gap-1 px-1 text-left hover:bg-surface-2", pick?.stage === g.id && "text-accent")}>
              <span className="w-3 shrink-0">{isOpen ? "▾" : "▸"}</span><span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-muted">{keys.length > 1 || keys[0] ? `${keys.length.toLocaleString()} items · ` : ""}{nEv.toLocaleString()}</span>
              {errs > 0 && <span className="shrink-0 text-bad">✕{errs}</span>}
            </button>
            {isOpen && <div className="pl-3">
              {keys.slice(0, 300).map((k) => {
                const ik = `${g.id}|${k}`; const list = g.items.get(k)!; const itemOpen = open.has(ik); const bad = list.some((i) => events[i]!.topic === "error");
                return (
                  <div key={k}>
                    <button type="button" onClick={() => { toggle(ik); onPick({ stage: g.stage ? g.id : null, item: k }); onSeek(list[list.length - 1]! + 1); }} className={cn("flex w-full min-w-0 items-center gap-1 px-1 text-left hover:bg-surface-2", pick?.item === k && "text-accent")}>
                      <span className="w-3 shrink-0">{itemOpen ? "▾" : "▸"}</span><span className="min-w-0 flex-1 truncate">{k ? `item ${k}` : "root"}</span><span className="shrink-0 text-muted">{list.length}</span>{bad && <span className="text-bad">✕</span>}
                    </button>
                    {itemOpen && <ol className="pl-3">{list.slice(0, 400).map(line)}</ol>}
                  </div>
                );
              })}
              {keys.length > 300 && <div className="px-1 text-muted">+{(keys.length - 300).toLocaleString()} more items (pick one on the graph or the lanes)</div>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

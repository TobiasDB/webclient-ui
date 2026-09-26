import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementInspector, EmptyState, FlagRow, GraphView, Input, MediaBar, PageFrame, ParamsEditor, PipelineGraph, Player, Select, SkeletonPane, checkPlan, stagesLib,
  TabPanel, Tabs, Toolbar, ToolbarSpacer, cn, describe, fieldColour, graphLib, needsArg, outputName, planLib, selectors, toolAsCode, usePlayerController,
  type Edge, type FrameAction, type OpParam, type FrameHighlight, type Graph, type Highlight, type InspectAdd, type InspectRead, type Pick, type Plan, type RREvent,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { call as callBody, plan as planBody, useActive, useSession } from "../lib/session";
import { encSpec } from "./Run";

const { addNode, updateNode, setMod, opOf, emptyGraph, children, pageOf, stateOf, stepsOfPage, evalAt, ACTIONS, evalNode, elementsOf, sample, hrefOf, compile, decompile, outputs, inputOf, pathOf, byPath, incomplete, isEl } = graphLib;
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { base64?: unknown }).base64 !== "string";
/** EXPLODE a nested row: a dict's keys become dotted columns; a list of dicts becomes one row per item
 * (the parent's columns repeated) -- how a nested page's rows read alongside their parent row. */
function explode(row: Record<string, unknown>, prefix = "", cap = 400): Record<string, unknown>[] {
  let outs: Record<string, unknown>[] = [{}];
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k;
    let sub: Record<string, unknown>[] | null = null;
    if (isPlain(v)) sub = explode(v, key, cap);
    else if (Array.isArray(v) && v.length && v.every(isPlain)) sub = (v as Record<string, unknown>[]).flatMap((x) => explode(x, key, cap));
    if (sub) outs = outs.flatMap((o) => sub!.map((x) => ({ ...o, ...x }))).slice(0, cap);
    else outs.forEach((o) => { o[key] = v; });
  }
  return outs;
}
const VIEWS = ["card", "content", "patterns", "records", "flags", "controls"];
const GROUP_HUES = ["#e11d48", "#7c3aed", "#0891b2", "#ca8a04", "#16a34a", "#db2777", "#2563eb", "#9333ea"];
type Tier = "false" | "auto" | "always";
type Page = { docId?: string; live?: boolean; url: string };
type State = { tier: Tier; graph: Graph };
type HL = { els: Element[]; colour: string; label?: string; dashed?: boolean };
type Suggestion = { label: string; value: string; sample?: string; count?: number; pattern?: string; number?: boolean; date?: boolean };

const enc = (s: State) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s: string): State | null => { try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o && o.graph && o.graph.nodes ? o : null; } catch { return null; } };
const browserKw = (tier: Tier) => (tier === "false" ? {} : { browser: tier === "always" ? true : "auto" });
const tierOf = (n: graphLib.GNode | undefined): Tier => { const b = n?.op?.kwargs.browser?.value; return b === true ? "always" : b === "auto" ? "auto" : "false"; };
const SELECTOR_OPS = ["select", "select_all", "click", "write", "wait_for"];
const ACTION_OPS = ["click", "write", "scroll", "wait_for"];
/** the node new ops hang off: the nearest Document / Element / Collection at or above `id` */
function scopeOf(g: Graph, id: string): graphLib.GNode | null { for (const n of graphLib.ancestors(g, id).reverse()) if (n.type === "Document" || n.type === "Element" || n.type === "Collection") return n; return null; }

/** THE Author workspace. The plan IS the graph of the package's objects -- Reference,
 * Document, Element, Collection, Value -- shown on the left as a literal plan. Click a line:
 * it is the FOCUS. The page renders just that object (its ancestors keep their styling), every
 * selector is rooted there, and the object's matches are outlined. The page is a real render
 * (its CSS and JS; a live page is the mirrored browser) and INTERACTIVE: following a link,
 * clicking a control, typing are recorded as nodes (shift: not recorded). An edge that needs a
 * selector puts the page in PICK mode: click an element (the inspector shows its hierarchy up
 * to the focus, classes and ids to toggle, the candidates by group, every match outlined) or a
 * suggestion (records for select_all, fields for select, attributes for attr). Outputs are
 * projected from the objects; Run executes the plan. */
export function Author() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/author");
  const sessionId = useSession();
  const qc = useQueryClient();
  const controller = usePlayerController();
  const opsQ = useQuery({ queryKey: ["ops"], queryFn: api.ops, staleTime: Infinity });
  const returns = React.useMemo(() => Object.fromEntries((opsQ.data?.Document ?? []).map((o) => [o.name, (o as { returns?: string }).returns ?? "Value"])), [opsQ.data]);

  // -- the model, its history, the URL ---------------------------------------------------------
  const [state, setStateRaw] = React.useState<State | null>(() => dec(params.get("g") ?? ""));
  const history = React.useRef<State[]>([]);
  const setGraph = React.useCallback((fn: (g: Graph) => Graph) => setStateRaw((s) => { if (!s) return s; const g = fn(s.graph); if (g === s.graph) return s; history.current = [...history.current.slice(-80), s]; return { ...s, graph: g }; }), []);
  const undo = () => { const prev = history.current.pop(); if (prev) setStateRaw(prev); };
  const [selected, setSelectedRaw] = React.useState<string>("root");
  const [editing, setEditing] = React.useState(false);
  const [pages, setPages] = React.useState<Record<string, Page>>({});
  const [docs, setDocs] = React.useState<Record<string, Document>>({});
  const [pickEl, setPickEl] = React.useState<Element | null>(null);
  const [paramsOpen, setParamsOpenRaw] = React.useState(false);
  const paramsBtn = React.useRef<HTMLButtonElement>(null);
  const [paramsAt, setParamsAt] = React.useState<{ x: number; y: number } | null>(null);
  // the popover floats over the page (the action bar clips what overflows it), under its button
  const setParamsOpen = (v: boolean) => { setParamsOpenRaw(v); const r = paramsBtn.current?.getBoundingClientRect(); setParamsAt(r ? { x: r.left, y: r.bottom + 2 } : null); };
  React.useLayoutEffect(() => { if (paramsOpen) { const r = paramsBtn.current?.getBoundingClientRect(); if (r) setParamsAt({ x: r.left, y: r.bottom + 2 }); } }, [paramsOpen, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const [building, setBuilding] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean; replay?: RREvent[]; trace?: string }>({ busy: false });
  const select = (id: string, edit = false) => { setSelectedRaw(id); setEditing(edit); setPickEl(null); setBuilding(null); };
  const reset = (s: State | null, sel = "root", keep: Record<string, Page> = {}) => { setStateRaw(s); history.current = []; setPages(keep); setDocs({}); select(sel); setRun({ busy: false }); };
  const start = (url: string, tier: Tier, keep?: Page) => { let g = emptyGraph(url); const r = addNode(g, g.root, opOf("resolve", [], browserKw(tier)), returns); g = r.graph; reset({ tier, graph: g }, r.id, keep ? { [r.id]: keep } : {}); };
  React.useEffect(() => { if (!active) return; setParams((q) => { const n = new URLSearchParams(q); if (state) n.set("g", enc(state)); else n.delete("g"); n.delete("url"); n.delete("doc"); n.delete("p"); return n; }, { replace: true }); }, [state, active, setParams]);
  React.useEffect(() => {
    if (!active) return;
    const url = params.get("url"); const doc = params.get("doc"); const tier = (params.get("tier") as Tier) ?? "auto";
    if (url) start(url, tier);
    else if (doc && sessionId) api.docs(sessionId).then((ds) => { const h = ds.find((d) => d.id === doc); if (h) start(h.url ?? "", h.tier === "browser" ? "always" : "false", { docId: h.id, live: !!h.live, url: h.url ?? "" }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, params.get("url"), params.get("doc"), sessionId]);
  const graph = state?.graph ?? null;
  const tier = state?.tier ?? "auto";
  const node = graph ? graph.nodes[selected] ?? graph.nodes[graph.root] : undefined;
  React.useEffect(() => { if (graph && !graph.nodes[selected]) select(graph.root); }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- the page the focus lives on -------------------------------------------------------------
  // the page on screen: the focused node's page -- for the Reference itself, the page it opens
  const pageNode = graph && node ? (pageOf(graph, node.id) ?? Object.values(graph.nodes).find((x) => x.parent === graph.root && x.op?.name === "resolve") ?? null) : null;
  const pageKey = pageNode?.id ?? "";
  const page = pages[pageKey];
  // the STEP on screen: the page, or the page after one of its actions (each has its own snapshot)
  const stateNode = graph && node ? (stateOf(graph, node.id) ?? pageNode) : pageNode;
  const stateKey = stateNode?.id ?? pageKey;
  const [snaps, setSnaps] = React.useState<Record<string, { html: string; url: string }>>({});
  /** the LIVE browser page: only the head of a page's steps has one (acting elsewhere forks it) */
  const [head, setHead] = React.useState<{ page: string; at: string; docId: string } | null>(null);
  const pageSteps = graph && pageNode ? stepsOfPage(graph, pageNode.id) : [];
  const stepIx = pageSteps.findIndex((x) => x.id === stateKey);
  /** the HEAD: the last step of the page's plan -- it is always LIVE (earlier steps show their snapshots) */
  const atHead = pageSteps.length > 0 && stepIx === pageSteps.length - 1;
  const liveDocId = atHead && head && head.page === pageKey && head.at === stateKey ? head.docId : null;
  /** actions done on the live page but not in the plan yet: they become steps as soon as a selector is used there */
  const [pending, setPending] = React.useState<{ op: string; args: unknown[]; from?: string; to?: string }[]>([]);
  /** the URL the live page is on now */
  const [liveUrl, setLiveUrl] = React.useState<string | null>(null);
  /** the live mirror's DOM -- it is the head's document only while nothing is pending (then the page IS the head's state) */
  const [mirrorDoc, setMirrorDoc] = React.useState<Document | null>(null);
  /** each page's static capture, parsed (a page's own document again once the live page has moved on) */
  const staticDocs = React.useRef<Record<string, Document>>({});
  const doc = docs[stateKey] ?? null;
  const pageUrl = React.useCallback((id: string): string | null => {
    if (!graph) return null; const n = graph.nodes[id]; if (!n || !n.parent) return null;
    if (n.parent === graph.root) return graph.url;
    const parentPage = pageOf(graph, n.parent); if (!parentPage) return null;
    return hrefOf(graph, n.parent, docs[parentPage.id] ?? null, pages[parentPage.id]?.url ?? graph.url);
  }, [graph, docs, pages]);
  const [openError, setOpenError] = React.useState<ApiError | null>(null);
  React.useEffect(() => {
    if (!active || !sessionId || !graph || !pageNode || page?.docId) return;
    const want = page?.url ?? pageUrl(pageNode.id); if (!want) return;
    const t = tierOf(pageNode); let on = true;
    api.docOpen(sessionId, { url: want, browser: t === "false" ? false : t === "auto" ? "auto" : "always", live: false })
      .then((h) => { if (on) { setPages((ps) => ({ ...ps, [pageNode.id]: { docId: h.id, live: !!h.live, url: want } })); setOpenError(null); qc.invalidateQueries({ queryKey: ["session-docs"] }); } })
      .catch((e) => { if (on) setOpenError(e as ApiError); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId, pageKey, page?.docId, page?.url, docs, graph?.url]);
  const views = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "author-g"], queryFn: () => api.docViews(sessionId!, page!.docId!, VIEWS), enabled: !!sessionId && !!page?.docId, staleTime: Infinity, retry: false });
  React.useEffect(() => { const e = views.error as ApiError | null; if (e && e.status === 404 && pageKey) setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } })); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.error]);
  const more = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "more"], queryFn: () => api.docViews(sessionId!, page!.docId!, ["skeleton", "markdown", "elements"]), enabled: !!sessionId && !!page?.docId && views.isSuccess, staleTime: Infinity });
  // the static page, parsed: the workspace's copy of the DOM the frame renders (selectors, samples, previews)
  React.useEffect(() => {
    const html = views.data?.content; if (!pageKey || !html || (liveDocId && stateKey === pageKey)) return;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    staticDocs.current[pageKey] = parsed;
    setDocs((ds) => ({ ...ds, [pageKey]: parsed }));
  }, [views.data?.content, pageKey, liveDocId, stateKey]);
  const reload = async () => { if (!sessionId || !page?.docId) return; await api.docReload(sessionId, page.docId); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, page.docId] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); setStream([]); since.current = 0; };

  // -- live: the mirrored browser page; clicks go through ------------------------------------------
  const [stream, setStream] = React.useState<RREvent[]>([]);
  /** fetch the live page's events NOW (after an action: its result shows without waiting for the next tick) */
  const pullNow = React.useRef<() => void>(() => undefined);
  // a live page that NAVIGATES starts a new recording (Meta + FullSnapshot): the mirror restarts there
  // (replaying the new page's events onto the old page's picture is what left a white screen)
  const liveStart = React.useMemo(() => { for (let i = stream.length - 1; i >= 0; i--) if ((stream[i] as { type?: number }).type === 4) return i; return 0; }, [stream]);
  const liveStream = React.useMemo(() => stream.slice(liveStart), [stream, liveStart]);
  const livePictured = liveStream.some((e) => (e as { type?: number }).type === 2);
  const since = React.useRef(0);
  const [recordActions, setRecordActions] = React.useState(true);
  const goLive = async (): Promise<string | null> => {
    if (!sessionId || !graph || !pageNode) return null;
    const want = page?.url ?? pageUrl(pageNode.id); if (!want) return null;
    for (const [k, pg] of Object.entries(pages)) if (pg.live && k !== pageKey && pg.docId) { api.docClose(sessionId, pg.docId).catch(() => undefined); setPages((ps) => ({ ...ps, [k]: { url: pg.url } })); }
    try { const h = await api.docOpen(sessionId, { url: want, browser: "always", live: true }); setPages((ps) => ({ ...ps, [pageKey]: { docId: h.id, live: true, url: want } })); setStream([]); since.current = 0; qc.invalidateQueries({ queryKey: ["session-docs"] }); return h.id; }
    catch (e) { setOpenError(e as ApiError); return null; }
  };
  React.useEffect(() => {
    if (!liveDocId) return;
    let on = true; const docId = liveDocId; setStream([]); since.current = 0;
    // (declared below: pullNow lets an action fetch its result at once, not at the next tick)
    const pull = async () => { try { const evs = await api.history({ since: since.current, document_id: docId, payload: true }); if (!on || !evs.length) return; since.current = Math.max(since.current, ...evs.map((c) => c.n ?? 0)); const out: RREvent[] = []; for (const e of evs) { if (e.topic === "rrweb") out.push(...((e.events ?? []) as RREvent[])); else if (e.topic !== "snapshot") { const { events: _d, content: _c, body: _b, ...payload } = e as any; out.push({ type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? Date.now() / 1000) * 1000) }); } } setStream((s) => [...s, ...out]); } catch { /* next tick */ } };
    pullNow.current = () => { void pull(); };
    pull(); const t = setInterval(pull, 250); return () => { on = false; clearInterval(t); pullNow.current = () => undefined; };
  }, [liveDocId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actError, setActError] = React.useState<ApiError | null>(null);
  // -- STEPS: an action is performed on the live head, then snapshotted; any step can be viewed, and
  // acting from an earlier one FORKS: a fresh live page replays the steps up to it (the old branch is kept, off)
  const argsOf = (n: graphLib.GNode) => (n.op?.args ?? []).map((x) => x.value);
  const snap = async (sid: string, docId: string, id: string) => {
    const v = await api.docViews(sid, docId, ["content"]); const html = (v as { content?: string }).content ?? "";
    setSnaps((m) => ({ ...m, [id]: { html, url: (v as { url?: string }).url ?? "" } }));
    setDocs((ds) => ({ ...ds, [id]: new DOMParser().parseFromString(html, "text/html") }));
  };
  /** a live page AT `st` (a step of the focused page): the head when it is there, else replayed to it */
  const liveAt = async (st: graphLib.GNode, g: Graph = graph!, fresh = false): Promise<string | null> => {
    if (!sessionId || !pageNode) return null;
    if (!fresh && head && head.page === pageNode.id && head.at === st.id) return head.docId;
    if (head) api.docClose(sessionId, head.docId).catch(() => undefined);
    // Author holds ONE live page: any other live page of this session (an earlier load's head, a tab
    // closed without releasing) goes back to the pool first -- else the pool runs dry and this waits forever
    try { for (const d of await api.docs(sessionId)) if ((d as { live?: boolean }).live && d.id !== head?.docId) await api.docClose(sessionId, d.id).catch(() => undefined); } catch { /* best effort */ }
    const url = page?.url ?? pageUrl(pageNode.id); if (!url) return null;
    setBusy("opening a live page");
    // a full browser pool makes this WAIT: say so (and where to free pages) rather than just spinning
    try { const hp = (await api.health()).pool as { pages_free?: number; pages_total?: number } | undefined; if (hp && hp.pages_free === 0) setBusy(`waiting for a browser page -- all ${hp.pages_total} are in use by other sessions (Settings → close other sessions)`); } catch { /* fine */ }
    const h = await api.docOpen(sessionId, { url, browser: "always", live: true, interactive: true });  // a person drives it: no simulated pointer path
    const steps = stepsOfPage(g, pageNode.id); const upto = steps.slice(1, steps.findIndex((x) => x.id === st.id) + 1);
    for (const x of upto) {  // replay step by step, snapshotting each (the steps get their pictures back)
      setBusy(`replaying .${x.op!.name}(…)`);
      await api.executeDoc({ plan: planBody("Document", [callBody(x.op!.name, argsOf(x))], sessionId), document_id: h.id });
      await snap(sessionId, h.id, x.id);
    }
    setHead({ page: pageNode.id, at: st.id, docId: h.id }); setLiveUrl(h.url ?? url);
    return h.id;
  };
  /** BACK on the live page: the browser's back button on the SAME page (no new page, nothing replayed).
   * The actions not in the plan are trimmed to those that lead to where it lands (by URL). */
  /** the live page is not where the head's own page is (it went elsewhere and no page of the plan claimed it) */
  const headOwnUrl = head ? (pages[head.page]?.url ?? (graph?.nodes[head.page]?.parent === graph?.root ? graph?.url : undefined)) : undefined;
  const awayFromHead = !!liveDocId && !!liveUrl && !!headOwnUrl && liveUrl !== headOwnUrl && head?.at === head?.page;
  const liveBack = async (): Promise<string | null> => {
    if (!sessionId || !liveDocId) return null; setActError(null); setBusy("going back");
    try {
      const h = await api.executeDoc({ plan: planBody("Document", [callBody("back", [])], sessionId), document_id: liveDocId }); pullNow.current();
      const u = h.url ?? null; setLiveUrl(u);
      setPending((ps) => { const out = [...ps]; while (out.length && out[out.length - 1]!.to !== u) out.pop(); return out; });
      return u;
    } catch (e) { setActError(e as ApiError); return null; } finally { setBusy(null); }
  };
  /** back to what the PLAN leaves: back until nothing is pending; only a click that made no history entry
   * (a tab, a filter) cannot be undone that way -- then the page is rebuilt at the head (the last resort) */
  const liveReset = async () => {
    if (!sessionId || !liveDocId || !stateNode) return;
    let ps = [...pending]; let url = liveUrl; let guard = 12;
    while ((ps.length > 0 || (awayFromHead && url !== headOwnUrl)) && guard-- > 0) {
      const u = await liveBack(); if (u === null) break;
      const moved = u !== url; url = u;
      while (ps.length && ps[ps.length - 1]!.to !== u) ps.pop();  // the same trim liveBack applies
      if (!moved) break;  // no history left to go back through
    }
    if (ps.length > 0 || (awayFromHead && url !== headOwnUrl)) { setActError(null); setBusy("rebuilding the page at the plan's head"); try { await liveAt(stateNode, graph!, true); setPending([]); pullNow.current(); } catch (e) { setActError(e as ApiError); } finally { setBusy(null); } }
  };
  /** perform `op` from the step on screen, snapshot the result, and record it as the next step */
  const act = async (op: string, args: unknown[], record = true) => {
    if (!sessionId || !graph || !pageNode || !stateNode) return;
    setActError(null);
    try {
      const docId = await liveAt(stateNode); if (!docId) return;
      setBusy(`.${op}(…)`);
      await api.executeDoc({ plan: planBody("Document", [callBody(op, args)], sessionId), document_id: docId });
      pullNow.current();
      if (!record) { await snap(sessionId, docId, stateNode.id); return; }
      // a step already after this one: the new step FORKS (the old branch is kept, switched off)
      let g = graph; for (const c of children(g, stateNode.id)) if (c.op && ACTIONS.has(c.op.name) && !c.off) g = updateNode(g, c.id, { off: true });
      // at the head: the actions done there first (unrecorded) come before it
      let at = stateNode.id; if (atHead && pending.length) { for (const a of pending) { const x = addNode(g, at, opOf(a.op, a.args), returns); g = x.graph; at = x.id; } setPending([]); }
      const r = addNode(g, at, opOf(op, args), returns); g = needBrowser(r.graph);
      await snap(sessionId, docId, r.id);
      setGraph(() => g); setHead({ page: pageNode.id, at: r.id, docId }); select(r.id);
    } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };
  /** a plain click on the live head: done on the page, NOT recorded yet (pending until a selector is used) */
  const clickThrough = async (sel: string) => {
    if (!sessionId || !liveDocId) return; setActError(null); setBusy(".click(…)");
    try { const from = liveUrl ?? undefined; const h = await api.executeDoc({ plan: planBody("Document", [callBody("click", [sel])], sessionId), document_id: liveDocId }); pullNow.current(); setLiveUrl(h.url ?? from ?? null); setPending((ps) => [...ps, { op: "click", args: [sel], from, to: h.url ?? from }]); }
    catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };
  // the mirror IS the head's document while nothing is pending; once the live page moved on (actions not in
  // the plan), the head keeps its own document (its static capture / snapshot) -- the preview and every line's
  // value stay computed on the page they belong to
  React.useEffect(() => {
    if (!head || !mirrorDoc || !liveDocId) return;
    if (!pending.length) { setDocs((ds) => (ds[head.at] === mirrorDoc ? ds : { ...ds, [head.at]: mirrorDoc })); return; }
    const own = staticDocs.current[head.at] ?? (snaps[head.at] ? new DOMParser().parseFromString(snaps[head.at]!.html, "text/html") : undefined);
    setDocs((ds) => { if (!own) { const { [head.at]: _drop, ...rest } = ds; return ds[head.at] === mirrorDoc ? rest : ds; } return ds[head.at] === own ? ds : { ...ds, [head.at]: own }; });
  }, [mirrorDoc, pending.length, head, liveDocId]); // eslint-disable-line react-hooks/exhaustive-deps
  // WHERE IN THE PLAN the live page is: after it moved on by clicks, a page of the plan whose selectors match it
  // (or whose URL it is) takes it over -- the live page is re-homed there (focus, selectors, actions, rows)
  const [placed, setPlaced] = React.useState<{ page: string; hits: number; of: number } | null>(null);
  React.useEffect(() => {
    if (!graph || !head || !mirrorDoc || !liveDocId) return;
    // only once the live page LEFT its step: actions not in the plan, or a URL that is not the head page's (back)
    const headUrl = pages[head.page]?.url ?? (graph.nodes[head.page]?.parent === graph.root ? graph.url : undefined);
    if (!pending.length && (!liveUrl || !headUrl || liveUrl === headUrl)) return;
    const t = setTimeout(() => {
      let best: { id: string; hits: number; of: number; score: number } | null = null;
      for (const r of Object.values(graph.nodes)) {
        if (r.op?.name !== "resolve" || r.id === head.page || graphLib.isOff(graph, r.id)) continue;
        const sels = Object.values(graph.nodes).filter((n) => n.parent && n.op && ["select", "select_all"].includes(n.op.name) && stateOf(graph, n.id)?.id === r.id && String(n.op.args[0]?.value ?? "").trim()).map((n) => String(n.op!.args[0]!.value));
        const hits = sels.filter((q) => { try { return !!mirrorDoc.querySelector(q); } catch { return false; } }).length;
        const own = pages[r.id]?.url ?? (r.parent === graph.root ? graph.url : undefined);
        const urlHit = !!liveUrl && own === liveUrl;
        let score: number;
        if (r.parent === graph.root) score = urlHit ? 1 : 0;  // the plan's own page: ITS url only (a look-alike list is not it)
        else {
          // a page opened from a link: the live URL must be one the plan would follow from the page before
          // (every item's link, when that page is at hand); the selectors decide only when those links are not known
          const pp = r.parent ? pageOf(graph, r.parent) : null; const pd = pp ? docOf(pp.id) : null;
          const hrefs = pp && pd && r.parent ? (() => { const v = evalNode(graph, r.parent!, pd); const base = pages[pp.id]?.url ?? graph.url; return (Array.isArray(v) ? v.flat(Infinity) : [v]).filter((x): x is string => typeof x === "string" && !!x).map((h) => { try { return new URL(h, base).toString(); } catch { return h; } }); })() : [];
          score = urlHit || (!!liveUrl && hrefs.includes(liveUrl)) ? 1 : sels.length ? hits / sels.length : 0;
        }
        if (score >= 0.6 && (!best || score > best.score)) best = { id: r.id, hits, of: sels.length, score };
      }
      if (!best) return;
      // re-home: this page of the plan is where the live page is; the clicks that got here are not steps
      // (the plan reaches it by its own link)
      const id = best.id;
      setPages((ps) => ({ ...ps, [id]: { ...(ps[id] ?? {}), url: liveUrl ?? ps[id]?.url ?? "" } }));
      setHead({ page: id, at: id, docId: liveDocId }); setPending([]); setPlaced({ page: id, hits: best.hits, of: best.of });
      select(id);
    }, 300);
    return () => clearTimeout(t);
  }, [mirrorDoc, liveUrl, pending.length]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (placed && head?.page !== placed.page) setPlaced(null); }, [head?.page]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving Author: its live page goes back to the pool
  const headRef = React.useRef(head); headRef.current = head;
  React.useEffect(() => () => { const h = headRef.current; if (h && sessionId) api.docClose(sessionId, h.docId).catch(() => undefined); }, [sessionId]);
  // the HEAD is always live: open (or replay to) it when it comes on screen
  const opening = React.useRef<string | null>(null);
  /** the ONE live page is on another page of the plan: this page shows its static copy until it is brought here */
  const liveElsewhere = !!head && !liveDocId && !!stateNode && atHead && head.page !== pageKey;
  React.useEffect(() => {
    if (!active || !sessionId || !graph || !stateNode || !atHead || liveDocId) return;
    if (head && head.page !== pageKey) return;  // never silently replace the live page the person is using
    const key = `${pageKey}|${stateKey}`; if (opening.current === key) return; opening.current = key;
    setPending([]); setActError(null);
    liveAt(stateNode).catch((e) => setActError(e as ApiError)).finally(() => { setBusy(null); opening.current = null; });
  }, [active, sessionId, pageKey, stateKey, atHead, liveDocId]); // eslint-disable-line react-hooks/exhaustive-deps
  /** bring the live page HERE: the same page navigates to this page's URL (nothing reopened, nothing replayed) */
  const bringLiveHere = async () => {
    if (!sessionId || !head || !pageNode || !stateNode) return;
    const url = page?.url ?? pageUrl(pageNode.id); if (!url) { await liveAt(stateNode).catch((e) => setActError(e as ApiError)); setBusy(null); return; }
    setActError(null); setBusy("bringing the live page here");
    try {
      const h = await api.executeDoc({ plan: planBody("Document", [callBody("goto", [url])], sessionId), document_id: head.docId });
      setHead({ page: pageNode.id, at: pageNode.id, docId: head.docId }); setPending([]); setLiveUrl(h.url ?? url); pullNow.current();
    } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };
  /** go live at the step on screen (a fork when it is not the head) */
  const goLiveHere = async () => { if (!stateNode) return; setActError(null); try { await liveAt(stateNode); } catch (e) { setActError(e as ApiError); } finally { setBusy(null); } };
  const runAction = async (op: string, args: unknown[], record: boolean, _under?: string) => act(op, args, record);

  // -- the focus: what renders, where selectors root -------------------------------------------------
  const takesSelector = !!node?.op && SELECTOR_OPS.includes(node.op.name);
  const selfMode = !!node && takesSelector && (needsArg(node) || editing);
  const attrMode = !!node?.op && node.op.name === "attr";  // an attr: its suggestions (every attribute, numbers) stay at hand   // picking the focused node's OWN selector
  const values = React.useMemo(() => { const out: Record<string, unknown> = {}; if (!graph) return out; for (const n of Object.values(graph.nodes)) { const st = stateOf(graph, n.id); if (st && docs[st.id]) out[n.id] = evalAt(graph, n.id, docs[st.id]!); } return out; }, [graph, docs]);
  // -- the PLAN CHECK: every line evaluated on the pages we have; a page opened from a link that is not
  // on screen is fetched in the background from the FIRST item's link, as the example it is checked on
  const [checkDocs, setCheckDocs] = React.useState<Record<string, { url: string; doc: Document }>>({});
  const checking = React.useRef(new Set<string>());
  // a NEW session (the old one was lost): what the old one held is gone -- reopen the pages in the new one
  const prevSid = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!sessionId) return;
    if (prevSid.current && prevSid.current !== sessionId) {
      setPages((ps) => Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, { url: v.url }])));
      setDocs({}); setHead(null); setCheckDocs({}); checking.current.clear(); setStream([]); setPending([]); setActError(null);
    }
    prevSid.current = sessionId;
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const docOf = React.useCallback((id: string): Document | null => docs[id] ?? checkDocs[id]?.doc ?? null, [docs, checkDocs]);
  React.useEffect(() => {
    if (!active || !sessionId || !graph) return;
    for (const n of Object.values(graph.nodes)) {
      if (n.op?.name !== "resolve" || !n.parent || n.parent === graph.root || docs[n.id]) continue;
      const pp = pageOf(graph, n.parent); if (!pp) continue;
      const url = hrefOf(graph, n.parent, docOf(pp.id), pages[pp.id]?.url ?? checkDocs[pp.id]?.url ?? graph.url); if (!url) continue;
      const key = `${n.id}|${url}`; if (checkDocs[n.id]?.url === url || checking.current.has(key)) continue;
      checking.current.add(key);
      const t = tierOf(n); const sid = sessionId;
      api.docOpen(sid, { url, browser: t === "false" ? false : t === "auto" ? "auto" : "always", live: false })
        .then((h) => api.docViews(sid, h.id, ["content"]))
        .then((v) => { const html = (v as { content?: string }).content; if (html) setCheckDocs((c) => ({ ...c, [n.id]: { url, doc: new DOMParser().parseFromString(html, "text/html") } })); })
        .catch(() => { /* unchecked: the line says so */ });
    }
  }, [active, sessionId, graph, docs, checkDocs, pages, docOf]);
  const problems = React.useMemo(() => (graph ? checkPlan(graph, docOf, graph.url) : {}), [graph, docOf]);
  const problemList = React.useMemo(() => Object.entries(problems).filter(([, p]) => p.level !== "info"), [problems]);

  /** the rendered roots: the focused node's input when picking its own selector (or reading a value
   * off it), else its output -- ALL of a collection's elements; the page when empty */
  const roots: Element[] = React.useMemo(() => {
    if (!graph || !node || !doc) return [];
    const inputSide = selfMode || node.type === "Value" || node.type === "Reference";
    const src = inputSide ? (node.parent ? graph.nodes[node.parent] : undefined) : node;
    if (!src || src.type === "Document" || src.type === "Reference") return [];
    return elementsOf(values[src.id]);
  }, [graph, node, doc, selfMode, values]);
  const root: Element | null = roots[0] ?? null;
  /** what the page SHOWS: the records of the nearest collection at or above the focus (so a value or
   * an element is seen in its record), else the page -- the selector roots above stay as they are */
  const shownRoots: Element[] = React.useMemo(() => {
    if (!graph || !node || !doc) return [];
    for (const n of graphLib.ancestors(graph, node.id).reverse()) { if (n.type === "Document" && n.op?.name === "resolve") return []; if (n.type === "Collection") return elementsOf(values[n.id]); }
    return roots;
  }, [graph, node, doc, values, roots]);
  const rootFor = (el: Element | null): Element | null => (el ? roots.find((r) => r === el || r.contains(el)) ?? null : null);
  const inRoots = (el: Element) => !roots.length || roots.some((r) => r === el || r.contains(el));
  const scope = graph && node ? scopeOf(graph, node.id) : null;
  const rootLabel = root ? `${roots.length > 1 ? "each " : ""}${root.tagName.toLowerCase()}${selectors.semantic([...root.classList]).slice(0, 2).map((c) => `.${c}`).join("")}${roots.length > 1 ? ` ×${roots.length}` : ""}` : "the page";
  // highlights (elements of the workspace's DOM): the focus's own matches, the outputs, the selector under construction
  const hls: HL[] = [];
  const outs = graph ? outputs(graph) : [];
  if (graph && node && doc) {
    // a value's elements are those it was READ from: up the chain to the nearest node holding elements
    // (select → attr → number: the select's) -- never past the page
    const elsUp = (id: string): Element[] => {
      let n: graphLib.GNode | undefined = graph.nodes[id];
      for (let k = 0; n && k < 12; k++) { const els = elementsOf(values[n.id]); if (els.length) return els; if (!n.parent || n.type === "Document") break; n = graph.nodes[n.parent]; if (n?.type === "Document") break; }
      return [];
    };
    outs.forEach((o, i) => { if (pageOf(graph, o.id)?.id !== pageKey) return; const els = elsUp(o.id).filter(inRoots); if (els.length) hls.push({ els, colour: fieldColour(i), label: o.output ?? "name from page" }); });
    if (node.op && !needsArg(node) && node.type !== "Document") { let els = elsUp(node.id); els = selfMode ? els : els.filter(inRoots); if (els.length) hls.push({ els, colour: "#2563eb", label: node.op.name }); }
    if (building) { try { const els = (roots.length ? roots : [doc]).flatMap((r) => [...r.querySelectorAll(building)]); hls.push({ els, colour: "#f59e0b", label: "match", dashed: true }); } catch { /* bad selector */ } }
  }
  const [showGroups, setShowGroups] = React.useState(false);
  const patternGroups = React.useMemo(() => {
    const out: { name: string; selector: string; count: number; colour: string; why: string }[] = [];
    for (const h of views.data?.patterns ?? []) if (h.subject && !out.some((o) => o.selector === h.subject)) out.push({ name: h.name.replace(/_/g, " "), selector: h.subject, count: h.count ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: `pattern · ${Math.round((h.confidence ?? 0) * 100)}%` });
    for (const r of views.data?.records ?? []) if (!out.some((o) => o.selector === r.selector)) out.push({ name: r.name || "repeating", selector: r.selector, count: r.repeats ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: "repeating region" });
    return out.slice(0, 8);
  }, [views.data]);
  if (showGroups && doc) for (const g of patternGroups) { try { hls.push({ els: [...doc.querySelectorAll(g.selector)], colour: g.colour, label: g.name, dashed: true }); } catch { /* bad */ } }
  const frameHls: FrameHighlight[] = hls.map((h) => ({ paths: h.els.slice(0, 400).map(pathOf), colour: h.colour, label: h.label, dashed: h.dashed }));
  const playerHls: Highlight[] = hls.map((h) => ({ selector: "", els: h.els, colour: h.colour, label: h.label, dashed: h.dashed }));

  // -- picking: shift-click → the inspector (rooted at the focus) -------------------------------------
  const pick: Pick | null = pickEl ? describe(pickEl) : null;
  const pickGroups = React.useMemo(() => { if (!pickEl) return []; return patternGroups.filter((g) => { try { return !!pickEl.closest(g.selector); } catch { return false; } }).map((g) => ({ name: g.name, colour: g.colour, count: g.count })); }, [pickEl, patternGroups]);
  const [pickShadow, setPickShadow] = React.useState(false);
  const onFramePick = (p: { path: number[]; shadow?: boolean }) => { if (!doc) return; const el = byPath(doc, p.path); setPickShadow(!!p.shadow); if (el) setPickEl(el); };
  /** a page whose content lives in shadow DOM / frames: the browser tier folds it into the capture */
  const useBrowser = () => { if (!pageNode?.op) return; setGraph((g) => updateNode(g, pageNode.id, { op: { ...pageNode.op!, kwargs: { ...pageNode.op!.kwargs, browser: { value: true } } } })); setPages((ps) => ({ ...ps, [pageNode.id]: { url: ps[pageNode.id]?.url ?? "" } })); setDocs((ds) => { const { [pageNode.id]: _d, ...rest } = ds; return rest; }); setPickEl(null); setPickShadow(false); };
  /** a picked <iframe>: its page as a Document of its own */
  const openFrame = () => {
    if (!graph || !pickEl || !node) return;
    // the pending op (waiting for this pick) goes; the frame's page hangs off what it hung off
    const pending = needsArg(node); const anchor = pending && node.parent ? scopeOf(graph, node.parent) : scope; if (!anchor) return;
    const sel = selFor(pickEl, true); let g = pending ? graphLib.removeNode(graph, node.id) : graph; const s1 = addNode(g, anchor.id, opOf("select", [sel]), returns); g = s1.graph; const h = addNode(g, s1.id, opOf("attr", ["src"]), returns); g = h.graph; const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); g = r.graph; setGraph(() => g); select(r.id);
  };
  /** a selector for an element the person acted on, rooted where it will be evaluated */
  /** a selector that points to THIS element and nothing else: an action runs on the whole page (`scoped`:
   * a select relative to the focus root, e.g. a link inside each record) -- verified, never "the first of several" */
  const selFor = (el: Element, scoped = false): string => { const r = scoped ? rootFor(el) ?? el.ownerDocument : el.ownerDocument; return selectors.exactSelector(el, r); };
  /** the node an action hangs off: the focused page / action node, else the page */
  const actionParent = (): graphLib.GNode | null => (node && node.type === "Document" ? node : pageNode);
  /** actions need a browser to replay: the page opens with one */
  const needBrowser = (g: Graph): Graph => { if (!pageNode?.op || pageNode.op.kwargs.browser?.value === true) return g; return updateNode(g, pageNode.id, { op: { ...pageNode.op, kwargs: { ...pageNode.op.kwargs, browser: { value: true } } } }); };
  /** the node already in the plan that an action on `el` corresponds to: for a link, a page opened
   * from an element that is (or holds) it; for a click / typing, an action whose selector matches it */
  const matchOf = (a: FrameAction, el: Element): graphLib.GNode | null => {
    if (!graph || !doc) return null;
    const hit = (els: Element[]) => els.some((x) => x === el || x.contains(el) || el.contains(x));
    for (const n of Object.values(graph.nodes)) {
      if (!n.op || !n.parent) continue;
      if (a.op === "navigate" && n.op.name === "resolve") {  // select(link) -> attr(href) -> resolve
        const h = graph.nodes[n.parent]; const sel = h?.parent ? graph.nodes[h.parent] : undefined;
        if (h?.op?.name === "attr" && sel && pageOf(graph, sel.id)?.id === pageKey && hit(elementsOf(values[sel.id]))) return n;
      }
      if ((a.op === "click" || a.op === "write") && n.op.name === a.op && pageOf(graph, n.id)?.id === pageKey) {
        try { if (hit([...doc.querySelectorAll(String(n.op.args[0]?.value ?? ""))])) return n; } catch { /* bad selector */ }
      }
    }
    return null;
  };
  const absolute = (href: string) => { try { return new URL(href, page?.url ?? graph?.url).toString(); } catch { return href; } };
  /** INTERACT mode: an action that matches part of the plan JUMPS there (a link opens that page);
   * with SHIFT it is recorded as nodes; otherwise the page just behaves (a link browses away). */
  const onFrameAction = (a: FrameAction): "browse" | void => {
    if (!graph || !doc) return; const el = byPath(doc, a.pick.path); if (!el) return a.op === "navigate" && !a.shift ? "browse" : undefined;
    const match = matchOf(a, el);
    if (match) {
      if (a.op === "navigate" && a.href) { const url = absolute(a.href); setPages((ps) => (ps[match.id]?.url === url ? ps : { ...ps, [match.id]: { url } })); setDocs((ds) => { const { [match.id]: _drop, ...rest } = ds; return rest; }); }
      if (a.op === "write" && a.shift) setGraph((g) => updateNode(g, match.id, { op: opOf("write", [String(match.op!.args[0]?.value ?? ""), a.value ?? ""]) }));
      select(match.id); return;
    }
    if (!a.shift) return a.op === "navigate" ? "browse" : undefined;  // not recorded: the page just behaves
    if (a.op === "navigate") {  // record: select the link, read its href, open it -- that page is the focus
      const under = node && (node.type === "Document" || node.type === "Element" || node.type === "Collection") && inRoots(el) ? node : scope; if (!under) return;
      let g = graph; const s1 = addNode(g, under.id, opOf("select", [selFor(el, true)]), returns); g = s1.graph;
      const h = addNode(g, s1.id, opOf("attr", ["href"]), returns); g = h.graph;
      const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); setGraph(() => r.graph);
      if (a.href) setPages((ps) => ({ ...ps, [r.id]: { url: absolute(a.href!) } }));
      select(r.id); return;
    }
    // a click / typing: PERFORMED on the live page at this step, snapshotted, recorded as the next step
    const sel = selFor(el);
    void act(a.op, a.op === "write" ? [sel, a.value ?? ""] : [sel]);
  };
  /** a READ under `at`: attr(name[, pattern]), then .number() when asked; the output sits on the last node */
  const addRead = (g: Graph, at: string, attr: string, extra: Partial<graphLib.GNode>, pattern?: string, number?: boolean, date?: boolean): { graph: Graph; id: string } => {
    const a = addNode(g, at, opOf("attr", pattern ? [attr, pattern] : [attr]), returns, number || date ? {} : extra);
    if (!number && !date) return a;
    return addNode(a.graph, a.id, opOf(date ? "date" : "number"), returns, extra);
  };
  const addReads = (g: Graph, under: string, reads: InspectRead[] | undefined, fallbackSel: string): Graph => {
    for (const rd of reads ?? []) {
      let at = under;
      if (rd.select) { const s = addNode(g, at, opOf("select", [rd.select]), returns); g = s.graph; at = s.id; }
      const name = rd.name || (rd.attr === "text" ? selectors.nameFromSelector(rd.select ?? fallbackSel, pickEl?.tagName.toLowerCase() ?? "") : rd.attr.replace(/[^a-z0-9]+/gi, "_"));
      g = addRead(g, at, rd.attr, rd.nameFrom ? { alias: [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: rd.nameFrom }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }] } : { output: name }, rd.pattern, rd.number, rd.date).graph;
    }
    return g;
  };
  /** the focused node takes the built selector */
  const onApply = (selector: string, reads: InspectRead[]) => {
    if (!graph || !node?.op) return;
    let g = updateNode(graph, node.id, { op: { ...node.op, args: node.op.args.map((a, i) => (i === 0 ? { value: selector } : a)) } });
    g = addReads(g, node.id, reads, selector);
    if (ACTION_OPS.includes(node.op.name)) g = needBrowser(g);  // an action replays in a browser
    setGraph(() => g); select(node.id);
  };
  /** an op on the picked element, added under the focus */
  const onAdd = async (a: InspectAdd) => {
    if (!graph) return;
    const under0 = !selfMode && node && (node.type === "Document" || node.type === "Element" || node.type === "Collection") ? node : scope; if (!under0 || !graph) return;
    setPickEl(null); setBuilding(null);
    const m = ACTION_OPS.includes(a.op) ? { g: graph, parent: under0.id } : materialize(graph, under0.id);
    const under = m.g.nodes[m.parent]!;
    if (a.op === "paginate" && pageNode) { setGraph((g) => setMod(g, pageNode.id, opOf("paginate", [], { max_pages: 5, ...a.kwargs }))); if (a.kwargs?.by === "action" && stateNode) await liveAt(stateNode); return; }
    if (ACTION_OPS.includes(a.op)) { await runAction(a.op, a.args ?? [a.selector], a.record !== false, under.id); return; }
    let g = m.g; let focus = under.id;
    if (a.op === "resolve") {
      const s = addNode(g, under.id, opOf("select", [a.selector]), returns); g = s.graph;
      const h = addNode(g, s.id, opOf("attr", ["href"]), returns); g = h.graph;
      const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); g = r.graph; focus = r.id;
    } else { const r = addNode(g, under.id, opOf(a.op, [a.selector]), returns); g = addReads(r.graph, r.id, a.reads, a.selector); focus = r.id; }
    setGraph(() => g); select(focus);
  };
  /** an edge of the focused object: a new node; one that needs a selector waits for it (self mode) */
  /** a selector used on the LIVE head while actions were done there: those actions become the plan's
   * steps first (the page the selector was made on is the page after them), the new node hangs after them */
  const materialize = (g: Graph, parentId: string): { g: Graph; parent: string } => {
    if (!pending.length || !liveDocId || parentId !== stateKey || !sessionId || !pageNode) return { g, parent: parentId };
    let at = parentId; for (const a of pending) { const x = addNode(g, at, opOf(a.op, a.args), returns); g = x.graph; at = x.id; }
    g = needBrowser(g); setPending([]);
    const docId = liveDocId; const sid = sessionId; const pk = pageNode.id;
    if (mirrorDoc) setDocs((ds) => ({ ...ds, [at]: mirrorDoc }));  // the mirror's DOM is this step's
    void snap(sid, docId, at).catch(() => undefined); setHead({ page: pk, at, docId });
    return { g, parent: at };
  };
  const addEdge = (name: string, args: unknown[] = [""], kwargs: Record<string, unknown> = {}, extra: Partial<graphLib.GNode> = {}) => { if (!graph || !node) return; const m = materialize(graph, node.id); const r = addNode(m.g, m.parent, opOf(name, args, kwargs), returns, extra); setGraph(() => r.graph); select(r.id, needsArg(r.graph.nodes[r.id]!)); };
  const openLink = () => { if (!graph || !node) return; const h = addNode(graph, node.id, opOf("attr", ["href"]), returns); const r = addNode(h.graph, h.id, opOf("resolve", [], browserKw(tier)), returns); setGraph(() => r.graph); select(r.id); };
  const edges: Edge[] = [];
  if (graph && node) {
    const el = elementsOf(values[node.id])[0];
    if (node.type === "Reference") (["false", "auto", "always"] as Tier[]).forEach((t) => edges.push({ label: `.resolve(${t === "false" ? "" : t === "auto" ? 'browser="auto"' : "browser=True"})`, tone: "io", hint: "open it as a Document", onAdd: () => addEdge("resolve", [], browserKw(t)) }));
    if (node.type === "Document" || node.type === "Element" || node.type === "Collection") {
      edges.push({ label: '.select_all("…")', hint: "every match: a Collection (its children run on each)", onAdd: () => addEdge("select_all") });
      edges.push({ label: '.select("…")', hint: "the one match: an Element", onAdd: () => addEdge("select") });
    }
    if (node.type === "Element" || node.type === "Collection") {
      edges.push({ label: '.attr("text")', hint: "read a value off it", onAdd: () => addEdge("attr", ["text"], {}, { output: selectors.nameFromSelector(String(node.op?.args[0]?.value ?? ""), el?.tagName.toLowerCase() ?? "") }) });
      if (el && (el.tagName === "A" || el.hasAttribute("href"))) edges.push({ label: '.attr("href").resolve()', tone: "io", hint: "open the link: a Document per element", onAdd: openLink });
      if (node.type === "Collection" && el) {  // two cells per element (th/td, dt/dd, label/value): a key → value table as one dict
        const k = el.querySelector("th, dt") ?? (el.children.length === 2 ? el.children[0] : null); const v = el.querySelector("td, dd") ?? (el.children.length === 2 ? el.children[1] : null);
        if (k && v && k !== v) { const ks = k.tagName === "TH" || k.tagName === "DT" ? k.tagName.toLowerCase() : `${k.tagName.toLowerCase()}:first-child`; const vs = v.tagName === "TD" || v.tagName === "DD" ? v.tagName.toLowerCase() : `${v.tagName.toLowerCase()}:last-child`;
          edges.push({ label: `.extract(name=${ks}, value=${vs}.alias(field("name")))`, hint: `a key → value table: each ${ks} names its ${vs} -- the rows become one dict`, onAdd: () => { let g = graph; const k1 = addNode(g, node.id, opOf("select", [ks]), returns); g = k1.graph; g = addNode(g, k1.id, opOf("attr", ["text"]), returns, { output: "name" }).graph; const v1 = addNode(g, node.id, opOf("select", [vs]), returns); g = v1.graph; g = addNode(g, v1.id, opOf("attr", ["text"]), returns, { alias: graphLib.fieldAlias("name") }).graph; setGraph(() => updateNode(g, node.id, { output: node.output ?? "info" })); } }); }
      }
      if (node.type === "Collection") edges.push({ label: ".limit(n)", hint: "the first n", onAdd: () => { const n = Number(window.prompt("how many", "5")); if (n) setGraph((g) => setMod(g, node.id, opOf("limit", [n]))); } });
    }
    if (node.type === "Value") {
      edges.push({ label: ".number()", hint: "the first number in it, or a number word (Three → 3)", onAdd: () => { if (!graph) return; const out = node.output ?? `${node.op?.args[0]?.value ?? "value"}_number`; const g = updateNode(graph, node.id, { output: undefined }); const r = addNode(g, node.id, opOf("number"), returns, { output: String(out).replace(/[^a-z0-9_]+/gi, "_") }); setGraph(() => r.graph); select(r.id); } });
      for (const op of ["date", "datetime"]) edges.push({ label: `.${op}()`, hint: op === "date" ? "the value as a date (YYYY-MM-DD): ISO, written, numeric, relative" : "the value as an ISO datetime", onAdd: () => { if (!graph) return; const out = node.output ?? `${node.op?.args[0]?.value ?? "value"}_${op}`; const g = updateNode(graph, node.id, { output: undefined }); const r = addNode(g, node.id, opOf(op), returns, { output: String(out).replace(/[^a-z0-9_]+/gi, "_") }); setGraph(() => r.graph); select(r.id); } });
      edges.push({ label: ".map({…})", hint: "look the value up in a table (JSON)", onAdd: () => { if (!graph) return; const t = window.prompt("the mapping, as JSON", '{"One": 1, "Two": 2, "Three": 3, "Four": 4, "Five": 5}'); if (!t) return; let m: unknown; try { m = JSON.parse(t); } catch { window.alert("not JSON"); return; } const g = updateNode(graph, node.id, { output: undefined }); const r = addNode(g, node.id, opOf("map", [m]), returns, { output: node.output ?? "mapped" }); setGraph(() => r.graph); select(r.id); } });
    }
    if (node.type === "Document") {
      for (const n of ["click", "write", "wait_for"]) edges.push({ label: `.${n}("…")`, tone: "io", hint: `${n} on the live page (the page goes live)`, onAdd: () => addEdge(n, n === "write" ? ["", ""] : [""]) });
      if (node.op?.name === "resolve") edges.push({ label: ".paginate(…)", tone: "io", hint: "walk the pages", onAdd: () => setGraph((g) => setMod(g, node.id, opOf("paginate", [], { by: "link", max_pages: 5 }))) });
      for (const n of ["title", "text", "markdown", "html", "links"]) if (returns[n]) edges.push({ label: `.${n}()`, hint: `the page's ${n}`, onAdd: () => addEdge(n, [], {}, { output: n }) });
      edges.push({ label: ".download()", hint: "the raw bytes as a file (a PDF, an image): url, filename, content type, size, base64", onAdd: () => addEdge("download", [], {}, { output: "file" }) });
    }
  }
  /** suggestions for the focused node's own argument */
  const suggestions: Suggestion[] = React.useMemo(() => {
    if (!graph || !node?.op || !doc) return [];
    const base: ParentNode = root ?? doc; const out: Suggestion[] = [];
    const count = (sel: string) => { try { return base.querySelectorAll(sel).length; } catch { return 0; } };
    const first = (sel: string) => { try { return (base.querySelector(sel)?.textContent ?? "").trim().slice(0, 50); } catch { return ""; } };
    if (node.op.name === "select_all") {
      if (!root) for (const g of patternGroups) { const n = count(g.selector); if (n > 1) out.push({ label: g.name, value: g.selector, count: n, sample: first(g.selector) }); }
      const tally = new Map<string, number>();
      for (const e of base.querySelectorAll("*")) { const sem = selectors.semantic([...e.classList]); const k = `${e.tagName.toLowerCase()}${sem[0] ? `.${sem[0]}` : ""}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
      [...tally.entries()].filter(([k, n]) => n > 2 && /\./.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, n]) => { if (!out.some((o) => o.value === k)) out.push({ label: "repeats", value: k, count: n, sample: first(k) }); });
    } else if (node.op.name === "select") {
      if (root) for (const f of selectors.suggestFields([root], 14)) { if (!out.some((o) => o.value === f.selector)) out.push({ label: f.attr, value: f.selector, sample: f.sample, count: count(f.selector) }); }
      else for (const e of [...doc.querySelectorAll("h1, h2, [id], main, article, table, form")].slice(0, 40)) { const c = selectors.uniqueCandidates(e, doc)[0]; if (c && !out.some((o) => o.value === c.selector)) out.push({ label: e.tagName.toLowerCase(), value: c.selector, count: c.count, sample: (e.textContent ?? "").trim().slice(0, 50) }); }
    } else if (node.op.name === "attr") {
      const par = node.parent ? graph.nodes[node.parent] : undefined; const els = par ? elementsOf(values[par.id]) : []; const one = inputOf(graph, node.id, doc);
      for (const a of selectors.attributesOfAll(els.length ? els : one ? [one] : [])) out.push({ label: a.number ? "→ number" : a.date ? "→ date" : a.kind, value: a.attr, sample: a.label ?? a.value, pattern: a.pattern, number: a.number, date: a.date });
    } else if (["click", "write", "wait_for"].includes(node.op.name)) {
      for (const c of views.data?.controls ?? []) out.push({ label: c.role, value: c.selector, sample: c.name, count: count(c.selector) });
    }
    return out.slice(0, 16);
  }, [graph, node, doc, root, patternGroups, views.data?.controls]);
  const applySuggestion = (value: string, sg?: Suggestion) => {
    if (!graph || !node?.op) return;
    if (node.op.name === "attr" && (sg?.pattern || sg?.number || sg?.date)) {  // a read through a pattern / as a number or date: the output moves to it
      let g = updateNode(graph, node.id, { op: { ...node.op, args: sg.pattern ? [{ value }, { value: sg.pattern }] : [{ value }] }, ...(sg.number || sg.date ? { output: undefined } : {}) });
      if (sg.number || sg.date) { const r = addNode(g, node.id, opOf(sg.date ? "date" : "number"), returns, { output: node.output ?? `${value.replace(/[^a-z0-9]+/gi, "_")}_${sg.date ? "date" : "number"}` }); g = r.graph; setGraph(() => g); select(r.id); return; }
      setGraph(() => g); setEditing(false); return;
    }
    setGraph((g) => updateNode(g, node.id, { op: { ...node.op!, args: node.op!.args.map((a, i) => (i === 0 ? { value } : a)) } })); setEditing(false); setBuilding(null); if (node.op.name === "click" || node.op.name === "write" || node.op.name === "wait_for") { const args = node.op.name === "write" ? [value, String(node.op.args[1]?.value ?? "")] : [value]; runAction(node.op.name, args, false); } };
  React.useEffect(() => {  // Esc: the inspector, then the edit, then up to the parent
    const h = (e: KeyboardEvent) => { if (!active || e.target instanceof HTMLInputElement) return; if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); } else if (e.key === "Escape") { if (paramsOpen) setParamsOpen(false); else if (pickEl) { setPickEl(null); setBuilding(null); } else if (node && needsArg(node)) cancelPick(); else if (editing) setEditing(false); else if (node?.parent) select(node.parent); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pickEl, editing, node?.parent, node?.id, paramsOpen]);

  // -- the plan: compile, preview, run, save / export / import ---------------------------------------
  const plan = React.useMemo<Plan | null>(() => (graph ? compile(graph) : null), [graph]);
  const missing = graph ? incomplete(graph) : [];
  const [tab, setTab] = React.useState("rows");
  const [asJson, setAsJson] = React.useState(false);
  const planQ = useQuery({ queryKey: ["plan", plan ? JSON.stringify(plan) : ""], queryFn: () => api.plan({ plan: { ...plan!, session_id: sessionId } }), enabled: !!plan && plan.steps.length > 2 && !missing.length });
  const preview = React.useMemo(() => {
    if (!graph || !plan || !outs.length) return { rows: [] as Record<string, unknown>[] };
    const rootPage = children(graph, graph.root).find((c) => c.op?.name === "resolve" && docs[c.id]); if (!rootPage) return { rows: [] };
    const base = pages[rootPage.id]?.url ?? graph.url;
    const byUrl = new Map(Object.entries(pages).filter(([k]) => docs[k]).map(([k, p]) => [p.url, docs[k]!]));
    const followed = (href: string, rest: Plan) => { let abs = href; try { abs = new URL(href, base).toString(); } catch { /* keep */ } const d = byUrl.get(abs); return d ? planLib.evalLocal(rest, d.body) : `→ ${abs}`; };
    const cs = planLib.calls(plan);
    return { rows: planLib.localRows({ root: "Document", steps: plan.steps.slice(cs[1] ? cs[1].index : plan.steps.length) }, docs[rootPage.id]!, followed).rows };
  }, [graph, plan, docs, pages, outs.length]);
  /** the preview as shown: exploded; on a page opened from a record, only the rows whose page is open */
  const shown = React.useMemo(() => {
    const nested = !!graph && !!pageNode && pageNode.parent !== graph.root;
    let rows = preview.rows.flatMap((r) => explode(r));
    if (nested) rows = rows.filter((r) => !Object.values(r).some((x) => typeof x === "string" && x.startsWith("→ ")));
    return { rows, nested };
  }, [preview.rows, graph, pageNode]);
  /** run the plan through the session; `trace` also saves the run as a named trace */
  const runServer = async (trace?: string) => {
    if (!plan || !graph) return; setRun({ busy: true }); setTab("server"); const t0 = performance.now();
    try {
      const out = await api.execute({ plan: { ...plan, session_id: sessionId }, url: graph.url, ...(trace ? { trace } : {}) });
      setRun({ rows: (Array.isArray(out.rows) ? out.rows : out.rows && typeof out.rows === "object" ? [out.rows as Record<string, unknown>] : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false, trace: out.trace });
      if (out.trace) qc.invalidateQueries({ queryKey: ["traces"] });
    } catch (e) { setRun({ error: e as ApiError, busy: false }); }
  };
  const navigate = useNavigate();
  /** Run ▶: the plan goes to the Run workspace, which executes it live (stages, streamed rows, trace) */
  // the plan as a pipeline graph, in a popup (the Run workspace's graph, with nothing run)
  const [graphOpen, setGraphOpen] = React.useState(false);
  const planStages = React.useMemo(() => (graphOpen && plan ? stagesLib.stagesOf(plan) : []), [graphOpen, plan]);
  React.useEffect(() => {
    if (!graphOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); setGraphOpen(false); } };
    window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true);
  }, [graphOpen]);
  const graphPopup = graphOpen && plan ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setGraphOpen(false)}>
      <div className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="the plan as a graph">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11px]">
          <span className="font-semibold">Plan graph</span><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted" title={planLib.describe(plan)}>{planLib.describe(plan)}</span>
          <button type="button" disabled={!outs.length || missing.length > 0} onClick={() => { setGraphOpen(false); openRun(); }} className="rounded bg-accent px-1.5 text-[10px] leading-4 text-white disabled:opacity-40">Open in Run ▸</button>
          <button type="button" className="px-1 text-muted hover:text-ink" onClick={() => setGraphOpen(false)} title="close (Esc)">✕</button>
        </div>
        <div className="min-h-0 flex-1"><PipelineGraph stages={planStages} stats={{}} at={0} running={false} live={false} /></div>
      </div>
    </div>
  ) : null;
  const openRun = () => { if (!plan || !graph) return; const host = (() => { try { return new URL(graph.url).hostname.replace(/^www\./, ""); } catch { return "run"; } })(); navigate(`/run?p=${encSpec({ plan: { ...plan, session_id: sessionId }, url: graph.url, name: host })}`); };
  const runTraced = () => { const host = (() => { try { return new URL(graph?.url ?? "").hostname.replace(/^www\./, ""); } catch { return "run"; } })(); const name = window.prompt("save the run as a trace named", `${host}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`); if (name) { setRowsOpen(true); runServer(name); } };

  const saved = useQuery({ queryKey: ["saved-graphs"], queryFn: () => { try { return JSON.parse(localStorage.getItem("wc.graphs") ?? "[]") as { name: string; state: State; at: number }[]; } catch { return []; } }, staleTime: 0 });
  const save = () => { if (!state) return; const name = window.prompt("save as", views.data?.title ?? state.graph.url); if (!name) return; const list = (saved.data ?? []).filter((x) => x.name !== name); list.unshift({ name, state, at: Date.now() }); localStorage.setItem("wc.graphs", JSON.stringify(list.slice(0, 50))); qc.invalidateQueries({ queryKey: ["saved-graphs"] }); };
  const load = (name: string) => { const x = (saved.data ?? []).find((s) => s.name === name); if (x) reset(x.state); };
  const exportPlan = () => { if (!state || !plan) return; const blob = new Blob([JSON.stringify({ url: state.graph.url, tier: state.tier, graph: state.graph, plan, blob: planQ.data?.blob, describe: planQ.data?.describe }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(views.data?.title ?? "plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.plan.json`; a.click(); URL.revokeObjectURL(a.href); };
  const importPlan = async () => {
    const text = window.prompt("paste a plan blob, or an exported plan's JSON"); if (!text) return;
    try {
      const o = JSON.parse(text);
      if (o.graph?.nodes) reset({ tier: o.tier ?? "auto", graph: o.graph });
      else if (o.plan && o.url) reset({ tier: o.tier ?? "auto", graph: decompile(o.plan, o.url, returns) });
      else { const got = await api.plan({ blob: text }); const p = got.plan as Plan & { source?: { url?: string } }; const url = p.source?.url ?? window.prompt("the URL the plan starts from") ?? ""; reset({ tier: "auto", graph: decompile({ root: p.root, steps: p.steps }, url, returns) }); }
    } catch (e) { window.alert(`not a plan: ${(e as Error).message}`); }
  };

  const [draft, setDraft] = React.useState(graph?.url ?? "");
  React.useEffect(() => { if (graph?.url) setDraft(graph.url); }, [graph?.url]);
  const err = openError ?? (views.error as ApiError | null);
  const card = views.data?.card;
  const liveSet = React.useMemo(() => new Set(head ? [head.at] : []), [head]);
  const samples = React.useMemo(() => { const out: Record<string, string> = {}; if (!graph) return out; for (const [id, v] of Object.entries(values)) { const n = graph.nodes[id]!; out[id] = n.op?.name === "resolve" ? (pages[id]?.url ? new URL(pages[id]!.url).pathname.slice(0, 22) : "")
      : n.op?.name === "select_all" ? `×${elementsOf(v).length}`
      : n.op?.name === "select" && graphLib.eachOf(graph, id) && Array.isArray(v) ? `${(v as unknown[]).filter((x) => x != null && !(Array.isArray(x) && !x.length)).length}/${(v as unknown[]).length}`
      : ""; /* counts where they mean something; the rest reads in the rows */ } return out; }, [values, graph, pages]);
  const stripScripts = (views.data?.tiers ?? []).slice(-1)[0] === "browser";
  const nodeEl = node ? elementsOf(values[node.id])[0] : undefined;

  // the page gets the height the window has (the app header, the toolbar and the action bar aside)
  const [vh, setVh] = React.useState(() => (typeof window !== "undefined" ? window.innerHeight : 900));
  React.useEffect(() => { const h = () => setVh(window.innerHeight); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  /** clicking an argument in the plan: select its line and open the selector panel on the element
   * its selector matches now (the editor starts from the current selector) */
  const editArg = (id: string) => {
    if (!graph) return; const n = graph.nodes[id]; if (!n?.op) return;
    select(id, true);
    const val = String(n.op.args[0]?.value ?? ""); const pg0 = pageOf(graph, id); const d = pg0 ? docs[pg0.id] : null;
    if (!val || !SELECTOR_OPS.includes(n.op.name)) return;
    if (!d) { setPendingEdit(id); return; }  // its page is still loading: open the editor when it arrives
    const par = n.parent ? graph.nodes[n.parent] : undefined; const bases: ParentNode[] = par && (par.type === "Collection" || par.type === "Element") ? elementsOf(values[par.id]) : [d];
    let first: Element | null = null; for (const b0 of bases) { try { first = b0.querySelector(val); } catch { first = null; } if (first) break; }
    if (first) setPickEl(first);
  };
  const [pendingEdit, setPendingEdit] = React.useState<string | null>(null);
  React.useEffect(() => { if (!pendingEdit || !graph) return; const pg0 = pageOf(graph, pendingEdit); if (pg0 && docs[pg0.id]) { const id = pendingEdit; setPendingEdit(null); editArg(id); } }, [docs, pendingEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  // -- the focused op's PARAMETERS (from GET /ops): resolve's browser tier, a select's index, a wait's timeout…
  const paramsOf = (n: graphLib.GNode | null | undefined): OpParam[] => {
    if (!n?.op || !opsQ.data) return []; const parentType = n.parent ? graph?.nodes[n.parent]?.type : undefined;
    const data = opsQ.data as unknown as Record<string, { name: string; params: OpParam[] }[]>;
    const order = [parentType === "Reference" ? "Reference" : parentType === "Collection" ? "Collection" : parentType === "Value" ? "Value" : "Document", "Document", "Reference", "Collection", "Value"];
    for (const sec of order) { const hit = data[sec]?.find((o) => o.name === n.op!.name); if (hit) return hit.params; }
    return [];
  };
  const editParams = (id: string) => { select(id); setParamsOpen(true); };
  const [manual, setManual] = React.useState<{ a: string; b: string }>({ a: "", b: "" });
  React.useEffect(() => { setManual({ a: String(node?.op?.args[0]?.value ?? ""), b: String(node?.op?.args[1]?.value ?? "") }); }, [node?.id, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyManual = () => { if (!node?.op) return; const args = node.op.name === "attr" ? (manual.b ? [{ value: manual.a }, { value: manual.b }] : [{ value: manual.a }]) : node.op.args.map((x, i) => (i === 0 ? { value: manual.a } : x)); setGraph((g) => updateNode(g, node.id, { op: { ...node.op!, args } })); setEditing(false); setPickEl(null); setBuilding(null); };
  const cancelPick = () => { setPickEl(null); setBuilding(null); if (node && needsArg(node) && node.parent) { const parent = node.parent; setGraph((g) => graphLib.removeNode(g, node.id)); select(parent); } else setEditing(false); };
  /** the outputs worth adding off the focused object (the "+ output" menu) */
  const fieldMenu = React.useMemo(() => {
    if (!graph || !node) return [] as { label: string; sample: string; add: () => void }[];
    const els = elementsOf(values[node.id]);
    if (node.type === "Collection") return selectors.suggestFields(els, 16).map((f) => ({ label: `${f.selector} · ${f.attr}${f.number ? " → number" : f.date ? " → date" : ""}`, sample: f.sample, add: () => { const s1 = addNode(graph, node.id, opOf("select", [f.selector]), returns); setGraph(() => addRead(s1.graph, s1.id, f.attr, { output: f.name }, f.pattern, f.number, f.date).graph); } }));
    if (node.type === "Element") return selectors.attributesOfAll(els).map((a) => ({ label: a.number ? `${a.attr} → number` : a.date ? `${a.attr} → date` : a.attr, sample: a.label ?? a.value, add: () => { const nm = a.attr === "text" ? selectors.nameFromSelector(String(node.op?.args[0]?.value ?? ""), els[0]?.tagName.toLowerCase() ?? "") : a.attr.replace(/[^a-z0-9]+/gi, "_"); setGraph(() => addRead(graph, node.id, a.attr, { output: a.number ? `${nm}_number` : a.date ? `${nm}_date` : nm }, a.pattern, a.number, a.date).graph); } }));
    return [];
  }, [graph, node, values]); // eslint-disable-line react-hooks/exhaustive-deps
  const [menuOpen, setMenuOpen] = React.useState(false);
  const remembered = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
  const [planOpen, setPlanOpenRaw] = React.useState(() => remembered("wc.author.plan", true));
  const setPlanOpen = (v: boolean) => { setPlanOpenRaw(v); try { localStorage.setItem("wc.author.plan", v ? "1" : "0"); } catch { /* fine */ } };
  const sideShown = selfMode || (attrMode && editing);  // the picking tools: an op waiting for / re-editing its argument
  const [rowsOpen, setRowsOpenRaw] = React.useState(() => remembered("wc.author.rows", true));
  const setRowsOpen = (v: boolean) => { setRowsOpenRaw(v); try { localStorage.setItem("wc.author.rows", v ? "1" : "0"); } catch { /* fine */ } };
  const rowsH = 210;
  const pageH = Math.max(320, vh - 44 - 30 - 46 - (rowsOpen ? rowsH : 22) - 10 - (pageNode ? 22 : 0));  // the steps bar is always there: the page never jumps
  /** each output's colour -- the same on the plan line, the page outline and its rows column */
  const colourOf = React.useMemo(() => { const m: Record<string, string> = {}; outs.forEach((o, i) => { if (o.output) m[o.output] = fieldColour(i); }); return m; }, [outs]);
  const columnColours = (rows: Record<string, unknown>[]) => { const m: Record<string, string> = {}; for (const r of rows.slice(0, 5)) for (const k of Object.keys(r)) { const parts = k.split("."); for (let i = parts.length - 1; i >= 0; i--) { const c = colourOf[parts[i]!]; if (c) { m[k] = c; break; } } } return m; };
  const isOutput = !!node && (node.output !== undefined || !!node.alias);
  const siblingCols = graph && node ? outputs(graph).filter((o) => o.id !== node.id && o.output && graphLib.eachOf(graph, o.id)?.id === graphLib.eachOf(graph, node.id)?.id) : [];
  const namedBy = node?.alias ? (graphLib.aliasField(node.alias) ? "column" : "page") : "name";
  const setNaming = (mode: string, value: string) => { if (!node) return; setGraph((g) => updateNode(g, node.id, mode === "name" ? { output: value || outputName(node), alias: undefined } : mode === "column" ? { alias: graphLib.fieldAlias(value), output: undefined } : { alias: [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }], output: undefined })); };

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      {graphPopup}
      <Toolbar className="!h-[30px] !py-0 text-[11px]">
        <form onSubmit={(e) => { e.preventDefault(); if (draft) start(draft, tier); }} className="flex min-w-[280px] flex-1 items-center gap-1.5">
          <Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="a URL -- the plan starts from it" className="h-6 w-full text-[11px]" />
          <Select value={tier} onChange={(e) => setStateRaw((s) => (s ? { ...s, tier: e.target.value as Tier } : s))} title="the tier new pages open with" className="h-6 text-[11px]"><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId}>Start</Button>
        </form>
        <ToolbarSpacer />
        {history.current.length > 0 && <Button size="sm" variant="ghost" onClick={undo} title="undo (⌘Z)">undo</Button>}
        {state && <><Button size="sm" variant="ghost" onClick={save}>Save</Button><Button size="sm" variant="ghost" onClick={exportPlan}>Export</Button></>}
        <Button size="sm" variant="ghost" onClick={importPlan}>Import</Button>
        {saved.data && saved.data.length > 0 && <Select value="" onChange={(e) => { if (e.target.value) load(e.target.value); }} className="h-7 text-[12px]"><option value="">saved…</option>{saved.data.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</Select>}
      </Toolbar>
      {!state || !graph ? <EmptyState title="Start from a URL" hint="The plan starts with its Reference. Open it; then choose an op above the page (select_all, select, attr…) and click the page, or a suggestion. Clicking something the plan already has jumps to it; shift-click records a link, a click or typing." /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 overflow-hidden p-1" style={{ gridTemplateColumns: `${planOpen ? "270px" : "16px"} minmax(0,1fr)${sideShown ? " 300px" : ""}` }}>
        {/* the plan */}
        {!planOpen ? <button type="button" onClick={() => setPlanOpen(true)} className="flex min-h-0 items-start justify-center rounded border border-line pt-2 text-[10px] text-muted hover:bg-surface-2" title="show the plan"><span style={{ writingMode: "vertical-rl" }}>plan ›</span></button> :
        <section className="flex min-h-0 flex-col rounded border border-line">
          <div className="flex items-center border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Plan{problemList.length > 0 ? <button type="button" className="ml-1 rounded bg-bad-soft px-1 font-normal normal-case text-bad" title={problemList.map(([id, p]) => `${graph.nodes[id]?.op ? graphLib.describeOp(graph.nodes[id]!) : id}: ${p.message}`).join("\n")} onClick={() => select(problemList[0]![0])}>{problemList.length} to fix</button> : <span className="ml-1 font-normal normal-case text-ok" title="every line matches on the pages checked">✓ checked</span>}<span className="flex-1" /><button type="button" className="font-normal hover:text-ink" onClick={() => setPlanOpen(false)} title="hide the plan">‹</button></div>
          <GraphView graph={graph} selected={node?.id ?? graph.root} onSelect={(id) => select(id)} onChange={(g) => setGraph(() => g)} samples={samples} live={liveSet} editing={selfMode} onEditArg={editArg} onEditParams={editParams} problems={problems} className="min-h-0 flex-1 overflow-auto px-0.5 py-0.5" />
          {missing.length > 0 && <div className="border-t border-line px-1.5 py-0.5 text-[10px] text-bad">{missing.length} op(s) still need an argument</div>}
        </section>}

        {/* the action bar, then the page */}
        <div className="flex min-h-0 min-w-0 flex-col gap-0.5">
          <section className={cn("h-[46px] shrink-0 overflow-hidden rounded border px-1.5 py-0.5", selfMode ? "border-warn/60 bg-warn-soft/40" : "border-line")}>
            <div className="flex h-5 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <code className="truncate font-mono text-[10.5px] text-ink">{node?.op ? graphLib.describeOp(node) : `Reference("${graph.url}")`}</code>
              {node && samples[node.id] && <span className="text-[10px] text-muted">{samples[node.id]}</span>}
              <span className="text-[10px] text-muted">· {selfMode ? `picking in ${rootLabel}` : `showing ${rootLabel}`}</span>
              <span className="flex-1" />
              {pageNode && <><span className="max-w-[240px] truncate font-mono text-[10px] text-muted" title={page?.url}>{page?.url ?? "…"}</span>
                {page?.docId && <button type="button" className="text-muted hover:text-ink" onClick={reload} title="reload the page">⟳</button>}
                {head && head.page === pageKey && head.at === stateKey ? <span className="rounded bg-ok-soft px-1 text-[10px] text-ok" title="a live browser page is at this step: shift-click acts on it">● live</span> : <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={goLiveHere} title={head && head.page === pageKey ? "fork: a fresh live page replays the steps up to here" : "open a live browser page at this step (shift-click then acts on it)"}>{head && head.page === pageKey ? "fork live here" : "go live here"}</button>}</>}
              {patternGroups.length > 0 && <button type="button" className={cn("rounded px-1 text-[10px]", showGroups ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")} onClick={() => setShowGroups(!showGroups)}>{patternGroups.length} groups</button>}
            </div>
            <div className="flex h-5 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
              {selfMode && node?.op ? <>
                <span className="text-[11px] font-medium text-warn">Choose the selector for .{node.op.name}(): click the page, or a suggestion on the right</span>
                <span className="flex-1" />
                <button type="button" className="rounded px-1.5 text-[11px] text-muted hover:text-ink" onClick={cancelPick}>cancel</button>
              </> : <>
                {edges.map((e) => <button key={e.label} type="button" title={e.hint} onClick={e.onAdd} className={cn("rounded border border-line px-1.5 py-px font-mono text-[10.5px] hover:bg-surface-2", e.tone === "io" ? "text-topic-network" : "text-accent")}>+ {e.label}</button>)}
                {fieldMenu.length > 0 && <div className="relative">
                  <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="rounded border border-line px-1.5 py-px text-[10.5px] text-accent hover:bg-surface-2">+ output ▾</button>
                  {menuOpen && <div className="absolute left-0 top-6 z-30 max-h-72 w-96 overflow-auto rounded-md border border-line bg-surface p-1 shadow-lg" onMouseLeave={() => setMenuOpen(false)}>
                    {fieldMenu.map((f) => <button key={f.label} type="button" onClick={() => { f.add(); setMenuOpen(false); }} className="flex w-full items-center gap-1 rounded px-1 py-px text-left hover:bg-surface-2"><code className="shrink-0 font-mono text-[10px]">{f.label}</code><span className="min-w-0 flex-1 truncate text-[10px] text-muted">{f.sample}</span></button>)}
                  </div>}
                </div>}
                {node?.op && paramsOf(node).some((p) => p.name !== "error") && <div className="relative">
                  <button ref={paramsBtn} type="button" onClick={() => setParamsOpen(!paramsOpen)} className={cn("rounded border border-line px-1.5 py-px text-[10.5px] hover:bg-surface-2", paramsOpen && "bg-accent-soft text-accent")} title="edit this op's parameters">⚙ params</button>
                  {paramsOpen && <div className="fixed z-50 w-80 rounded-md border border-line bg-surface p-1.5 shadow-lg" style={{ left: Math.max(8, Math.min(paramsAt?.x ?? 300, (typeof window !== "undefined" ? window.innerWidth : 1200) - 336)), top: paramsAt?.y ?? 120 }}>
                    <div className="mb-1 flex items-center text-[10px] font-semibold uppercase tracking-wide text-muted">.{node.op.name}() parameters<span className="flex-1" /><button type="button" className="font-normal hover:text-ink" onClick={() => setParamsOpen(false)}>✕</button></div>
                    <ParamsEditor op={node.op} params={paramsOf(node)} skip={SELECTOR_OPS.includes(node.op.name) || node.op.name === "attr" ? [paramsOf(node).find((p) => p.kind === "positional")?.name ?? ""] : []} onChange={(op) => setGraph((g) => updateNode(g, node.id, { op: { ...node.op!, args: op.args as typeof node.op.args, kwargs: op.kwargs as typeof node.op.kwargs } }))} />
                  </div>}
                </div>}
                <span className="flex-1" />
                {node?.op && !(node.op.name === "resolve" && node.parent === graph.root) && <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={isOutput} onChange={(e) => setGraph((g) => updateNode(g, node.id, e.target.checked ? { output: outputName(node) } : { output: undefined, alias: undefined }))} />output</label>}
                {isOutput && node && <>
                  <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={namedBy} onChange={(e) => setNaming(e.target.value, e.target.value === "column" ? (siblingCols[0]?.output ?? "") : e.target.value === "page" ? "th" : (node.output ?? ""))} title="how the column is named">
                    <option value="name">named</option>{siblingCols.length > 0 && <option value="column">named by a column</option>}<option value="page">named from the page</option>
                  </select>
                  {namedBy === "name" && <input className="h-6 w-28 rounded border border-line bg-surface px-1 text-[11px]" value={node.output ?? ""} onChange={(e) => setGraph((g) => updateNode(g, node.id, { output: e.target.value }))} />}
                  {namedBy === "column" && <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={graphLib.aliasField(node.alias) ?? ""} onChange={(e) => setNaming("column", e.target.value)}>{siblingCols.map((o) => <option key={o.id} value={o.output}>{o.output}</option>)}</select>}
                  {namedBy === "page" && <input className="h-6 w-24 rounded border border-line bg-surface px-1 font-mono text-[10px]" defaultValue={String(node.alias?.[1]?.args?.[0]?.value ?? "")} onBlur={(e) => e.target.value.trim() && setNaming("page", e.target.value.trim())} title="a selector (relative to the record) whose text names the column" />}
                </>}
                {isOutput && node && (node.type === "Document" || node.type === "Collection") && !node.alias && <label className="flex items-center gap-1 text-[11px]" title="merge this nested output's keys into the parent row (project(flatten=[…])): detail.description, detail.info…"><input type="checkbox" checked={!!node.flatten} onChange={(e) => setGraph((g) => updateNode(g, node.id, { flatten: e.target.checked || undefined }))} />flatten</label>}
                {node?.type === "Document" && node.op?.name === "resolve" && <Pager n={node} onChange={(mod) => setGraph((g) => setMod(g, node.id, mod, "paginate"))} />}
              </>}
            </div>
          </section>
          {/* the page's STEPS: the page, then each action; step back / forward; the live head is marked */}
          {pageNode && <div className="flex h-[20px] shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded border border-line px-1 text-[10px]">
            {liveDocId && <span className="mr-1 flex shrink-0 items-center gap-0.5 border-r border-line pr-1">
              <button type="button" data-act="live-back" disabled={!!busy} onClick={() => { void liveBack(); }} className="rounded px-1 hover:bg-surface-2 disabled:opacity-40" title="the browser's back button, on this page (the actions not in the plan are trimmed to where it lands)">⟵ back</button>
              <button type="button" data-act="live-reset" disabled={(!pending.length && !awayFromHead) || !!busy} onClick={() => { void liveReset(); }} className="rounded px-1 hover:bg-surface-2 disabled:opacity-40" title="back until no action outside the plan is left (rebuilt at the plan's head only when a click made no history entry)">⟲ to the plan</button>
              {placed && placed.page === pageKey && !pending.length && <span className="text-muted">on <b className="text-accent">{graph.nodes[placed.page]?.output ? `.resolve() → ${graph.nodes[placed.page]!.output}` : ".resolve()"}</b>{placed.of ? ` (${placed.hits}/${placed.of} selectors match)` : " (its URL)"}</span>}
              {busy && <span className="text-muted">{busy}…</span>}
            </span>}
            {liveElsewhere && <span className="mr-1 flex shrink-0 items-center gap-1 border-r border-line pr-1">
              <span className="text-muted">the live page is on another page of the plan -- this is this page's copy</span>
              <button type="button" data-act="bring-live" disabled={!!busy} onClick={() => { void bringLiveHere(); }} className="rounded bg-accent px-1.5 text-white disabled:opacity-40">{busy ? `${busy}…` : "bring the live page here"}</button>
            </span>}
            <span className="mr-1 font-semibold uppercase tracking-wide text-muted">steps</span>
            <button type="button" className="px-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={stepIx <= 0} onClick={() => stepIx > 0 && select(pageSteps[stepIx - 1]!.id)} title="the step before">◀</button>
            {pageSteps.map((x, i) => <React.Fragment key={x.id}>{i > 0 && <span className="text-muted">›</span>}
              <button type="button" onClick={() => select(x.id)} className={cn("rounded px-1 font-mono", x.id === stateKey ? "bg-accent-soft text-accent ring-1 ring-accent" : "hover:bg-surface-2", i > 0 && !snaps[x.id] && "text-muted")} title={i === 0 ? "the page as it opened" : `${graphLib.describeOp(x)}${snaps[x.id] ? "" : " (no snapshot yet: replay to see it)"}`}>
                {i === 0 ? "page" : `${x.op!.name}(${String(x.op!.args[0]?.value ?? "").slice(0, 18)})`}{head && head.at === x.id && head.page === pageKey ? <span className="ml-0.5 text-ok">●</span> : null}
              </button></React.Fragment>)}
            {atHead && pending.map((a, i) => <React.Fragment key={`p${i}`}><span className="text-muted">›</span><span className="rounded border border-dashed border-warn/70 px-1 font-mono text-warn" title="done on the live page, not in the plan yet: it becomes a step when you use a selector here (or shift-click to record an action)">{a.op}({String(a.args[0] ?? "").slice(0, 18)})</span></React.Fragment>)}
            {atHead && pending.length > 0 && <button type="button" className="ml-0.5 rounded bg-warn-soft px-1 text-warn hover:brightness-95" onClick={() => { if (!graph) return; const m = materialize(graph, stateKey); setGraph(() => m.g); select(m.parent); }} title="make these actions steps of the plan now">add to plan</button>}
            <button type="button" className="px-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={stepIx < 0 || stepIx >= pageSteps.length - 1} onClick={() => stepIx < pageSteps.length - 1 && select(pageSteps[stepIx + 1]!.id)} title="the step after">▶</button>
            <span className="ml-1 text-muted">{atHead ? "live: click to interact · shift-click to record a step" : "a snapshot: shift-click to fork from here (the later steps are kept as a branch)"}</span>
          </div>}
          <div className="relative shrink-0 overflow-hidden" style={{ height: pageH }}>
          {!pageNode ? (
            <section className="rounded-md border border-line p-3 text-[12px]">
              <Input mono value={graph.url} onChange={(e) => setGraph((g) => ({ ...g, url: e.target.value }))} className="mb-2 w-full" />
              <div className="text-muted">Open it with a <b>.resolve()</b> above.</div>
            </section>
          ) : err && !views.data ? (
            <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={err.hint ?? err.message} action={<Button onClick={() => setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } }))}>Retry</Button>} />
          ) : liveElsewhere && views.data?.content ? (
            <>
              <PageFrame html={views.data.content} base={views.data.url ?? page?.url ?? graph.url} stripScripts={stripScripts} focusPaths={shownRoots.length ? shownRoots.map(pathOf) : null} highlights={frameHls} picking={selfMode} onPick={onFramePick} onAction={onFrameAction} maxHeight={pageH} width={1180} />
            </>
          ) : atHead && !liveDocId ? (
            <div className="flex h-full items-center justify-center rounded border border-dashed border-line text-[11px] text-muted">{busy ? `${busy}…` : "opening the live page…"}</div>
          ) : liveDocId ? (
            <>            {livePictured ? <Player key={liveStart} events={liveStream} live highlights={playerHls} pickable shiftPick={!selfMode} focus={shownRoots} onPick={(p) => { if (p.el) setPickEl(p.el); }} onClickThrough={(p, m) => { const sel = p.el ? selFor(p.el) : null; if (!sel) return; if (m.shift) { void act("click", [sel]); return; } void clickThrough(sel); }} onDocument={(d) => setMirrorDoc(d)} controls={false} controller={controller} maxHeight={pageH} /> : <div className="flex h-full items-center justify-center rounded border border-dashed border-line text-[11px] text-muted">{busy ? `${busy}…` : "waiting for the live page to send its picture (it is loading or navigating)…"}</div>}</>
          ) : card && card.kind === "binary" ? (
            <EmptyState title="A file" hint="Not a page to render: add .download() above to return its bytes (url, filename, content type, size, base64)." action={<Button onClick={() => node && addEdge("download", [], {}, { output: "file" })}>.download()</Button>} />
          ) : stateKey !== pageKey ? (snaps[stateKey] ? (
            <PageFrame html={snaps[stateKey]!.html} base={snaps[stateKey]!.url || page?.url || graph.url} stripScripts={stripScripts} focusPaths={shownRoots.length ? shownRoots.map(pathOf) : null} highlights={frameHls} picking={selfMode} onPick={onFramePick} onAction={onFrameAction} maxHeight={pageH} width={1180} />
          ) : <div className="flex h-full flex-col items-center justify-center gap-1 rounded border border-dashed border-line text-[11px] text-muted">No snapshot of this step yet.<button type="button" className="rounded bg-accent px-2 py-0.5 text-white" onClick={goLiveHere}>Replay to here</button></div>
          ) : views.data?.content ? (
            <PageFrame html={views.data.content} base={views.data.url ?? page?.url ?? graph.url} stripScripts={stripScripts} focusPaths={shownRoots.length ? shownRoots.map(pathOf) : null} highlights={frameHls} picking={selfMode} onPick={onFramePick} onAction={onFrameAction} maxHeight={pageH} width={1180} />
          ) : <div className="flex h-full items-center justify-center rounded border border-dashed border-line text-[11px] text-muted">{pageUrl(pageKey) || page?.url ? "opening the page into your session…" : "this page's URL comes from the page before it: open that first"}</div>}
            {(actError || busy) && <div className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-surface/95 px-1.5 py-0.5 text-[11px] shadow">{actError ? <><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</> : `${busy}…`}</div>}
          </div>
          {/* the rows: the preview on this page, and the server run */}
          <section className="flex min-h-0 shrink-0 flex-col rounded border border-line" style={{ height: rowsOpen ? rowsH : 22 }}>
            <div className="flex h-[20px] shrink-0 items-center gap-2 border-b border-line px-1.5 text-[10.5px]">
              <span className="font-medium">Rows <span className="text-muted">{shown.rows.length}</span></span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{shown.nested ? "rows whose page is open here, with the parent row's columns" : "preview on this page"}</span>
              <button type="button" disabled={!plan} onClick={() => setGraphOpen(true)} className="rounded border border-line px-1.5 text-[10px] leading-4 hover:bg-surface-2 disabled:opacity-40" title="the plan as a pipeline graph (not run)">Graph</button>
              <button type="button" disabled={!outs.length || missing.length > 0} onClick={openRun} className="rounded bg-accent px-1.5 text-[10px] leading-4 text-white disabled:opacity-40" title={missing.length ? `${missing.length} op(s) still need an argument` : "open the plan in the Run workspace: a pipeline graph; Run ▶ there executes it live (stages, rows as they stream, errors) and records a trace"}>Open in Run ▸</button>
              <button type="button" className="text-muted hover:text-ink" onClick={() => setRowsOpen(!rowsOpen)} title={rowsOpen ? "hide the rows" : "show the rows"}>{rowsOpen ? "▾" : "▴"}</button>
            </div>
            {rowsOpen && <div className="min-h-0 flex-1 overflow-auto">
              {!outs.length ? <div className="p-2 text-[11px] text-muted">No outputs yet -- tick “output” above for a node, or use + output ▾.</div>
                : <DataFrame rows={shown.rows} colours={columnColours(shown.rows)} dense emptyHint="Nothing matched on this page yet." />}
            </div>}
          </section>
        </div>

        {/* while an op waits for its selector: its suggestions / the selector editor, beside the page */}
        {sideShown && node?.op && (
        <aside className="flex min-h-0 min-w-0 flex-col rounded border border-warn/50">
          {pick && doc ? (
            <div className="flex min-h-0 flex-col overflow-auto p-1.5">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Selector for .{node.op.name}()</div>
              {pickShadow && <div className="mb-1 rounded border border-warn/50 bg-warn-soft/50 p-1 text-[10.5px]">That element is inside a <b>shadow DOM</b> the static copy cannot reach. <button type="button" className="underline" onClick={useBrowser}>Open the page with a browser</button> -- its capture folds shadow DOM and same-origin frames into the page.</div>}
              {pickEl?.tagName === "IFRAME" && <div className="mb-1 rounded border border-line bg-surface-2 p-1 text-[10.5px]">A <b>frame</b>: its content is another page. <button type="button" className="underline" onClick={openFrame}>Open the frame's page</button> (<code>.select(…).attr("src").resolve()</code>)</div>}
              <ElementInspector pick={pick} scopeEl={rootFor(pickEl)} scopeLabel={rootLabel} op={node.op.name} initial={editing && !needsArg(node) ? String(node.op.args[0]?.value ?? "") : undefined} groups={pickGroups} onSelector={(sel) => setBuilding(sel || null)} onAdd={onApply} onCancel={() => { setPickEl(null); setBuilding(null); }} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-col overflow-auto p-1.5">
              <form className="mb-1 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); applyManual(); }}>
                <input className="h-5 min-w-0 flex-1 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={manual.a} placeholder={node.op.name === "attr" ? "attribute (text, href, data-id…)" : "a selector"} onChange={(e) => { setManual((m) => ({ ...m, a: e.target.value })); if (node.op?.name !== "attr") setBuilding(e.target.value || null); }} />
                {node.op.name === "attr" && <input className="h-5 w-24 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={manual.b} placeholder="pattern (regex)" onChange={(e) => setManual((m) => ({ ...m, b: e.target.value }))} />}
                <button type="submit" className="rounded bg-accent px-1.5 text-[10px] leading-5 text-white disabled:opacity-40" disabled={!manual.a.trim()}>Apply</button>
              </form>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{node.op.name === "attr" ? "What to read" : `Suggestions for .${node.op.name}()`}</div>
              <div className="mb-1 text-[10px] text-muted">{node.op.name === "attr" ? "every attribute of the elements, as a number where it holds one" : "or click the page"}</div>
              <div className="flex flex-col">{suggestions.map((sg) => <button key={sg.value + (sg.number ? "#n" : "") + (sg.pattern ?? "")} type="button" className="flex items-center gap-1 rounded px-1 py-px text-left hover:bg-surface-2" onClick={() => applySuggestion(sg.value, sg)} onMouseEnter={() => node.op?.name !== "attr" && setBuilding(sg.value)} onMouseLeave={() => setBuilding(null)}><code className="shrink-0 font-mono text-[10.5px] text-accent">{sg.value}</code>{sg.count != null && <span className="rounded bg-surface-2 px-0.5 text-[9.5px]">×{sg.count}</span>}<span className="text-[9.5px] text-muted">{sg.label}</span><span className="min-w-0 flex-1 truncate text-[10px] text-muted">{sg.sample}</span></button>)}{!suggestions.length && <span className="text-muted">no suggestions here</span>}</div>
            </div>
          )}
        </aside>)}
      </div>}
      {liveDocId && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

/** A page's pager: how to reach the next page and how many. */
function Pager({ n, onChange }: { n: graphLib.GNode; onChange: (m: graphLib.Mod | null) => void }) {
  // the package's paginate: by="auto" (from the detected hint), "link" (rel=next; `next=` names the link when
  // there is none), "param", "cursor", and INTERACTED pagers by="action" -- the action a sub-plan: a click on
  // the "load more" control, or a scroll (infinite scroll)
  const m = n.mods?.find((x) => x.name === "paginate"); const kw = (k: string) => m?.kwargs[k]?.value as string | number | undefined;
  const act = m?.kwargs.action?.plan as { steps?: { kind: string; name: string; args?: { value?: unknown }[] }[] } | undefined;
  const actCall = act?.steps?.find((x) => x.kind === "call"); const actSel = String(actCall?.args?.[0]?.value ?? "");
  const mode = !m ? "" : kw("by") === "action" ? (actCall?.name === "scroll" ? "scroll" : "more") : kw("next") ? "next" : String(kw("by") ?? "auto");
  const actionPlan = (name: string, args: unknown[]) => ({ plan: { root: "Document", steps: [{ kind: "get", name }, { kind: "call", name, args: args.map((v) => ({ value: v })), kwargs: {} }] } });
  const build = (md: string, sel: string, pages: number): graphLib.Mod | null => {
    if (!md) return null;
    const base = { max_pages: { value: pages } } as Record<string, { value?: unknown; plan?: unknown }>;
    if (md === "more") return { name: "paginate", args: [], kwargs: { by: { value: "action" }, action: actionPlan("click", [sel || "button"]), ...base } } as graphLib.Mod;
    if (md === "scroll") return { name: "paginate", args: [], kwargs: { by: { value: "action" }, action: actionPlan("scroll", []), ...base } } as graphLib.Mod;
    if (md === "next") return { name: "paginate", args: [], kwargs: { by: { value: "link" }, next: { value: sel || "a.next" }, ...base } } as graphLib.Mod;
    return { name: "paginate", args: [], kwargs: { by: { value: md }, ...base } } as graphLib.Mod;
  };
  const pages = Number(kw("max_pages") ?? 5); const sel = mode === "more" ? actSel : String(kw("next") ?? "");
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink">
      <span className="text-muted">pages:</span>
      <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={mode} onChange={(e) => onChange(build(e.target.value, e.target.value === "more" ? actSel || "button" : e.target.value === "next" ? String(kw("next") ?? "a.next") : "", pages))}>
        <option value="">one page</option><option value="auto">auto (detected)</option><option value="link">rel=next</option><option value="next">a next link</option><option value="param">?page=</option><option value="cursor">cursor</option><option value="more">load more (click)</option><option value="scroll">infinite scroll</option>
      </select>
      {(mode === "more" || mode === "next") && <input className="h-6 w-28 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={sel} placeholder={mode === "more" ? "the load-more control" : "the next link"} onChange={(e) => onChange(build(mode, e.target.value, pages))} />}
      {m && <><input type="number" min={1} className="h-6 w-14 rounded border border-line bg-surface px-1 text-[11px]" value={pages} onChange={(e) => onChange(build(mode, sel, Number(e.target.value)))} title="max_pages" /><span className="text-muted">pages max</span></>}
    </div>
  );
}

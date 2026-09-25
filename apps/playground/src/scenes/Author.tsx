import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementInspector, EmptyState, FlagRow, GraphView, Input, MediaBar, PageFrame, Player, Select, SkeletonPane,
  TabPanel, Tabs, Toolbar, ToolbarSpacer, cn, describe, fieldColour, graphLib, needsArg, outputName, planLib, selectors, toolAsCode, usePlayerController,
  type Edge, type FrameAction, type FrameHighlight, type Graph, type Highlight, type InspectAdd, type InspectRead, type Pick, type Plan, type RREvent,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { call as callBody, plan as planBody, useActive, useSession } from "../lib/session";

const { addNode, updateNode, setMod, opOf, emptyGraph, children, pageOf, evalNode, elementsOf, sample, hrefOf, compile, decompile, outputs, inputOf, pathOf, byPath, incomplete, isEl } = graphLib;
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
  const [building, setBuilding] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean; replay?: RREvent[] }>({ busy: false });
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
  const pageNode = graph && node ? pageOf(graph, node.id) : null;
  const pageKey = pageNode?.id ?? "";
  const page = pages[pageKey];
  const doc = docs[pageKey] ?? null;
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
    const html = views.data?.content; if (!pageKey || !html || page?.live) return;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    setDocs((ds) => ({ ...ds, [pageKey]: parsed }));
  }, [views.data?.content, pageKey, page?.live]);
  const reload = async () => { if (!sessionId || !page?.docId) return; await api.docReload(sessionId, page.docId); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, page.docId] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); setStream([]); since.current = 0; };

  // -- live: the mirrored browser page; clicks go through ------------------------------------------
  const [stream, setStream] = React.useState<RREvent[]>([]);
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
    if (!page?.live || !page.docId) return;
    let on = true; const docId = page.docId;
    const pull = async () => { try { const evs = await api.history({ since: since.current, document_id: docId, payload: true }); if (!on || !evs.length) return; since.current = Math.max(since.current, ...evs.map((c) => c.n ?? 0)); const out: RREvent[] = []; for (const e of evs) { if (e.topic === "rrweb") out.push(...((e.events ?? []) as RREvent[])); else if (e.topic !== "snapshot") { const { events: _d, content: _c, body: _b, ...payload } = e as any; out.push({ type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? Date.now() / 1000) * 1000) }); } } setStream((s) => [...s, ...out]); } catch { /* next tick */ } };
    pull(); const t = setInterval(pull, 700); return () => { on = false; clearInterval(t); };
  }, [page?.live, page?.docId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actError, setActError] = React.useState<ApiError | null>(null);
  const runAction = async (op: string, args: unknown[], record: boolean, under?: string) => {
    if (!sessionId || !graph) return;
    let docId = page?.live ? page.docId : null; if (!docId) docId = await goLive(); if (!docId) return;
    setBusy(op); setActError(null);
    try {
      await api.executeDoc({ plan: planBody("Document", [callBody(op, args)], sessionId), document_id: docId });
      if (record && under) { const r = addNode(graph, under, opOf(op, args), returns); setGraph(() => r.graph); select(r.id); }
    } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };

  // -- the focus: what renders, where selectors root -------------------------------------------------
  const takesSelector = !!node?.op && SELECTOR_OPS.includes(node.op.name);
  const selfMode = !!node && takesSelector && (needsArg(node) || editing);
  const attrMode = !!node?.op && node.op.name === "attr";  // an attr: its suggestions (every attribute, numbers) stay at hand   // picking the focused node's OWN selector
  const values = React.useMemo(() => { const out: Record<string, unknown> = {}; if (!graph) return out; for (const n of Object.values(graph.nodes)) { const p = pageOf(graph, n.id); if (p && docs[p.id]) out[n.id] = n.id === p.id ? docs[p.id] : evalNode(graph, n.id, docs[p.id]!); } return out; }, [graph, docs]);
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
    outs.forEach((o, i) => { if (pageOf(graph, o.id)?.id !== pageKey) return; const v = values[o.id]; let els = elementsOf(v); if (!els.length && o.parent) els = elementsOf(values[o.parent]); els = els.filter(inRoots); if (els.length) hls.push({ els, colour: fieldColour(i), label: o.output ?? "name from page" }); });
    if (node.op && !needsArg(node) && node.type !== "Document") { let els = elementsOf(values[node.id]); if (!els.length && node.parent) els = elementsOf(values[node.parent]); els = selfMode ? els : els.filter(inRoots); if (els.length) hls.push({ els, colour: "#2563eb", label: node.op.name }); }
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
  const onFramePick = (p: { path: number[] }) => { if (!doc) return; const el = byPath(doc, p.path); if (el) setPickEl(el); };
  /** a selector for an element the person acted on, rooted where it will be evaluated */
  const selFor = (el: Element): string => { const r = rootFor(el); return selectors.uniqueCandidates(el, r ?? el.ownerDocument)[0]?.selector ?? describe(el).selector; };
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
      let g = graph; const s1 = addNode(g, under.id, opOf("select", [selFor(el)]), returns); g = s1.graph;
      const h = addNode(g, s1.id, opOf("attr", ["href"]), returns); g = h.graph;
      const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); setGraph(() => r.graph);
      if (a.href) setPages((ps) => ({ ...ps, [r.id]: { url: absolute(a.href!) } }));
      select(r.id); return;
    }
    const parent = actionParent(); if (!parent) return;
    const sel = selFor(el);
    const r = addNode(graph, parent.id, opOf(a.op, a.op === "write" ? [sel, a.value ?? ""] : [sel]), returns);
    setGraph(() => needBrowser(r.graph)); select(r.id);
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
    const under = !selfMode && node && (node.type === "Document" || node.type === "Element" || node.type === "Collection") ? node : scope; if (!under) return;
    setPickEl(null); setBuilding(null);
    if (a.op === "paginate" && pageNode) { setGraph((g) => setMod(g, pageNode.id, opOf("paginate", [], { max_pages: 5, ...a.kwargs }))); if (a.kwargs?.by === "click" && !page?.live) await goLive(); return; }
    if (ACTION_OPS.includes(a.op)) { await runAction(a.op, a.args ?? [a.selector], a.record !== false, under.id); return; }
    let g = graph; let focus = under.id;
    if (a.op === "resolve") {
      const s = addNode(g, under.id, opOf("select", [a.selector]), returns); g = s.graph;
      const h = addNode(g, s.id, opOf("attr", ["href"]), returns); g = h.graph;
      const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); g = r.graph; focus = r.id;
    } else { const r = addNode(g, under.id, opOf(a.op, [a.selector]), returns); g = addReads(r.graph, r.id, a.reads, a.selector); focus = r.id; }
    setGraph(() => g); select(focus);
  };
  /** an edge of the focused object: a new node; one that needs a selector waits for it (self mode) */
  const addEdge = (name: string, args: unknown[] = [""], kwargs: Record<string, unknown> = {}, extra: Partial<graphLib.GNode> = {}) => { if (!graph || !node) return; const r = addNode(graph, node.id, opOf(name, args, kwargs), returns, extra); setGraph(() => r.graph); select(r.id, needsArg(r.graph.nodes[r.id]!)); };
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
    const h = (e: KeyboardEvent) => { if (!active || e.target instanceof HTMLInputElement) return; if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); } else if (e.key === "Escape") { if (pickEl) { setPickEl(null); setBuilding(null); } else if (node && needsArg(node)) cancelPick(); else if (editing) setEditing(false); else if (node?.parent) select(node.parent); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pickEl, editing, node?.parent, node?.id]);

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
  const runServer = async () => {
    if (!plan || !graph) return; setRun({ busy: true }); setTab("server"); const t0 = performance.now();
    try { const out = await api.execute({ plan: { ...plan, session_id: sessionId }, url: graph.url }); setRun({ rows: (Array.isArray(out.rows) ? out.rows : out.rows && typeof out.rows === "object" ? [out.rows as Record<string, unknown>] : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false }); }
    catch (e) { setRun({ error: e as ApiError, busy: false }); }
  };
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
  const liveSet = React.useMemo(() => new Set(Object.entries(pages).filter(([, p]) => p.live).map(([k]) => k)), [pages]);
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
    if (!val || !d || !SELECTOR_OPS.includes(n.op.name)) return;
    const par = n.parent ? graph.nodes[n.parent] : undefined; const bases: ParentNode[] = par && (par.type === "Collection" || par.type === "Element") ? elementsOf(values[par.id]) : [d];
    let first: Element | null = null; for (const b0 of bases) { try { first = b0.querySelector(val); } catch { first = null; } if (first) break; }
    if (first) setPickEl(first);
  };
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
  const pageH = Math.max(320, vh - 44 - 30 - 46 - (rowsOpen ? rowsH : 22) - 10);
  /** each output's colour -- the same on the plan line, the page outline and its rows column */
  const colourOf = React.useMemo(() => { const m: Record<string, string> = {}; outs.forEach((o, i) => { if (o.output) m[o.output] = fieldColour(i); }); return m; }, [outs]);
  const columnColours = (rows: Record<string, unknown>[]) => { const m: Record<string, string> = {}; for (const r of rows.slice(0, 5)) for (const k of Object.keys(r)) { const parts = k.split("."); for (let i = parts.length - 1; i >= 0; i--) { const c = colourOf[parts[i]!]; if (c) { m[k] = c; break; } } } return m; };
  const isOutput = !!node && (node.output !== undefined || !!node.alias);
  const siblingCols = graph && node ? outputs(graph).filter((o) => o.id !== node.id && o.output && graphLib.eachOf(graph, o.id)?.id === graphLib.eachOf(graph, node.id)?.id) : [];
  const namedBy = node?.alias ? (graphLib.aliasField(node.alias) ? "column" : "page") : "name";
  const setNaming = (mode: string, value: string) => { if (!node) return; setGraph((g) => updateNode(g, node.id, mode === "name" ? { output: value || outputName(node), alias: undefined } : mode === "column" ? { alias: graphLib.fieldAlias(value), output: undefined } : { alias: [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }], output: undefined })); };

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
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
          <div className="flex items-center border-b border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Plan<span className="flex-1" /><button type="button" className="font-normal hover:text-ink" onClick={() => setPlanOpen(false)} title="hide the plan">‹</button></div>
          <GraphView graph={graph} selected={node?.id ?? graph.root} onSelect={(id) => select(id)} onChange={(g) => setGraph(() => g)} samples={samples} live={liveSet} editing={selfMode} onEditArg={editArg} className="min-h-0 flex-1 overflow-auto px-0.5 py-0.5" />
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
                {!page?.live ? <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={goLive}>go live</button> : <span className="rounded bg-ok-soft px-1 text-[10px] text-ok">live</span>}</>}
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
          <div className="relative shrink-0 overflow-hidden" style={{ height: pageH }}>
          {!pageNode ? (
            <section className="rounded-md border border-line p-3 text-[12px]">
              <Input mono value={graph.url} onChange={(e) => setGraph((g) => ({ ...g, url: e.target.value }))} className="mb-2 w-full" />
              <div className="text-muted">Open it with a <b>.resolve()</b> above.</div>
            </section>
          ) : err && !views.data ? (
            <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={err.hint ?? err.message} action={<Button onClick={() => setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } }))}>Retry</Button>} />
          ) : page?.live ? (
            <Player events={stream} live highlights={playerHls} pickable shiftPick={!selfMode} focus={shownRoots} onPick={(p) => { if (p.el) setPickEl(p.el); }} onClickThrough={(p, m) => { const par = actionParent(); const hitNode = p.el ? matchOf({ op: "click", pick: { path: [], tag: p.tag, classes: p.classes, text: p.text }, shift: m.shift }, p.el) : null; if (hitNode) select(hitNode.id); runAction("click", [p.el ? selFor(p.el) : p.path], recordActions && m.shift && !hitNode, par?.id); }} onDocument={(d) => setDocs((ds) => (ds[pageKey] === d ? ds : { ...ds, [pageKey]: d }))} controls={false} controller={controller} maxHeight={pageH} />
          ) : card && card.kind === "binary" ? (
            <EmptyState title="A file" hint="Not a page to render: add .download() above to return its bytes (url, filename, content type, size, base64)." action={<Button onClick={() => node && addEdge("download", [], {}, { output: "file" })}>.download()</Button>} />
          ) : views.data?.content ? (
            <PageFrame html={views.data.content} base={views.data.url ?? page?.url ?? graph.url} stripScripts={stripScripts} focusPaths={shownRoots.length ? shownRoots.map(pathOf) : null} highlights={frameHls} picking={selfMode} onPick={onFramePick} onAction={onFrameAction} maxHeight={pageH} width={1180} />
          ) : <div className="flex h-full items-center justify-center rounded border border-dashed border-line text-[11px] text-muted">{pageUrl(pageKey) || page?.url ? "opening the page into your session…" : "this page's URL comes from the page before it: open that first"}</div>}
            {(actError || busy) && <div className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-surface/95 px-1.5 py-0.5 text-[11px] shadow">{actError ? <><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</> : `${busy}…`}</div>}
          </div>
          {/* the rows: the preview on this page, and the server run */}
          <section className="flex min-h-0 shrink-0 flex-col rounded border border-line" style={{ height: rowsOpen ? rowsH : 22 }}>
            <div className="flex h-[20px] shrink-0 items-center gap-2 border-b border-line px-1.5 text-[10.5px]">
              <button type="button" className={cn("font-medium", tab !== "server" ? "text-ink" : "text-muted hover:text-ink")} onClick={() => { setTab("rows"); setRowsOpen(true); }}>Rows <span className="text-muted">{shown.rows.length}</span></button>
              <button type="button" className={cn("inline-flex items-center gap-1 font-medium", tab === "server" ? "text-ink" : "text-muted hover:text-ink")} onClick={() => { setTab("server"); setRowsOpen(true); }}>Run <span className="text-muted">{run.rows?.length ?? ""}</span></button>
              <button type="button" disabled={!outs.length || run.busy || missing.length > 0} onClick={() => { setRowsOpen(true); runServer(); }} className="rounded bg-accent px-1 text-[10px] leading-4 text-white disabled:opacity-40" title={missing.length ? `${missing.length} op(s) still need an argument` : "run the plan on the server"}>{run.busy ? "…" : "▶"}</button>
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{tab === "server" ? (run.error ? `${run.error.detail?.code ?? run.error.status}: ${run.error.detail?.hint ?? run.error.message}` : run.rows ? `${run.rows.length} rows in ${run.ms} ms` : "the plan, run through your session") : shown.nested ? "rows whose page is open here, with the parent row's columns" : "preview on this page"}</span>
              {tab === "server" && run.rows && <label className="flex items-center gap-1 text-[10px] text-muted"><input type="checkbox" checked={asJson} onChange={(e) => setAsJson(e.target.checked)} />JSON</label>}
              <button type="button" className="text-muted hover:text-ink" onClick={() => setRowsOpen(!rowsOpen)} title={rowsOpen ? "hide the rows" : "show the rows"}>{rowsOpen ? "▾" : "▴"}</button>
            </div>
            {rowsOpen && <div className="min-h-0 flex-1 overflow-auto">
              {tab === "server" ? (run.rows ? (asJson ? <CodeBlock lang="json" code={JSON.stringify(run.rows, null, 2)} className="m-0.5" /> : <DataFrame rows={run.rows} colours={columnColours(run.rows)} dense />) : null)
                : !outs.length ? <div className="p-2 text-[11px] text-muted">No outputs yet -- tick “output” above for a node, or use + output ▾.</div>
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
      {page?.live && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

/** A page's pager: how to reach the next page and how many. */
function Pager({ n, onChange }: { n: graphLib.GNode; onChange: (m: graphLib.Mod | null) => void }) {
  const m = n.mods?.find((x) => x.name === "paginate"); const kw = (k: string) => m?.kwargs[k]?.value as string | number | undefined;
  const set = (patch: Record<string, unknown>) => { const cur = Object.fromEntries(Object.entries(m?.kwargs ?? {}).map(([k, a]) => [k, a.value])); const next: Record<string, unknown> = { max_pages: 5, ...cur, ...patch }; for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined) delete next[k]; onChange(opOf("paginate", [], next)); };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink">
      <span className="text-muted">pages:</span>
      <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={m ? (kw("by") === "click" ? (kw("next") ? "more" : "scroll") : kw("next") ? "next" : String(kw("by") ?? "link")) : ""} onChange={(e) => { const v = e.target.value; if (!v) return onChange(null); set(v === "more" ? { by: "click", next: kw("next") ?? "button" } : v === "scroll" ? { by: "click", next: undefined } : v === "next" ? { by: "link", next: kw("next") ?? "a.next" } : { by: v, next: undefined }); }}>
        <option value="">one page</option><option value="link">rel=next</option><option value="next">a next link</option><option value="param">?page=</option><option value="cursor">cursor</option><option value="more">load more</option><option value="scroll">infinite scroll</option>
      </select>
      {m && (kw("next") !== undefined || kw("by") === "click") && <input className="h-6 w-28 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={String(kw("next") ?? "")} placeholder="selector" onChange={(e) => set({ next: e.target.value })} />}
      {m && <><input type="number" min={1} className="h-6 w-14 rounded border border-line bg-surface px-1 text-[11px]" value={Number(kw("max_pages") ?? 5)} onChange={(e) => set({ max_pages: Number(e.target.value) })} title="max_pages" /><span className="text-muted">pages max</span></>}
    </div>
  );
}

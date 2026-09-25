import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementInspector, ElementTable, EmptyState, FlagRow, GraphView, Input, MediaBar, PageFrame, PlanView, Player, Select, SkeletonPane,
  TabPanel, Tabs, Toolbar, ToolbarSpacer, describe, fieldColour, graphLib, needsArg, planLib, selectors, toolAsCode, usePlayerController,
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
type Suggestion = { label: string; value: string; sample?: string; count?: number; pattern?: string; number?: boolean };

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
  const addRead = (g: Graph, at: string, attr: string, extra: Partial<graphLib.GNode>, pattern?: string, number?: boolean): { graph: Graph; id: string } => {
    const a = addNode(g, at, opOf("attr", pattern ? [attr, pattern] : [attr]), returns, number ? {} : extra);
    if (!number) return a;
    return addNode(a.graph, a.id, opOf("number"), returns, extra);
  };
  const addReads = (g: Graph, under: string, reads: InspectRead[] | undefined, fallbackSel: string): Graph => {
    for (const rd of reads ?? []) {
      let at = under;
      if (rd.select) { const s = addNode(g, at, opOf("select", [rd.select]), returns); g = s.graph; at = s.id; }
      const name = rd.name || (rd.attr === "text" ? selectors.nameFromSelector(rd.select ?? fallbackSel, pickEl?.tagName.toLowerCase() ?? "") : rd.attr.replace(/[^a-z0-9]+/gi, "_"));
      g = addRead(g, at, rd.attr, rd.nameFrom ? { alias: [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: rd.nameFrom }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }] } : { output: name }, rd.pattern, rd.number).graph;
    }
    return g;
  };
  /** the focused node takes the built selector */
  const onApply = (selector: string, reads: InspectRead[]) => {
    if (!graph || !node?.op) return;
    let g = updateNode(graph, node.id, { op: { ...node.op, args: node.op.args.map((a, i) => (i === 0 ? { value: selector } : a)) } });
    g = addReads(g, node.id, reads, selector);
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
      for (const a of selectors.attributesOfAll(els.length ? els : one ? [one] : [])) out.push({ label: a.number ? "→ number" : a.kind, value: a.attr, sample: a.label ?? a.value, pattern: a.pattern, number: a.number });
    } else if (["click", "write", "wait_for"].includes(node.op.name)) {
      for (const c of views.data?.controls ?? []) out.push({ label: c.role, value: c.selector, sample: c.name, count: count(c.selector) });
    }
    return out.slice(0, 16);
  }, [graph, node, doc, root, patternGroups, views.data?.controls]);
  const applySuggestion = (value: string, sg?: Suggestion) => {
    if (!graph || !node?.op) return;
    if (node.op.name === "attr" && (sg?.pattern || sg?.number)) {  // a read through a pattern / as a number: the output moves to the number
      let g = updateNode(graph, node.id, { op: { ...node.op, args: sg.pattern ? [{ value }, { value: sg.pattern }] : [{ value }] }, ...(sg.number ? { output: undefined } : {}) });
      if (sg.number) { const r = addNode(g, node.id, opOf("number"), returns, { output: node.output ?? `${value.replace(/[^a-z0-9]+/gi, "_")}_number` }); g = r.graph; setGraph(() => g); select(r.id); return; }
      setGraph(() => g); setEditing(false); return;
    }
    setGraph((g) => updateNode(g, node.id, { op: { ...node.op!, args: node.op!.args.map((a, i) => (i === 0 ? { value } : a)) } })); setEditing(false); setBuilding(null); if (node.op.name === "click" || node.op.name === "write" || node.op.name === "wait_for") { const args = node.op.name === "write" ? [value, String(node.op.args[1]?.value ?? "")] : [value]; runAction(node.op.name, args, false); } };
  React.useEffect(() => {  // Esc: the inspector, then the edit, then up to the parent
    const h = (e: KeyboardEvent) => { if (!active || e.target instanceof HTMLInputElement) return; if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); } else if (e.key === "Escape") { if (pickEl) { setPickEl(null); setBuilding(null); } else if (editing) setEditing(false); else if (node?.parent) select(node.parent); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pickEl, editing, node?.parent]);

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
  const samples = React.useMemo(() => { const out: Record<string, string> = {}; if (!graph) return out; for (const [id, v] of Object.entries(values)) { const n = graph.nodes[id]!; out[id] = n.op?.name === "resolve" ? (pages[id]?.url ? new URL(pages[id]!.url).pathname.slice(0, 26) : "") : sample(v); } return out; }, [values, graph, pages]);
  const stripScripts = (views.data?.tiers ?? []).slice(-1)[0] === "browser";
  const nodeEl = node ? elementsOf(values[node.id])[0] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form onSubmit={(e) => { e.preventDefault(); if (draft) start(draft, tier); }} className="flex min-w-[280px] flex-1 items-center gap-2">
          <Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="a URL: the plan starts with its Reference" className="w-full" />
          <Select value={tier} onChange={(e) => setStateRaw((s) => (s ? { ...s, tier: e.target.value as Tier } : s))} title="the tier new pages open with"><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId}>Start</Button>
        </form>
        <ToolbarSpacer />
        {history.current.length > 0 && <Button size="sm" variant="ghost" onClick={undo} title="undo (⌘Z)">undo</Button>}
        {state && <><Button size="sm" variant="secondary" onClick={save}>Save</Button><Button size="sm" variant="secondary" onClick={exportPlan}>Export</Button></>}
        <Button size="sm" variant="ghost" onClick={importPlan}>Import</Button>
        {saved.data && saved.data.length > 0 && <Select value="" onChange={(e) => { if (e.target.value) load(e.target.value); }}><option value="">— saved —</option>{saved.data.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</Select>}
        {outs.length > 0 && <Button variant="primary" size="sm" onClick={runServer} disabled={run.busy || missing.length > 0} title={missing.length ? `${missing.length} op(s) still need an argument` : undefined}>{run.busy ? "running…" : `Run ▶ (${outs.length} outputs)`}</Button>}
      </Toolbar>
      {!state || !graph ? <EmptyState title="Start from a URL" hint="The plan starts with its Reference. Open it as a Document; click any line of the plan to focus it -- the page renders that object and new selectors root there. Shift-click the page to build a selector; the suggestions offer records, fields and attributes." /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[400px_minmax(0,1fr)_400px]">
        {/* the plan */}
        <section className="flex min-h-0 flex-col gap-1 rounded-lg border border-line p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">The plan · click a line to focus it</div>
          <GraphView graph={graph} selected={node?.id ?? graph.root} onSelect={(id) => select(id)} onChange={(g) => setGraph(() => g)} samples={samples} live={liveSet} edges={edges} editing={selfMode} onEditArg={(id) => { if (id !== selected) setSelectedRaw(id); setEditing(true); }} className="min-h-0 flex-1 overflow-auto" />
          {missing.length > 0 && <div className="text-[10px] text-bad">{missing.length} op(s) still need an argument: shift-click the page or pick a suggestion.</div>}
          <div className="text-[10px] text-muted">Esc: close / stop editing / up. Hover a line: → output · ×.</div>
        </section>
        {/* the focused object, rendered */}
        <div className="relative flex min-w-0 flex-col gap-2">
          <div className="flex h-7 items-center gap-2 overflow-hidden whitespace-nowrap text-[12px]">
            <Chip tone={selfMode ? "warn" : "accent"}>{selfMode ? `click the page to pick .${node?.op?.name}() in ${rootLabel}` : `focus: ${rootLabel} · interactive · shift-click records · clicking something in the plan jumps to it`}</Chip>
            <span className="flex-1" />
            {pageNode && <><span className="truncate font-mono text-[11px] text-muted" title={page?.url}>{page?.url ?? "…"}</span>{page?.docId && <Button size="sm" variant="ghost" onClick={reload} title="reload the page">⟳</Button>}{!page?.live ? <Button size="sm" variant="ghost" onClick={goLive}>go live</Button> : <><Chip tone="ok" dot>live</Chip><label className="flex items-center gap-1 text-[11px]" title="shift-click records a click on the live page"><input type="checkbox" checked={recordActions} onChange={(e) => setRecordActions(e.target.checked)} />shift-click records</label></>}</>}
            {patternGroups.length > 0 && <Chip tone={showGroups ? "accent" : "neutral"} interactive onClick={() => setShowGroups(!showGroups)}>{patternGroups.length} groups</Chip>}
          </div>
          {!pageNode ? (
            <section className="rounded-lg border border-line p-3 text-[12px]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Reference</div>
              <Input mono value={graph.url} onChange={(e) => setGraph((g) => ({ ...g, url: e.target.value }))} className="mb-2 w-full" />
              <div className="text-muted">Open it with one of the <b>.resolve()</b> edges on the left.</div>
            </section>
          ) : err && !views.data ? (
            <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={err.hint ?? err.message} action={<Button onClick={() => setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } }))}>Retry</Button>} />
          ) : page?.live ? (
            <Player events={stream} live highlights={playerHls} pickable shiftPick={!selfMode} focus={roots} onPick={(p) => { if (p.el) setPickEl(p.el); }} onClickThrough={(p, m) => { const par = actionParent(); const hitNode = p.el ? matchOf({ op: "click", pick: { path: [], tag: p.tag, classes: p.classes, text: p.text }, shift: m.shift }, p.el) : null; if (hitNode) select(hitNode.id); runAction("click", [p.el ? selFor(p.el) : p.path], recordActions && m.shift && !hitNode, par?.id); }} onDocument={(d) => setDocs((ds) => (ds[pageKey] === d ? ds : { ...ds, [pageKey]: d }))} controls={false} controller={controller} maxHeight={760} />
          ) : card && card.kind === "binary" ? (
            <EmptyState title={`A file · ${(views.data as { card?: { content_type?: string } } | undefined)?.card?.content_type ?? "binary"}`} hint="Not a page to render: add the .download() edge to return its bytes (a file value: url, filename, content type, size, base64)." action={<Button onClick={() => node && addEdge("download", [], {}, { output: "file" })}>.download()</Button>} />
          ) : views.data?.content ? (
            <PageFrame html={views.data.content} base={views.data.url ?? page?.url ?? graph.url} stripScripts={stripScripts} focusPaths={roots.length ? roots.map(pathOf) : null} highlights={frameHls} picking={selfMode} onPick={onFramePick} onAction={onFrameAction} maxHeight={760} />
          ) : <EmptyState title={pageUrl(pageKey) || page?.url ? "Opening the page into your session…" : "This page's URL comes from the page before it: open that first"} />}
          {actError && <div className="text-[12px]"><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</div>}
          {busy && <div className="text-[12px] text-muted">{busy}…</div>}
        </div>
        {/* the inspector / suggestions / the object, then the output */}
        <div className="flex min-w-0 flex-col gap-3">
          {pick && doc ? (
            <ElementInspector pick={pick} scopeEl={rootFor(pickEl)} scopeLabel={rootLabel} ops={opsQ.data?.Document ?? []} groups={pickGroups} live={!!page?.live} onSelector={(s) => setBuilding(s || null)} onAdd={onAdd} applyTo={selfMode && node?.op ? { label: `.${node.op.name}()` } : null} onApply={onApply} onClose={() => { setPickEl(null); setBuilding(null); }} />
          ) : (selfMode || attrMode) && node?.op ? (
            <section className="rounded-lg border border-warn/50 p-2 text-[12px]">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{node.op.name === "attr" ? "read: every attribute of the elements (as a number where it holds one) -- pick one" : `.${node.op.name}() needs a selector -- click the page, or:`}</div>
              <div className="flex flex-col gap-0.5">{suggestions.map((s) => <button key={s.value + (s.number ? "#n" : "") + (s.pattern ?? "")} type="button" className="flex items-center gap-1 rounded px-1 text-left hover:bg-surface-2" onClick={() => applySuggestion(s.value, s)} onMouseEnter={() => node.op?.name !== "attr" && setBuilding(s.value)} onMouseLeave={() => setBuilding(null)}><code className="shrink-0 font-mono text-[11px] text-accent">{s.value}</code>{s.count != null && <span className="rounded bg-surface-2 px-1 text-[10px]">×{s.count}</span>}<span className="text-[10px] text-muted">{s.label}</span><span className="min-w-0 flex-1 truncate text-[11px] text-muted">{s.sample}</span></button>)}{!suggestions.length && <span className="text-muted">no suggestions here</span>}</div>
            </section>
          ) : node && node.op && (
            <section className="rounded-lg border border-line p-2 text-[12px]">
              <div className="mb-1 flex items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{node.type}</span><span className="text-muted">{samples[node.id]}</span><span className="flex-1" />{takesSelector && <button type="button" className="text-[11px] text-accent underline" onClick={() => setEditing(true)}>re-pick its selector</button>}</div>
              {node.type === "Collection" && <div className="flex flex-col gap-0.5"><div className="text-[11px] text-muted">All {elementsOf(values[node.id]).length} shown. Add an edge (select, attr…) and click inside any of them: it is read off EACH. The fields they share:</div>{selectors.suggestFields(elementsOf(values[node.id]), 14).map((f) => <button key={f.selector + f.attr + (f.number ? "#n" : "")} type="button" className="flex items-center gap-1 rounded px-1 text-left hover:bg-surface-2" onClick={() => { const s = addNode(graph, node.id, opOf("select", [f.selector]), returns); setGraph(() => addRead(s.graph, s.id, f.attr, { output: f.name }, f.pattern, f.number).graph); }}><span className="text-accent">+</span><code className="font-mono text-[10px]">{f.selector} · {f.attr}{f.number ? " → number" : ""}</code><span className="truncate text-[11px] text-muted">{f.sample}</span></button>)}</div>}
              {node.type === "Element" && nodeEl && <div className="flex flex-col gap-0.5"><div className="text-[11px] text-muted">Read off it (text, count, label, href, data-*, aria-*…):</div>{selectors.attributesOfAll(elementsOf(values[node.id])).map((a) => <button key={a.attr + (a.number ? "#n" : "")} type="button" className="flex items-center gap-1 rounded px-1 text-left hover:bg-surface-2" onClick={() => { const name = a.attr === "text" ? selectors.nameFromSelector(String(node.op?.args[0]?.value ?? ""), nodeEl.tagName.toLowerCase()) : a.attr.replace(/[^a-z0-9]+/gi, "_"); const r = addRead(graph, node.id, a.attr, { output: a.number ? `${name}_number` : name }, a.pattern, a.number); setGraph(() => r.graph); select(r.id); }}><span className="text-accent">+</span><code className="w-28 shrink-0 font-mono text-[10px]">{a.number ? `${a.attr} → number` : a.attr}</code><span className="truncate text-[11px] text-muted">{a.label ?? a.value}</span></button>)}</div>}
              {node.type === "Document" && <div className="text-[11px] text-muted">The page is interactive. Clicking something the plan already has jumps to it (a link opens that page); SHIFT-click records a link, a control or a field you type into as nodes. To select, add an edge on the left, then click the page or a suggestion.{node.op?.name === "resolve" && <Pager n={node} onChange={(mod) => setGraph((g) => setMod(g, node.id, mod, "paginate"))} />}</div>}
              {(node.type === "Value" || node.type === "Reference" || node.type === "Element") && node.op && (
                <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted">column name:</span>
                  <input className="h-6 w-28 rounded border border-line bg-surface px-1" value={node.output ?? ""} placeholder="a name" onChange={(e) => setGraph((g) => updateNode(g, node.id, { output: e.target.value || undefined, alias: undefined }))} />
                  {(() => { const enc = graphLib.eachOf(graph, node.id) ?? pageNode; const sibs = enc ? outputs(graph).filter((o) => o.id !== node.id && o.output && graphLib.eachOf(graph, o.id)?.id === (graphLib.eachOf(graph, node.id)?.id)) : []; const cur = graphLib.aliasField(node.alias); return sibs.length ? <><span className="text-muted">or by a column:</span><select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={cur ?? ""} onChange={(e) => setGraph((g) => updateNode(g, node.id, e.target.value ? { alias: graphLib.fieldAlias(e.target.value), output: undefined } : { alias: undefined }))}><option value="">—</option>{sibs.map((o) => <option key={o.id} value={o.output}>{o.output}</option>)}</select></> : null; })()}
                  <span className="text-muted">or from the page:</span>
                  <input className="h-6 w-24 rounded border border-line bg-surface px-1 font-mono text-[10px]" placeholder="e.g. th" defaultValue={graphLib.aliasField(node.alias) ? "" : String(node.alias?.[1]?.args?.[0]?.value ?? "")} onBlur={(e) => { const v = e.target.value.trim(); if (!v && graphLib.aliasField(node.alias)) return; setGraph((g) => updateNode(g, node.id, v ? { alias: [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: v }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }], output: undefined } : { alias: undefined })); }} title="a selector (relative to the record) whose text names this column: .alias(select(…).attr('text'))" />
                </div>
              )}
              {node.type === "Value" && <div className="flex flex-col gap-0.5">{(Array.isArray(values[node.id]) ? (values[node.id] as unknown[]).flat(3).slice(0, 12) : [values[node.id]]).map((x, i) => <div key={i} className="truncate font-mono text-[11px]">{isEl(x) ? `<${x.tagName.toLowerCase()}>` : String(x ?? "∅")}</div>)}</div>}
            </section>
          )}
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "rows", label: "Rows", count: shown.rows.length }, { value: "server", label: "Server run", count: run.rows?.length }, { value: "plan", label: "Compiled" }, { value: "page", label: "Page" }, { value: "skeleton", label: "Skeleton" }, { value: "markdown", label: "Markdown" }, { value: "elements", label: "Elements" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="rows">{!outs.length ? <EmptyState title="No outputs yet" hint="Hover a line of the plan → output, or tick reads in the inspector." /> : <><div className="px-2 pt-1 text-[11px] text-muted">{shown.nested ? "The rows whose page is open here, with their parent row's columns -- the server run fetches every page." : "Preview on this page, nested values exploded into columns; the server run returns the nested JSON."}</div><DataFrame rows={shown.rows} className="max-h-[400px]" emptyHint="The outputs matched nothing on the page yet." /></>}</TabPanel>
              <TabPanel value="server">{run.error ? <div className="p-3 text-[12px]"><Chip tone="bad">{run.error.detail?.code ?? run.error.status}</Chip> {run.error.detail?.hint ?? run.error.message}</div> : run.rows ? <><div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-muted">{run.rows.length} rows from the server in {run.ms} ms<span className="flex-1" /><label className="flex items-center gap-1"><input type="checkbox" checked={asJson} onChange={(e) => setAsJson(e.target.checked)} />JSON</label></div>{asJson ? <CodeBlock lang="json" code={JSON.stringify(run.rows, null, 2)} className="m-2 max-h-[400px] overflow-auto" /> : <DataFrame rows={run.rows} className="max-h-[400px]" />}</> : <EmptyState title="Not run yet" />}</TabPanel>
              <TabPanel value="plan" className="max-h-[460px] overflow-auto p-2">{plan && <><CodeBlock lang="describe" code={planLib.describe(plan)} wrap /><PlanView plan={plan} url={graph.url} readOnly className="mt-2" /></>}</TabPanel>
              <TabPanel value="page" className="p-2 text-[12px]">
                {card && <div className="mb-1 flex flex-wrap items-center gap-1"><Chip tone="neutral">{card.kind}</Chip><Chip tone={card.status_code && card.status_code < 400 ? "ok" : "bad"}>{card.status_code}</Chip><Chip tone="neutral">{(views.data?.tiers ?? [card.final_tier]).join(" → ")}</Chip><span className="truncate text-muted">{views.data?.title}</span></div>}
                <FlagRow flags={views.data?.flags ?? []} empty="no signals on this page" />
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">{patternGroups.map((g) => <button key={g.selector} type="button" className="inline-flex items-center gap-1 rounded border border-line px-1 hover:bg-surface-2" title={g.why} onClick={() => setShowGroups(true)}><span className="inline-block size-2 rounded-sm" style={{ background: g.colour }} />{g.name} <code className="font-mono">{g.selector}</code> ×{g.count}</button>)}</div>
              </TabPanel>
              <TabPanel value="skeleton" className="max-h-[460px] overflow-auto p-2">{more.data?.skeleton ? <SkeletonPane skeleton={more.data.skeleton} active={pick ? "<" + pick.tag : null} /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="markdown" className="max-h-[460px] overflow-auto p-2">{more.data?.markdown ? <CodeBlock lang="markdown" code={more.data.markdown} wrap /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="elements" className="max-h-[460px] overflow-auto">{(more.data?.elements ?? views.data?.controls) && <ElementTable elements={more.data?.elements ?? views.data!.controls!} />}</TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("execute", { url: graph.url }, API_URL)} blob={planQ.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(planQ.data?.blob ?? "<the blob appears once the plan has outputs>")}, wc).collect()`} /></TabPanel>
            </Tabs>
          </section>
        </div>
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

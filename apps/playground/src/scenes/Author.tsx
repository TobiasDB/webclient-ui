import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementInspector, ElementTable, EmptyState, FlagRow, GraphView, Input, MediaBar, PlanView, Player, Select, SkeletonPane,
  TabPanel, Tabs, Toolbar, ToolbarSpacer, fieldColour, graphLib, planLib, selectors, toolAsCode, usePlayerController,
  type Graph, type Highlight, type InspectAdd, type Pick, type Plan, type RREvent,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { call as callBody, plan as planBody, useActive, useSession } from "../lib/session";

const { addNode, updateNode, setMod, opOf, emptyGraph, children, ancestors, pageOf, evalNode, elementsOf, sample, hrefOf, compile, decompile, outputs } = graphLib;
const VIEWS = ["card", "rrweb", "patterns", "records", "flags", "controls"];
const GROUP_HUES = ["#e11d48", "#7c3aed", "#0891b2", "#ca8a04", "#16a34a", "#db2777", "#2563eb", "#9333ea"];
type Tier = "false" | "auto" | "always";
type Page = { docId?: string; live?: boolean; url: string };
type State = { tier: Tier; graph: Graph };

const enc = (s: State) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s: string): State | null => { try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o && o.graph && o.graph.nodes ? o : null; } catch { return null; } };
const browserKw = (tier: Tier) => (tier === "false" ? {} : { browser: tier === "always" ? true : "auto" });
const tierOf = (n: graphLib.GNode | undefined): Tier => { const b = n?.op?.kwargs.browser?.value; return b === true ? "always" : b === "auto" ? "auto" : "false"; };
/** a CSS path for a node on its page: the select / select_all selectors from the page down (for outlining) */
function pathSelector(g: Graph, id: string): string | null {
  const page = pageOf(g, id); if (!page) return null; const path = ancestors(g, id); const from = path.findIndex((n) => n.id === page.id);
  const sels = path.slice(from + 1).filter((n) => n.op && (n.op.name === "select" || n.op.name === "select_all")).map((n) => String(n.op!.args[0]?.value ?? ""));
  return sels.length ? sels.join(" ") : null;
}
/** the node new ops hang off: the nearest Document / Element / Collection at or above `id` */
function scopeOf(g: Graph, id: string): graphLib.GNode | null { for (const n of ancestors(g, id).reverse()) if (n.type === "Document" || n.type === "Element" || n.type === "Collection") return n; return null; }

/** THE Author workspace: the builder GRAPH. Nodes are the package's objects -- a Reference, a
 * Document (a page, static or live), an Element, a Collection (its children run on each
 * element), a Value -- and every edge is an op of the parent's surface. Select a node: it is the
 * scope; its page shows (static or live); clicking an element opens the INSPECTOR (its parents,
 * its classes, every attribute, the candidates per group, the ops), whose ops add nodes. Name
 * nodes to make them OUTPUT columns; the graph compiles to the plan the service runs. */
export function Author() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/author");
  const sessionId = useSession();
  const qc = useQueryClient();
  const controller = usePlayerController();
  const opsQ = useQuery({ queryKey: ["ops"], queryFn: api.ops, staleTime: Infinity });
  const returns = React.useMemo(() => Object.fromEntries((opsQ.data?.Document ?? []).map((o) => [o.name, (o as { returns?: string }).returns ?? "Value"])), [opsQ.data]);

  // -- the model (the graph), its history, the URL --------------------------------------
  const [state, setStateRaw] = React.useState<State | null>(() => dec(params.get("g") ?? ""));
  const history = React.useRef<State[]>([]);
  const setGraph = React.useCallback((fn: (g: Graph) => Graph) => setStateRaw((s) => { if (!s) return s; const g = fn(s.graph); if (g === s.graph) return s; history.current = [...history.current.slice(-80), s]; return { ...s, graph: g }; }), []);
  const undo = () => { const prev = history.current.pop(); if (prev) setStateRaw(prev); };
  const [selected, setSelected] = React.useState<string>("root");
  const [pages, setPages] = React.useState<Record<string, Page>>({});
  const [docs, setDocs] = React.useState<Record<string, Document>>({});
  const [pick, setPick] = React.useState<Pick | null>(null);
  const [building, setBuilding] = React.useState<{ selector: string; mode: string } | null>(null);
  const [run, setRun] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean; replay?: RREvent[] }>({ busy: false });
  const reset = (s: State | null, sel = "root", keep: Record<string, Page> = {}) => { setStateRaw(s); history.current = []; setPages(keep); setDocs({}); setSelected(sel); setPick(null); setRun({ busy: false }); };
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
  const node = graph?.nodes[selected] ?? (graph ? graph.nodes[graph.root] : undefined);
  React.useEffect(() => { if (graph && !graph.nodes[selected]) setSelected(graph.root); }, [graph, selected]);

  // -- the page of the selected node ---------------------------------------------------------
  const pageNode = graph && node ? pageOf(graph, node.id) : null;
  const pageKey = pageNode?.id ?? "";
  const page = pages[pageKey];
  const doc = docs[pageKey] ?? null;
  const [tick, setTick] = React.useState(0);
  /** the URL a page node opens: the start URL under the root, else the href its parent reads (first record) */
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
  const views = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "author"], queryFn: () => api.docViews(sessionId!, page!.docId!, VIEWS), enabled: !!sessionId && !!page?.docId, staleTime: Infinity, retry: false });
  React.useEffect(() => { const e = views.error as ApiError | null; if (e && e.status === 404 && pageKey) setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } })); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.error]);
  const more = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "more"], queryFn: () => api.docViews(sessionId!, page!.docId!, ["skeleton", "markdown", "elements"]), enabled: !!sessionId && !!page?.docId && views.isSuccess, staleTime: Infinity });
  const reload = async () => { if (!sessionId || !page?.docId) return; await api.docReload(sessionId, page.docId); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, page.docId] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); setStream([]); since.current = 0; };
  const onDocument = (d: Document) => { if (!pageKey) return; setDocs((ds) => (ds[pageKey] === d ? ds : { ...ds, [pageKey]: d })); setTick((t) => t + 1); };

  // -- live -----------------------------------------------------------------------------------
  const [stream, setStream] = React.useState<RREvent[]>([]);
  const since = React.useRef(0);
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

  // -- values on the page: samples, the scope element, highlights --------------------------------
  const values = React.useMemo(() => { const out: Record<string, unknown> = {}; if (!graph) return out; for (const n of Object.values(graph.nodes)) { const p = pageOf(graph, n.id); if (p && docs[p.id]) out[n.id] = n.id === p.id ? docs[p.id] : evalNode(graph, n.id, docs[p.id]!); } return out; }, [graph, docs, tick]);
  const samples = React.useMemo(() => { const out: Record<string, string> = {}; if (!graph) return out; for (const [id, val] of Object.entries(values)) { const n = graph.nodes[id]!; out[id] = n.type === "Document" && n.op?.name === "resolve" ? (pages[id]?.url ? new URL(pages[id]!.url).pathname.slice(0, 30) : "") : sample(val); } return out; }, [values, graph, pages]);
  const scope = graph && node ? scopeOf(graph, node.id) : null;
  const scopeLabel = !scope || scope.type === "Document" ? "the page" : scope.type === "Collection" ? `each ${String(scope.op?.args[0]?.value ?? "")}` : `the ${String(scope.op?.args[0]?.value ?? "")}`;
  // the scope's element in the SAME document as the clicked element (the Player may have rebuilt its page since)
  const scopeElFor = (el: Element | null): Element | null => { if (!graph || !scope || scope.type === "Document" || !el) return null; const els = elementsOf(evalNode(graph, scope.id, el.ownerDocument)); return els.find((x) => x.contains(el)) ?? null; };
  const liveSet = React.useMemo(() => new Set(Object.entries(pages).filter(([, p]) => p.live).map(([k]) => k)), [pages]);
  const outs = graph ? outputs(graph) : [];
  const highlights: Highlight[] = [];
  if (graph && pageNode) {
    for (const [i, o] of outs.entries()) { if (pageOf(graph, o.id)?.id !== pageNode.id) continue; const sel = pathSelector(graph, o.id); if (sel) highlights.push({ selector: sel, label: o.output ?? "name from page", colour: fieldColour(i) }); }
    const selSel = node ? pathSelector(graph, node.id) : null; if (selSel) highlights.push({ selector: selSel, label: node!.type === "Collection" ? "each" : "scope", tone: "accent" });
    if (building && pick) { const pre = scope && scope.type !== "Document" ? pathSelector(graph, scope.id) : null; highlights.push({ selector: pre ? `${pre} ${building.selector}` : building.selector, label: building.mode === "each" ? "each" : "match", tone: "warn", dashed: true }); }
  }
  const [showGroups, setShowGroups] = React.useState(false);
  const patternGroups = React.useMemo(() => {
    const out: { name: string; selector: string; count: number; colour: string; why: string }[] = [];
    for (const h of views.data?.patterns ?? []) if (h.subject && !out.some((o) => o.selector === h.subject)) out.push({ name: h.name.replace(/_/g, " "), selector: h.subject, count: h.count ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: `pattern · ${Math.round((h.confidence ?? 0) * 100)}%` });
    for (const r of views.data?.records ?? []) if (!out.some((o) => o.selector === r.selector)) out.push({ name: r.name || "repeating", selector: r.selector, count: r.repeats ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: "repeating region" });
    return out.slice(0, 8);
  }, [views.data]);
  if (showGroups) for (const g of patternGroups) highlights.push({ selector: g.selector, label: g.name, colour: g.colour, dashed: true });
  const pickGroups = React.useMemo(() => { const el = pick?.el; if (!el) return []; return patternGroups.filter((g) => { try { return !!el.closest(g.selector); } catch { return false; } }).map((g) => ({ name: g.name, colour: g.colour, count: g.count })); }, [pick, patternGroups]);

  // -- adding nodes ----------------------------------------------------------------------------
  const onSelector = React.useCallback((selector: string, mode: string) => setBuilding(selector ? { selector, mode } : null), []);
  const aliasSteps = (sel: string): planLib.Step[] => [{ kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: sel }], kwargs: {} }, { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }];
  const onAdd = async (a: InspectAdd) => {
    if (!graph || !scope) return;
    setPick(null); setBuilding(null);
    if (a.op === "paginate" && pageNode) {
      setGraph((g) => setMod(g, pageNode.id, opOf("paginate", [], { max_pages: 5, ...a.kwargs })));
      if (a.kwargs?.by === "click" && !page?.live) await goLive();
      return;
    }
    if (["click", "write", "scroll", "wait_for"].includes(a.op)) {
      if (!sessionId) return;
      let docId = page?.live ? page.docId : null; if (!docId) docId = await goLive(); if (!docId) return;
      const args = a.args ?? [a.selector];
      setBusy(a.op); setActError(null);
      try {
        await api.executeDoc({ plan: planBody("Document", [callBody(a.op, args)], sessionId), document_id: docId });
        if (a.record !== false) { const r = addNode(graph, scope.id, opOf(a.op, args), returns); setGraph(() => r.graph); setSelected(r.id); }
        qc.invalidateQueries({ queryKey: ["doc-views", sessionId, docId] });
      } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
      return;
    }
    let g = graph; let focus = scope.id;
    if (a.op === "resolve") {  // open the link: select it, read its href, resolve it -- a new page node
      const s = addNode(g, scope.id, opOf("select", [a.selector]), returns); g = s.graph;
      const h = addNode(g, s.id, opOf("attr", ["href"]), returns); g = h.graph;
      const r = addNode(g, h.id, opOf("resolve", [], browserKw(tier)), returns); g = r.graph; focus = r.id;
    } else {
      const r = addNode(g, scope.id, opOf(a.op, [a.selector]), returns); g = r.graph; focus = r.id;
      for (const rd of a.reads ?? []) {
        let at = r.id;
        if (rd.select) { const s = addNode(g, at, opOf("select", [rd.select]), returns); g = s.graph; at = s.id; }
        const name = rd.name || (rd.attr === "text" ? selectors.nameFromSelector(rd.select ?? a.selector, pick?.tag ?? "") : rd.attr.replace(/[^a-z0-9]+/gi, "_"));
        const x = addNode(g, at, opOf("attr", [rd.attr]), returns, rd.nameFrom ? { alias: aliasSteps(rd.nameFrom) } : { output: name }); g = x.graph;
      }
    }
    setGraph(() => g); setSelected(focus);
  };
  const addChild = (parent: string, name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}, extra: Partial<graphLib.GNode> = {}) => { if (!graph) return; const r = addNode(graph, parent, opOf(name, args, kwargs), returns, extra); setGraph(() => r.graph); setSelected(r.id); return r.id; };
  React.useEffect(() => {  // Esc: the inspector, then up to the parent node
    const h = (e: KeyboardEvent) => { if (!active || e.target instanceof HTMLInputElement) return; if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); } else if (e.key === "Escape") { if (pick) { setPick(null); setBuilding(null); } else if (node?.parent) setSelected(node.parent); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pick, node?.parent]);

  // -- the plan: compile, preview rows, run, save / export / import --------------------------------
  const plan = React.useMemo<Plan | null>(() => (graph ? compile(graph) : null), [graph]);
  const [tab, setTab] = React.useState("rows");
  const planQ = useQuery({ queryKey: ["plan", plan ? JSON.stringify(plan) : ""], queryFn: () => api.plan({ plan: { ...plan!, session_id: sessionId } }), enabled: !!plan && plan.steps.length > 2 });
  const preview = React.useMemo(() => {
    if (!graph || !plan) return { rows: [] as Record<string, unknown>[] };
    const rootPage = children(graph, graph.root).find((c) => c.op?.name === "resolve" && docs[c.id]);
    const rootDoc = rootPage ? docs[rootPage.id]! : null; if (!rootDoc || !outs.length) return { rows: [] };
    const base = pages[rootPage!.id]?.url ?? graph.url;
    const byUrl = new Map(Object.entries(pages).filter(([k]) => docs[k]).map(([k, p]) => [p.url, docs[k]!]));
    const followed = (href: string, rest: Plan) => { let abs = href; try { abs = new URL(href, base).toString(); } catch { /* keep */ } const d = byUrl.get(abs); return d ? planLib.evalLocal(rest, d.body) : `→ ${abs}`; };
    const cs = planLib.calls(plan); const after = cs[1]?.index ?? plan.steps.length;
    const local = planLib.localRows({ root: "Document", steps: plan.steps.slice(cs[0]?.name === "resolve" ? (cs[1] ? cs[1].index : plan.steps.length) : 0) }, rootDoc, followed);
    void after;
    return { rows: local.rows };
  }, [graph, plan, docs, pages, outs.length, tick]);
  const runServer = async () => {
    if (!plan || !graph) return; setRun({ busy: true }); setTab("server"); const t0 = performance.now();
    const cursor = (await api.history({ since: 0 }).catch(() => [])).reduce((m, e) => Math.max(m, e.n ?? 0), 0);
    try {
      const out = await api.execute({ plan: { ...plan, session_id: sessionId }, url: graph.url });
      const evs = await api.history({ since: cursor }).catch(() => []);
      const customs: RREvent[] = evs.filter((e) => !["rrweb", "snapshot", "trace"].includes(e.topic)).map((e) => { const { events: _d, content: _c, body: _b, ...payload } = e as any; return { type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? 0) * 1000) }; });
      const base = (views.data?.rrweb ?? []) as RREvent[]; const t = customs[0]?.timestamp ?? Date.now();
      setRun({ rows: (Array.isArray(out.rows) ? out.rows : out.rows && typeof out.rows === "object" ? [out.rows as Record<string, unknown>] : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false, replay: base.length ? [{ ...base[0]!, timestamp: t - 2 }, { ...base[1]!, timestamp: t - 1 }, ...customs] : [] });
    } catch (e) { setRun({ error: e as ApiError, busy: false }); }
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
  const playerEvents = page?.live ? stream : run.replay && tab === "server" ? run.replay : ((views.data?.rrweb ?? []) as RREvent[]);
  const err = openError ?? (views.error as ApiError | null);
  const card = views.data?.card;
  const docOps = (opsQ.data?.Document ?? []).filter((o) => o.kind === "call" && !o.io && o.params.every((p) => !p.required) && !["extract", "project", "paginate", "count", "select", "select_all", "screenshot", "evaluate", "render", "iframe", "ref", "events_of", "element_table", "content_elements", "as_json"].includes(o.name));
  const nodeEls = node ? elementsOf(values[node.id]) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form onSubmit={(e) => { e.preventDefault(); if (draft) start(draft, tier); }} className="flex min-w-[280px] flex-1 items-center gap-2">
          <Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="a URL: the Reference the graph starts from" className="w-full" />
          <Select value={tier} onChange={(e) => setStateRaw((s) => (s ? { ...s, tier: e.target.value as Tier } : s))} title="the tier new pages open with"><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId}>Start</Button>
        </form>
        <ToolbarSpacer />
        {history.current.length > 0 && <Button size="sm" variant="ghost" onClick={undo} title="undo (⌘Z)">undo</Button>}
        {state && <><Button size="sm" variant="secondary" onClick={save}>Save</Button><Button size="sm" variant="secondary" onClick={exportPlan}>Export</Button></>}
        <Button size="sm" variant="ghost" onClick={importPlan}>Import</Button>
        {saved.data && saved.data.length > 0 && <Select value="" onChange={(e) => { if (e.target.value) load(e.target.value); }}><option value="">— saved —</option>{saved.data.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</Select>}
        {outs.length > 0 && <Button variant="primary" size="sm" onClick={runServer} disabled={run.busy}>{run.busy ? "running…" : `Run ▶ (${outs.length} outputs)`}</Button>}
      </Toolbar>
      {!state || !graph ? <EmptyState title="Start from a URL" hint="The graph starts with its Reference. Open it (static, auto, a browser, live) and you have a Document: click anything on it -- the inspector shows its parents, classes and attributes, and its ops add nodes: select_all (each), select (the one), click, type, open a link (a new Document), pages. Name nodes to make them output columns; Run executes the plan the graph compiles to." /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[360px_minmax(0,1fr)_420px]">
        {/* the graph */}
        <section className="flex min-h-0 flex-col gap-1 rounded-lg border border-line p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">The graph · objects and ops</div>
          <GraphView graph={graph} selected={node?.id ?? graph.root} onSelect={(id) => { setSelected(id); setPick(null); setBuilding(null); }} onChange={(g) => setGraph(() => g)} samples={samples} live={liveSet} className="min-h-0 flex-1 overflow-auto" />
          <div className="text-[10px] text-muted">Esc: close the inspector, then up to the parent. Hover a node: + output · ×.</div>
        </section>
        {/* the selected object's view */}
        <div className="relative flex min-w-0 flex-col gap-2">
          <div className="flex h-7 items-center gap-2 overflow-hidden whitespace-nowrap text-[12px]">
            <Chip tone="accent">{node?.type}</Chip><span className="truncate font-mono text-[11px] text-muted">{node ? graphLib.describeOp(node) : ""}</span>
            <span className="flex-1" />
            {pageNode && <><span className="truncate font-mono text-[11px] text-muted" title={page?.url}>{page?.url ?? "…"}</span>{page?.docId && <Button size="sm" variant="ghost" onClick={reload} title="reload the page">⟳</Button>}{!page?.live ? <Button size="sm" variant="ghost" onClick={goLive}>go live</Button> : <Chip tone="ok" dot>live</Chip>}</>}
            {patternGroups.length > 0 && <Chip tone={showGroups ? "accent" : "neutral"} interactive onClick={() => setShowGroups(!showGroups)}>{patternGroups.length} groups</Chip>}
          </div>
          {node?.type === "Reference" ? (
            <section className="rounded-lg border border-line p-3 text-[12px]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Reference</div>
              {node.id === graph.root ? <Input mono value={graph.url} onChange={(e) => setGraph((g) => ({ ...g, url: e.target.value }))} className="mb-2 w-full" /> : <div className="mb-2 truncate font-mono text-[11px]" title={pageUrl(node.id) ?? ""}>{String(samples[node.id] ?? "")}{" → "}{(() => { const p = pageOf(graph, node.id); return p ? hrefOf(graph, node.id, docs[p.id] ?? null, pages[p.id]?.url ?? graph.url) ?? "" : ""; })()}</div>}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted">open it:</span>
                {(["false", "auto", "always"] as Tier[]).map((t) => <Button key={t} size="sm" variant={t === tier ? "primary" : "secondary"} onClick={() => addChild(node.id, "resolve", [], browserKw(t))}>{t === "false" ? "static" : t === "auto" ? "auto" : "browser"}</Button>)}
                <Button size="sm" variant="ghost" onClick={async () => { const id = addChild(node.id, "resolve", [], browserKw("always")); if (id) setTimeout(() => goLive(), 50); }}>live</Button>
              </div>
              {children(graph, node.id).length > 0 && <div className="mt-2 text-[11px] text-muted">Already opened: {children(graph, node.id).map((c) => <button key={c.id} type="button" className="mr-1 underline" onClick={() => setSelected(c.id)}>{graphLib.describeOp(c)}</button>)}</div>}
              {node.id !== graph.root && <div className="mt-2 text-[11px] text-muted">{graphLib.eachOf(graph, node.id) ? "Inside a collection: the page opens for the first record; the plan opens one per record." : ""}</div>}
            </section>
          ) : !pageNode ? <EmptyState title="No page here" /> : err && !views.data ? (
            <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={err.hint ?? err.message} action={<Button onClick={() => setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? "" } }))}>Retry</Button>} />
          ) : (playerEvents.length >= 2 || page?.live) ? (
            <Player events={playerEvents} live={!!page?.live} highlights={highlights} pickable={node?.type !== "Value"} onPick={(p) => setPick(p)} onHover={() => undefined} onDocument={onDocument} controls={false} controller={controller} autoPlay={!!run.replay && tab === "server"} maxHeight={760} />
          ) : <EmptyState title={pageUrl(pageKey) || page?.url ? "Opening the page into your session…" : "Select the Reference's value on the page first (its href)"} />}
          {actError && <div className="text-[12px]"><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</div>}
          {busy && <div className="text-[12px] text-muted">{busy}…</div>}
        </div>
        {/* the inspector / the node, then the output */}
        <div className="flex min-w-0 flex-col gap-3">
          {pick ? <ElementInspector pick={pick} scopeEl={scopeElFor(pick.el ?? null)} scopeLabel={scopeLabel} ops={(scope?.type === "Collection" ? opsQ.data?.Document : opsQ.data?.Document) ?? []} groups={pickGroups} live={!!page?.live} onSelector={onSelector} onAdd={onAdd} onClose={() => { setPick(null); setBuilding(null); }} />
            : node && node.type !== "Reference" && (
            <section className="rounded-lg border border-line p-2 text-[12px]">
              <div className="mb-1 flex items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{node.type}</span><span className="text-muted">{samples[node.id]}</span></div>
              {node.type === "Document" && node.op?.name === "resolve" && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] text-muted">Click anything on the page to inspect it. The page's own ops:</div>
                  <div className="flex flex-wrap gap-1">{docOps.slice(0, 14).map((o) => <button key={o.name} type="button" className="rounded border border-line px-1.5 text-[11px] hover:bg-surface-2" title={o.doc} onClick={() => addChild(node.id, o.name, [], {}, { output: o.name })}>{o.name}</button>)}</div>
                  <Pager n={node} onChange={(mod) => setGraph((g) => setMod(g, node.id, mod, "paginate"))} />
                </div>
              )}
              {node.type === "Collection" && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] text-muted">{nodeEls.length} elements. Click inside one on the page: what you pick is read off EACH. The fields they share:</div>
                  {selectors.suggestFields(nodeEls, 10).map((f) => <button key={f.selector + f.attr} type="button" className="flex items-center gap-1 rounded px-1 text-left hover:bg-surface-2" onClick={() => { const s = addNode(graph, node.id, opOf("select", [f.selector]), returns); const a = addNode(s.graph, s.id, opOf("attr", [f.attr]), returns, { output: f.name }); setGraph(() => a.graph); }}><span className="text-accent">+</span><code className="font-mono text-[10px]">{f.selector} · {f.attr}</code><span className="truncate text-[11px] text-muted">{f.sample}</span></button>)}
                  <label className="flex items-center gap-1 text-[11px]">first <input type="number" min={1} className="h-5 w-14 rounded border border-line bg-surface px-1 text-[11px]" value={Number(node.mods?.find((m) => m.name === "limit")?.args[0]?.value ?? "") || ""} onChange={(e) => setGraph((g) => setMod(g, node.id, e.target.value ? opOf("limit", [Number(e.target.value)]) : null, "limit"))} /> only</label>
                </div>
              )}
              {(node.type === "Element" || (node.type === "Document" && node.op?.name !== "resolve")) && nodeEls[0] && (
                <div className="flex flex-col gap-0.5">
                  <div className="text-[11px] text-muted">Read off it:</div>
                  {selectors.attributesOf(nodeEls[0]).map((a) => <button key={a.attr} type="button" className="flex items-center gap-1 rounded px-1 text-left hover:bg-surface-2" onClick={() => addChild(node.id, "attr", [a.attr], {}, { output: a.attr === "text" ? selectors.nameFromSelector(String(node.op?.args[0]?.value ?? ""), nodeEls[0]!.tagName.toLowerCase()) : a.attr.replace(/[^a-z0-9]+/gi, "_") })}><span className="text-accent">+</span><code className="w-24 shrink-0 font-mono text-[10px]">{a.attr}</code><span className="truncate text-[11px] text-muted">{a.value}</span></button>)}
                </div>
              )}
              {node.type === "Value" && (
                <div className="flex flex-col gap-0.5">{(Array.isArray(values[node.id]) ? (values[node.id] as unknown[]).flat(3).slice(0, 12) : [values[node.id]]).map((x, i) => <div key={i} className="truncate font-mono text-[11px]">{String(x ?? "∅")}</div>)}</div>
              )}
            </section>
          )}
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "rows", label: "Rows", count: preview.rows.length }, { value: "server", label: "Server run", count: run.rows?.length }, { value: "plan", label: "Plan" }, { value: "page", label: "Page" }, { value: "skeleton", label: "Skeleton" }, { value: "markdown", label: "Markdown" }, { value: "elements", label: "Elements" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="rows">{!outs.length ? <EmptyState title="No outputs yet" hint="Tick attributes in the inspector, or hover a node and press + output." /> : <DataFrame rows={preview.rows} className="max-h-[420px]" emptyHint="The outputs matched nothing on this page yet." />}</TabPanel>
              <TabPanel value="server">{run.error ? <div className="p-3 text-[12px]"><Chip tone="bad">{run.error.detail?.code ?? run.error.status}</Chip> {run.error.detail?.hint ?? run.error.message}{run.error.detail?.remedy && <div>remedy: <b>{run.error.detail.remedy}</b></div>}</div>
                : run.rows ? <><div className="px-2 pt-1 text-[11px] text-muted">{run.rows.length} rows from the server in {run.ms} ms</div><DataFrame rows={run.rows} className="max-h-[400px]" /></> : <EmptyState title="Not run yet" hint="Run ▶ executes the plan the graph compiles to, through your session." />}</TabPanel>
              <TabPanel value="plan" className="max-h-[460px] overflow-auto p-2">{plan && <><PlanView plan={plan} url={graph.url} readOnly /><CodeBlock lang="describe" code={planLib.describe(plan)} wrap className="mt-2" /></>}</TabPanel>
              <TabPanel value="page" className="p-2 text-[12px]">
                {card && <div className="mb-1 flex flex-wrap items-center gap-1"><Chip tone="neutral">{card.kind}</Chip><Chip tone={card.status_code && card.status_code < 400 ? "ok" : "bad"}>{card.status_code}</Chip><Chip tone="neutral">{(views.data?.tiers ?? [card.final_tier]).join(" → ")}</Chip><span className="truncate text-muted">{views.data?.title}</span></div>}
                {card?.description && <div className="mb-1 text-[11px] text-muted">{card.description}</div>}
                <FlagRow flags={views.data?.flags ?? []} empty="no signals on this page" />
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">{patternGroups.map((g) => <button key={g.selector} type="button" className="inline-flex items-center gap-1 rounded border border-line px-1 hover:bg-surface-2" title={g.why} onClick={() => setShowGroups(true)}><span className="inline-block size-2 rounded-sm" style={{ background: g.colour }} />{g.name} <code className="font-mono">{g.selector}</code> ×{g.count}</button>)}</div>
              </TabPanel>
              <TabPanel value="skeleton" className="max-h-[460px] overflow-auto p-2">{more.data?.skeleton ? <SkeletonPane skeleton={more.data.skeleton} active={pick ? "<" + pick.tag : null} /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="markdown" className="max-h-[460px] overflow-auto p-2">{more.data?.markdown ? <CodeBlock lang="markdown" code={more.data.markdown} wrap /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="elements" className="max-h-[460px] overflow-auto">{(more.data?.elements ?? views.data?.controls) && <ElementTable elements={more.data?.elements ?? views.data!.controls!} />}</TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("execute", { url: graph.url }, API_URL)} blob={planQ.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(planQ.data?.blob ?? "<the blob appears once the graph has outputs>")}, wc).collect()`} /></TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
      {(page?.live || (run.replay && tab === "server")) && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

/** A page's pager: how to reach the next page and how many. */
function Pager({ n, onChange }: { n: graphLib.GNode; onChange: (m: graphLib.Mod | null) => void }) {
  const m = n.mods?.find((x) => x.name === "paginate"); const kw = (k: string) => m?.kwargs[k]?.value as string | number | undefined;
  const set = (patch: Record<string, unknown>) => { const cur = Object.fromEntries(Object.entries(m?.kwargs ?? {}).map(([k, a]) => [k, a.value])); const next: Record<string, unknown> = { max_pages: 5, ...cur, ...patch }; for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined) delete next[k]; onChange(opOf("paginate", [], next)); };
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted">pages:</span>
      <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={m ? (kw("by") === "click" ? (kw("next") ? "more" : "scroll") : kw("next") ? "next" : String(kw("by") ?? "link")) : ""} onChange={(e) => { const v = e.target.value; if (!v) return onChange(null); set(v === "more" ? { by: "click", next: kw("next") ?? "button" } : v === "scroll" ? { by: "click", next: undefined } : v === "next" ? { by: "link", next: kw("next") ?? "a.next" } : { by: v, next: undefined }); }}>
        <option value="">one page</option><option value="link">rel=next</option><option value="next">a next link</option><option value="param">?page=</option><option value="cursor">cursor</option><option value="more">load more</option><option value="scroll">infinite scroll</option>
      </select>
      {m && (kw("next") !== undefined || kw("by") === "click") && <input className="h-6 w-28 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={String(kw("next") ?? "")} placeholder="selector" onChange={(e) => set({ next: e.target.value })} />}
      {m && kw("by") === "param" && <input className="h-6 w-16 rounded border border-line bg-surface px-1 font-mono text-[10px]" value={String(kw("name") ?? "page")} onChange={(e) => set({ name: e.target.value })} />}
      {m && <><input type="number" min={1} className="h-6 w-14 rounded border border-line bg-surface px-1 text-[11px]" value={Number(kw("max_pages") ?? 5)} onChange={(e) => set({ max_pages: Number(e.target.value) })} title="max_pages" /><span className="text-muted">pages max</span></>}
    </div>
  );
}

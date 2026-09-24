import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementMenu, ElementTable, EmptyState, FlagRow, Input, MediaBar, PlanView, Player, Select, SkeletonPane,
  TabPanel, Tabs, Toolbar, ToolbarGroup, ToolbarSpacer, fieldColour, planLib, toolAsCode, usePlayerController,
  type Highlight, type MenuOp, type Pick, type Plan, type Path, type RREvent,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { call as callBody, plan as planBody, useActive, useSession } from "../lib/session";

const { calls, call, insertCalls, planAt, updateCall, removeCall, localRows, shape, evalLocal, describe: describePlan, v } = planLib;
const VIEWS = ["card", "rrweb", "patterns", "records", "flags", "controls"];
const GROUP_HUES = ["#e11d48", "#7c3aed", "#0891b2", "#ca8a04", "#16a34a", "#db2777", "#2563eb", "#9333ea"];
const DATA_OPS = ["select_all", "select", "extract", "project", "attr", "limit", "filter"];
const ACTION_OPS = ["click", "write", "scroll", "wait_for"];
type Tier = "false" | "auto" | "always";
type Page = { docId?: string; live?: boolean; url: string };
type State = { url: string; tier: Tier; plan: Plan };

const pathKey = (p: Path) => p.join("/");
const enc = (s: State) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s: string): State | null => { try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o && o.plan && Array.isArray(o.plan.steps) ? o : null; } catch { return null; } };
const browserKw = (tier: Tier) => (tier === "false" ? {} : { browser: tier === "always" ? true : "auto" });
const fresh = (url: string, tier: Tier = "auto"): State => ({ url, tier, plan: { root: "Reference", steps: call("resolve", [], browserKw(tier)) } });

/** The plan's "governing resolve" for a position: the resolve call whose page the position works
 * on -- the last resolve at or before it in its chain, else (a field chain without one) the
 * parent's. Every page the workspace holds is keyed by its resolve's path; the root's is [0]. */
function governing(plan: Plan, sp: Path | null): Path {
  const cp = sp && sp.length ? sp.slice(0, -1) : []; const idx = sp && sp.length ? (sp[sp.length - 1] as number) : Infinity;
  const cs = calls(planAt(plan, cp));
  for (let i = Math.min(idx, cs.length - 1); i >= 0; i--) if (cs[i]!.name === "resolve") return [...cp, i];
  if (cp.length === 0) return [0];
  return governing(plan, cp.slice(0, -1));  // cp = [..., extractIdx, "kw:name"] -> the extract's position
}

/** THE Author workspace. The plan is the model; the page is a view of it. Click an element:
 * the menu builds its SELECTOR (tag / classes / ancestors as toggles, the live count) and lists
 * the object's own ops, generated from the surface. The SCOPE is always the last object you
 * made (a select_all → the record, a select → that element, a link's resolve → its page) until
 * you click a plan node or press Esc (back to the page). A link opens a new document joined
 * under the same plan. The plan tree is live and edited in place; Run executes it. */
export function Author() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/author");
  const sessionId = useSession();
  const qc = useQueryClient();
  const controller = usePlayerController();
  const opsQ = useQuery({ queryKey: ["ops"], queryFn: api.ops, staleTime: Infinity });

  // -- the model, its history, the URL ---------------------------------------------------
  const [state, setStateRaw] = React.useState<State | null>(() => dec(params.get("p") ?? ""));
  const history = React.useRef<State[]>([]);
  const setState = React.useCallback((fn: (s: State) => State, undoable = true) => setStateRaw((s) => { if (!s) return s; const n = fn(s); if (undoable && n !== s) history.current = [...history.current.slice(-60), s]; return n; }), []);
  const undo = () => { const prev = history.current.pop(); if (prev) { setStateRaw(prev); setScope(null); } };
  const setPlan = (fn: (p: Plan) => Plan, undoable = true) => setState((s) => ({ ...s, plan: fn(s.plan) }), undoable);
  const [pages, setPages] = React.useState<Record<string, Page>>({});
  const [docs, setDocs] = React.useState<Record<string, Document>>({});
  const [scope, setScope] = React.useState<Path | null>(null);
  const [menu, setMenu] = React.useState<{ pick: Pick; at: { x: number; y: number } } | null>(null);
  const [run, setRun] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean; replay?: RREvent[] }>({ busy: false });
  const reset = (s: State | null, keepRoot?: Page) => { setStateRaw(s); history.current = []; setPages(keepRoot ? { "0": keepRoot } : {}); setDocs({}); setScope(null); setMenu(null); setRun({ busy: false }); };
  React.useEffect(() => { if (!active) return; setParams((q) => { const n = new URLSearchParams(q); if (state) n.set("p", enc(state)); else n.delete("p"); n.delete("url"); n.delete("doc"); return n; }, { replace: true }); }, [state, active, setParams]);
  React.useEffect(() => {
    if (!active) return;
    const url = params.get("url"); const doc = params.get("doc"); const tier = (params.get("tier") as Tier) ?? "auto";
    if (url) reset(fresh(url, tier));
    else if (doc && sessionId) api.docs(sessionId).then((ds) => { const h = ds.find((d) => d.id === doc); if (h) reset(fresh(h.url ?? "", h.tier === "browser" ? "always" : "false"), { docId: h.id, live: !!h.live, url: h.url ?? "" }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, params.get("url"), params.get("doc"), sessionId]);
  const plan = state?.plan ?? null;
  const url = state?.url ?? "";
  const tier = state?.tier ?? "auto";

  // -- where am I: the scope, its chain, its page ------------------------------------------
  const scopeChainPath = React.useMemo<Path>(() => (scope && scope.length ? scope.slice(0, -1) : []), [scope]);
  const scopeIdx = scope && scope.length ? (scope[scope.length - 1] as number) : -1;
  const rp = React.useMemo(() => (plan ? governing(plan, scope) : [0]), [plan, scope]);          // the page's resolve
  const pageKey = pathKey(rp);
  const pageChainPath = React.useMemo(() => rp.slice(0, -1), [rp]);
  const pageChain = React.useMemo(() => (plan ? planAt(plan, pageChainPath) : null), [plan, pageChainPath]);
  const pageCalls = React.useMemo(() => (pageChain ? calls(pageChain) : []), [pageChain]);
  const rIdx = rp[rp.length - 1] as number;
  /** the part of the page's chain that runs on this page (after its resolve) */
  const here = React.useMemo<Plan | null>(() => (pageChain ? { root: "Document", steps: pageChain.steps.slice(pageCalls[rIdx + 1]?.index ?? pageChain.steps.length) } : null), [pageChain, pageCalls, rIdx]);
  const page = pages[pageKey];
  const doc = docs[pageKey] ?? null;
  const [tick, setTick] = React.useState(0);

  /** the url a resolve's page opens: the root url, or the href its chain reads off the page before it */
  const pageUrlOf = React.useCallback((r: Path): string | null => {
    if (!plan || !state) return null;
    if (r.length === 1 && r[0] === 0) return state.url;
    const cp = r.slice(0, -1); const ri = r[r.length - 1] as number; const chain = planAt(plan, cp); const cs = calls(chain);
    let prev = -1; for (let i = ri - 1; i >= 0; i--) if (cs[i]!.name === "resolve") { prev = i; break; }
    let base: Element | null = null; let baseUrl = state.url; let start = 0;
    if (prev >= 0) { const pk = pathKey([...cp, prev]); const d = docs[pk]; if (!d) return null; base = d.body; baseUrl = pages[pk]?.url ?? baseUrl; start = cs[prev + 1]?.index ?? chain.steps.length; }
    else if (cp.length >= 2) {  // a field chain: the base is the parent's record (or its page)
      const parentPath = cp.slice(0, -2); const exI = cp[cp.length - 2] as number; const prp = governing(plan, [...parentPath, exI]); const pk = pathKey(prp); const d = docs[pk]; if (!d) return null;
      baseUrl = pages[pk]?.url ?? baseUrl; const pcs = calls(planAt(plan, parentPath)); let rec: planLib.Call | null = null; for (let j = exI - 1; j >= 0; j--) if (pcs[j]!.name === "select_all") { rec = pcs[j]!; break; }
      try { base = rec ? d.querySelector(String(v(rec.args[0]))) : d.body; } catch { base = null; }
    } else return null;
    if (!base) return null;
    const href = evalLocal({ root: "Document", steps: chain.steps.slice(start, cs[ri]!.index) }, base);
    if (typeof href !== "string" || !href) return null;
    try { return new URL(href, baseUrl).toString(); } catch { return href; }
  }, [plan, state, docs, pages]);

  /** the element a plan position stands for (the first of a collection), evaluated locally */
  const objectAt = React.useCallback((sp: Path): { el: Element | null; kind: "document" | "collection" | "element" | "value"; count?: number } | null => {
    if (!plan) return null;
    const cp = sp.slice(0, -1); const i = sp[sp.length - 1] as number; const chain = planAt(plan, cp); const cs = calls(chain);
    const r = governing(plan, sp); const d = docs[pathKey(r)]; if (!d) return null;
    let base: Element | null; let start: number;
    if (pathKey(r.slice(0, -1)) === pathKey(cp)) { const ri = r[r.length - 1] as number; if (i <= ri) return { el: d.body, kind: "document" }; start = cs[ri + 1]?.index ?? chain.steps.length; base = d.body; }
    else { const parentPath = cp.slice(0, -2); const exI = cp[cp.length - 2] as number; const pcs = calls(planAt(plan, parentPath)); let rec: planLib.Call | null = null; for (let j = exI - 1; j >= 0; j--) if (pcs[j]!.name === "select_all") { rec = pcs[j]!; break; } try { base = rec ? d.querySelector(String(v(rec.args[0]))) : d.body; } catch { base = null; } start = 0; }
    if (!base) return null;
    const out = evalLocal({ root: "Document", steps: chain.steps.slice(start, cs[i + 1]?.index ?? chain.steps.length) }, base);
    if (Array.isArray(out)) return { el: out[0] instanceof Element ? out[0] : null, kind: "collection", count: out.length };
    if (out instanceof Element) return { el: out, kind: "element" };
    return { el: null, kind: "value" };
  }, [plan, docs]);
  /** the scope as an object: the last select / select_all at or before the scope in its chain */
  const scopeObj = React.useMemo(() => {
    if (!plan || scopeIdx < 0) return null;
    const cs = calls(planAt(plan, scopeChainPath)); const sameChain = pathKey(pageChainPath) === pathKey(scopeChainPath);
    for (let j = scopeIdx; j >= 0; j--) { const c = cs[j]!; if (sameChain && j <= rIdx) break; if (c.name === "select" || c.name === "select_all") { const o = objectAt([...scopeChainPath, j]); return o ? { ...o, selector: String(v(c.args[0])), name: c.name } : null; } }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, scope, scopeIdx, scopeChainPath, pageChainPath, rIdx, objectAt, tick]);
  const scopeLabel = scopeObj ? (scopeObj.name === "select_all" ? `each ${scopeObj.selector}` : `the ${scopeObj.selector}`) : "the page";

  // -- the pages: each resolve's document in the session ---------------------------------
  const [openError, setOpenError] = React.useState<ApiError | null>(null);
  React.useEffect(() => {
    if (!active || !sessionId || !state || page?.docId) return;
    const want = page?.url ?? pageUrlOf(rp); if (!want) return;
    let on = true;
    api.docOpen(sessionId, { url: want, browser: tier === "false" ? false : tier === "auto" ? "auto" : "always", live: false })
      .then((h) => { if (on) { setPages((ps) => ({ ...ps, [pageKey]: { docId: h.id, live: !!h.live, url: want } })); setOpenError(null); qc.invalidateQueries({ queryKey: ["session-docs"] }); } })
      .catch((e) => { if (on) setOpenError(e as ApiError); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId, state?.url, tier, pageKey, page?.docId, page?.url, docs]);
  const views = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "author"], queryFn: () => api.docViews(sessionId!, page!.docId!, VIEWS), enabled: !!sessionId && !!page?.docId, staleTime: Infinity, retry: false });
  React.useEffect(() => { const e = views.error as ApiError | null; if (e && e.status === 404) setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? url } })); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.error]);
  const more = useQuery({ queryKey: ["doc-views", sessionId, page?.docId, "more"], queryFn: () => api.docViews(sessionId!, page!.docId!, ["skeleton", "markdown", "elements"]), enabled: !!sessionId && !!page?.docId && views.isSuccess, staleTime: Infinity });
  const reload = async () => { if (!sessionId || !page?.docId) return; await api.docReload(sessionId, page.docId); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, page.docId] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); setStream([]); since.current = 0; };
  const [draft, setDraft] = React.useState(url);
  React.useEffect(() => { if (url) setDraft(url); }, [url]);
  const start = (e?: React.FormEvent) => { e?.preventDefault(); if (!draft) return; setOpenError(null); reset(fresh(draft, tier)); };
  const setTier = (t: Tier) => { if (!state) return; if (page?.docId && sessionId) api.docClose(sessionId, page.docId).catch(() => undefined); setState((s) => ({ ...s, tier: t, plan: updateCall(s.plan, [], 0, (c) => (c.name === "resolve" ? { ...c, kwargs: t === "false" ? {} : { browser: { value: t === "always" ? true : "auto" } } } : c)) })); setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? url } })); };

  // -- live: the page held open; actions run on it and stream back ------------------------
  const [stream, setStream] = React.useState<RREvent[]>([]);
  const since = React.useRef(0);
  const goLive = async (): Promise<string | null> => {
    if (!sessionId || !state) return null;
    const want = page?.url ?? pageUrlOf(rp); if (!want) return null;
    for (const [k, pg] of Object.entries(pages)) if (pg.live && k !== pageKey && pg.docId) { api.docClose(sessionId, pg.docId).catch(() => undefined); setPages((ps) => ({ ...ps, [k]: { url: pg.url } })); }  // one live page
    if (page?.docId) api.docClose(sessionId, page.docId).catch(() => undefined);
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
  /** where a page-level op (an action, the pager) goes in the page's chain: after its resolve and the actions there, before the data ops */
  const pageInsertAt = (p: Plan, r: Path) => { const cs = calls(planAt(p, r.slice(0, -1))); const ri = r[r.length - 1] as number; let at = ri + 1; for (let i = ri + 1; i < cs.length; i++) { if (DATA_OPS.includes(cs[i]!.name) || cs[i]!.name === "paginate") break; at = i + 1; } return at; };
  const act = async (op: MenuOp) => {
    if (!sessionId || !state) return;
    let docId = page?.live ? page.docId : null;
    if (!docId) docId = await goLive();
    if (!docId) return;
    const args = op.name === "write" ? [op.selector, String(op.args[1] ?? "")] : op.name === "scroll" && !op.selector ? [] : [op.selector];
    setBusy(op.name); setActError(null);
    try {
      await api.executeDoc({ plan: planBody("Document", [callBody(op.name, args)], sessionId), document_id: docId });
      if (op.record !== false) setPlan((p) => insertCalls(p, pageChainPath, call(op.name, args), pageInsertAt(p, rp)));
      qc.invalidateQueries({ queryKey: ["doc-views", sessionId, docId] });
    } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };

  // -- patterns: the page's groups, each its own colour, highlightable ----------------------
  const [showGroups, setShowGroups] = React.useState(false);
  const patternGroups = React.useMemo(() => {
    const out: { name: string; selector: string; count: number; colour: string; why: string }[] = [];
    for (const h of views.data?.patterns ?? []) if (h.subject && !out.some((o) => o.selector === h.subject)) out.push({ name: h.name.replace(/_/g, " "), selector: h.subject, count: h.count ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: `pattern · ${Math.round((h.confidence ?? 0) * 100)}%` });
    for (const r of views.data?.records ?? []) if (!out.some((o) => o.selector === r.selector)) out.push({ name: r.name || "repeating", selector: r.selector, count: r.repeats ?? 0, colour: GROUP_HUES[out.length % GROUP_HUES.length]!, why: "repeating region" });
    return out.slice(0, 8);
  }, [views.data]);

  // -- picking: the menu, then a plan edit at the scope ---------------------------------------
  const [hover, setHover] = React.useState<Pick | null>(null);
  const onPick = (p: Pick, at: { x: number; y: number }) => setMenu({ pick: p, at });
  React.useEffect(() => {  // Esc: the scope goes back to the page (the menu handles its own Esc first)
    const h = (e: KeyboardEvent) => { if (!active) return; if ((e.metaKey || e.ctrlKey) && e.key === "z" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); undo(); } else if (e.key === "Escape" && !menu) setScope(null); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, menu]);
  const menuGroups = React.useMemo(() => { const el = menu?.pick.el; if (!el) return []; return patternGroups.filter((g) => { try { return !!el.closest(g.selector); } catch { return false; } }).map((g) => ({ name: g.name, colour: g.colour, count: g.count })); }, [menu, patternGroups]);
  const sh = React.useMemo(() => (here ? shape(here) : { fields: [], actions: [] }), [here]);
  const onOp = async (op: MenuOp) => {
    if (!state || !plan) return; setMenu(null);
    if (ACTION_OPS.includes(op.name)) { await act(op); return; }
    if (op.name === "paginate") {
      const kw: Record<string, unknown> = { max_pages: 5, ...op.kwargs }; const rec = sh.record; if (rec && kw.by === "click") kw.records = rec;
      setPlan((p) => { const cs = calls(planAt(p, pageChainPath)); const old = cs.findIndex((c, i) => i > rIdx && c.name === "paginate"); const base = old >= 0 ? removeCall(p, pageChainPath, old) : p; return insertCalls(base, pageChainPath, call("paginate", [], kw), pageInsertAt(base, rp)); });
      if (kw.by === "click" && !page?.live) await goLive();
      return;
    }
    // the steps the op means on the clicked element (select first, unless the op IS the selection)
    const pick = op.selector ? call("select", [op.selector]) : [];
    const sub: planLib.Step[] = op.name === "select" || op.name === "select_all" ? call(op.name, [op.selector])
      : op.name === "attr" ? [...pick, ...call("attr", op.args)]
      : op.name === "resolve" ? [...pick, ...call("attr", ["href"]), ...call("resolve", [], browserKw(tier))]
      : [...pick, ...call(op.name, op.args, op.kwargs)];
    const n = calls({ root: "Document", steps: sub }).length;
    const cs = calls(planAt(plan, scopeChainPath));
    const sCall = scopeIdx >= 0 ? cs[scopeIdx] : null;
    const recIdx = sCall ? (sCall.name === "select_all" ? scopeIdx : ["extract", "project"].includes(sCall.name) ? cs.slice(0, scopeIdx).map((c) => c.name).lastIndexOf("select_all") : -1) : -1;
    if (recIdx >= 0) {  // a collection scope: the op becomes a FIELD of the record's extract
      const name = uniqueName(op.field || op.name, Object.keys(cs.find((c, i) => i > recIdx && c.name === "extract")?.kwargs ?? {}));
      let next = plan; let exI = cs.findIndex((c, i) => i > recIdx && c.name === "extract");
      if (exI < 0) { next = insertCalls(next, scopeChainPath, [{ kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: {} }], recIdx + 1); exI = recIdx + 1; if (!cs.some((c) => c.name === "project")) next = insertCalls(next, scopeChainPath, call("project")); }
      next = updateCall(next, scopeChainPath, exI, (c) => ({ ...c, kwargs: { ...c.kwargs, [name]: { plan: { root: "Document", steps: sub } } } }));
      setPlan(() => next); setScope([...scopeChainPath, exI, `kw:${name}`, n - 1]);
      return;
    }
    // a document / element scope: the steps append after the scope (at the page level: before its data ops)
    const at = sCall ? scopeIdx + 1 : pageInsertAt(plan, rp);
    const cp = sCall ? scopeChainPath : pageChainPath;
    setPlan((p) => insertCalls(p, cp, sub, at));
    setScope([...cp, at + n - 1]);
  };

  // -- rows (local), counts, highlights ----------------------------------------------------
  const local = React.useMemo(() => (here && doc ? localRows(here, doc) : { rows: [], count: 0 }), [here, doc, tick]);
  const allCounts = React.useRef<Record<string, Record<string, number | string>>>({});
  const counts = React.useMemo(() => {
    const mine: Record<string, number | string> = {};
    if (doc) pageCalls.forEach((c, i) => { if (i > rIdx && (c.name === "select_all" || c.name === "select")) { try { mine[pathKey([...pageChainPath, i])] = doc.querySelectorAll(String(v(c.args[0]))).length; } catch { /* bad */ } } });
    allCounts.current = { ...allCounts.current, [pageKey]: mine };
    return Object.assign({}, ...Object.values(allCounts.current)) as Record<string, number | string>;
  }, [pageCalls, pageChainPath, doc, tick, pageKey, rIdx]);
  const record = sh.record ?? "";
  const highlights: Highlight[] = [
    ...(record ? [{ selector: record, label: "each", tone: "accent" as const }] : []),
    ...sh.fields.filter((f) => f.selector).map((f, i) => ({ selector: record ? `${record} ${f.selector}` : f.selector!, label: f.name, colour: fieldColour(i) })),
    ...(scopeObj?.el && scopeObj.kind === "element" && scopeObj.el !== doc?.body ? [{ selector: scopeObj.selector, label: "scope", tone: "ok" as const }] : []),
    ...(showGroups ? patternGroups.map((g) => ({ selector: g.selector, label: g.name, colour: g.colour, dashed: true })) : []),
  ];
  const flags = views.data?.flags ?? [];
  const usedClass = (c: string, h: Pick) => [record, ...sh.fields.map((f) => f.selector ?? "")].some((s) => s.split(/[\s>]+/).some((part) => part.startsWith(h.tag) && part.includes(`.${c}`)));

  // -- the plan on the server: describe / blob; run; save / export / import ------------------
  const [tab, setTab] = React.useState("rows");
  const planQ = useQuery({ queryKey: ["plan", plan ? JSON.stringify(plan) : ""], queryFn: () => api.plan({ plan: { ...plan!, session_id: sessionId } }), enabled: !!plan && calls(plan).length > 1 });
  const runServer = async () => {
    if (!plan || !state) return; setRun({ busy: true }); setTab("server"); const t0 = performance.now();
    const cursor = (await api.history({ since: 0 }).catch(() => [])).reduce((m, e) => Math.max(m, e.n ?? 0), 0);
    try {
      const out = await api.execute({ plan: { ...plan, session_id: sessionId }, url: state.url });
      const evs = await api.history({ since: cursor }).catch(() => []);
      const customs: RREvent[] = evs.filter((e) => !["rrweb", "snapshot", "trace"].includes(e.topic)).map((e) => { const { events: _d, content: _c, body: _b, ...payload } = e as any; return { type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? 0) * 1000) }; });
      const rootDoc = pages["0"]?.docId; const base = ((rootDoc ? qc.getQueryData<{ rrweb?: RREvent[] }>(["doc-views", sessionId, rootDoc, "author"])?.rrweb : views.data?.rrweb) ?? []) as RREvent[]; const t = customs[0]?.timestamp ?? Date.now();
      setRun({ rows: (Array.isArray(out.rows) ? out.rows : out.rows && typeof out.rows === "object" ? [out.rows as Record<string, unknown>] : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false, replay: base.length ? [{ ...base[0]!, timestamp: t - 2 }, { ...base[1]!, timestamp: t - 1 }, ...customs] : [] });
    } catch (e) { setRun({ error: e as ApiError, busy: false }); }
  };
  const saved = useQuery({ queryKey: ["saved-plans"], queryFn: () => { try { return JSON.parse(localStorage.getItem("wc.plans") ?? "[]") as { name: string; url: string; plan: Plan; tier: Tier; at: number }[]; } catch { return []; } }, staleTime: 0 });
  const save = () => { if (!state) return; const name = window.prompt("save as", views.data?.title ?? state.url); if (!name) return; const list = (saved.data ?? []).filter((x) => x.name !== name); list.unshift({ name, url: state.url, plan: state.plan, tier: state.tier, at: Date.now() }); localStorage.setItem("wc.plans", JSON.stringify(list.slice(0, 50))); qc.invalidateQueries({ queryKey: ["saved-plans"] }); };
  const load = (name: string) => { const x = (saved.data ?? []).find((s) => s.name === name); if (x) reset({ url: x.url, tier: x.tier, plan: x.plan }); };
  const exportPlan = () => { if (!state) return; const blob = new Blob([JSON.stringify({ url: state.url, tier: state.tier, plan: state.plan, blob: planQ.data?.blob, describe: planQ.data?.describe }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(views.data?.title ?? "plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.plan.json`; a.click(); URL.revokeObjectURL(a.href); };
  const importPlan = async () => { const text = window.prompt("paste a plan blob, or an exported plan's JSON"); if (!text) return; try { const o = JSON.parse(text); if (o.plan && o.url) reset({ url: o.url, tier: o.tier ?? "auto", plan: o.plan }); else { const got = await api.plan({ blob: text }); const src = (got.plan as any)?.source; reset({ url: src?.url ?? url ?? "", tier: "auto", plan: { root: (got.plan as any).root, steps: (got.plan as any).steps } }); } } catch (e) { window.alert(`not a plan: ${(e as Error).message}`); } };

  const playerEvents = page?.live ? stream : run.replay && tab === "server" ? run.replay : ((views.data?.rrweb ?? []) as RREvent[]);
  const err = openError ?? (views.error as ApiError | null);
  const onDocument = (d: Document) => { setDocs((ds) => (ds[pageKey] === d ? ds : { ...ds, [pageKey]: d })); setTick((t) => t + 1); };
  const card = views.data?.card;
  const timing = card ? ((card as unknown as { timing?: Record<string, number> }).timing ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form onSubmit={start} className="flex min-w-[280px] flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="the page to scrape (a listing, a search, a login…)" className="w-full" /></ToolbarGroup>
          <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)} title="the transport tier; changing it re-opens the page"><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId}>{state ? "Open" : "Start"}</Button>
          {page?.docId && <Button size="sm" variant="ghost" onClick={reload} title="reload the page">⟳</Button>}
          {state && !page?.live && <Button size="sm" variant="ghost" onClick={goLive} title="hold the page open in a browser so actions run on it">go live</Button>}
        </form>
        <ToolbarSpacer />
        {page?.live && <Chip tone="ok" dot>live page</Chip>}
        {history.current.length > 0 && <Button size="sm" variant="ghost" onClick={undo} title="undo (⌘Z)">undo</Button>}
        {state && <><Button size="sm" variant="secondary" onClick={save}>Save</Button><Button size="sm" variant="secondary" onClick={exportPlan}>Export</Button></>}
        <Button size="sm" variant="ghost" onClick={importPlan}>Import</Button>
        {saved.data && saved.data.length > 0 && <Select value="" onChange={(e) => { if (e.target.value) load(e.target.value); }}><option value="">— saved plans —</option>{saved.data.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</Select>}
        {plan && calls(plan).length > 1 && <Button variant="primary" size="sm" onClick={runServer} disabled={run.busy}>{run.busy ? "running…" : "Run ▶"}</Button>}
      </Toolbar>
      {/* ONE line, fixed height: the readout -- nothing here may reflow the page */}
      <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-line px-3 text-[12px]">
        <span className="text-muted">scope:</span>
        <Chip tone={scopeObj ? "accent" : "neutral"} interactive onClick={() => setScope(null)} title="the last object you made; Esc or click here for the page">{scopeLabel}{pageKey !== "0" ? " · a followed page" : ""}</Chip>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {hover ? <>{hover.tag}{hover.id ? `#${hover.id}` : ""}{hover.classes.map((c) => <span key={c} className={usedClass(c, hover) ? "rounded bg-accent-soft px-0.5 text-accent" : ""}>.{c}</span>)}{hover.text ? <span className="text-ink"> “{hover.text.slice(0, 48)}”</span> : null}</>
            : state ? <>{views.data?.title ?? "…"} <span className="opacity-70">{page?.url ?? url}</span> · click an element for its menu</> : "paste a URL to start"}
        </span>
        {patternGroups.length > 0 && <Chip tone={showGroups ? "accent" : "neutral"} interactive onClick={() => setShowGroups(!showGroups)} title="outline the detected groups on the page">{patternGroups.length} groups</Chip>}
        {card && <Chip tone="neutral">{card.kind} · {card.status_code} · {page?.live ? "live" : views.data?.tiers?.slice(-1)[0] ?? "static"}</Chip>}
      </div>
      {!state ? <EmptyState title="Start with the page you want data from" hint="Hover anything and click it: the menu builds the selector (toggle tag / classes / ancestors) and lists the object's own ops -- select_all, select, click, read a field, open a link into a new document, walk the pages. The scope is always the last thing you made; Esc returns to the page. The plan builds live on the right and is yours to edit." /> :
       err && !views.data ? <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={<>{err.hint ?? err.message}{err.remedy && <> — remedy: <b>{err.remedy}</b></>}</>}
         action={err.remedy === "browser" ? <Button variant="primary" onClick={() => setTier("always")}>Open with a browser</Button> : err.code === "pool.exhausted" && sessionId ? <Button variant="primary" onClick={async () => { await api.sessionRelease(sessionId); setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? url } })); }}>Release my live pages and retry</Button> : <Button onClick={() => setPages((ps) => ({ ...ps, [pageKey]: { url: ps[pageKey]?.url ?? url } }))}>Retry</Button>} /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,1fr)]">
        <div className="relative min-w-0">
          {playerEvents.length >= 2 || page?.live ? <Player events={playerEvents} live={!!page?.live} highlights={highlights} pickable onPick={onPick} onHover={setHover} onDocument={onDocument} controls={false} controller={controller} autoPlay={!!run.replay && tab === "server"} maxHeight={780} />
            : <EmptyState title={views.isFetching || !page?.docId ? "Opening the page into your session…" : "Not an HTML page"} />}
          {menu && <ElementMenu pick={menu.pick} at={{ x: Math.min(menu.at.x, 560), y: menu.at.y + 8 }} scope={{ el: scopeObj?.el && scopeObj.el !== doc?.body ? scopeObj.el : null, selector: scopeObj?.selector, label: scopeLabel }} ops={opsQ.data?.Document ?? []} groups={menuGroups} taken={sh.fields.map((f) => f.name)} live={!!page?.live} onOp={onOp} onClose={() => setMenu(null)} />}
          {showGroups && patternGroups.length > 0 && <div className="mt-1 flex flex-wrap gap-1 text-[10px]">{patternGroups.map((g) => <span key={g.selector} className="inline-flex items-center gap-1 rounded border border-line px-1" title={g.why}><span className="inline-block size-2 rounded-sm" style={{ background: g.colour }} />{g.name} · <code className="font-mono">{g.selector}</code> ×{g.count}</span>)}</div>}
          {actError && <div className="mt-1 text-[12px]"><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</div>}
          {busy && <div className="mt-1 text-[12px] text-muted">{busy}…</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-line p-2">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">The plan — live, editable <span className="flex-1" />{planQ.data && <span className="truncate font-mono text-[10px] normal-case text-muted" title={planQ.data.describe}>{planQ.data.describe.slice(0, 60)}…</span>}</div>
            <PlanView plan={plan!} url={url} onChange={(p) => setPlan(() => p)} selected={scope ?? []} onSelect={(p) => setScope(p.length ? p : null)} onOpen={(fp) => { const cs = calls(planAt(plan!, fp)); const r = cs.findIndex((c) => c.name === "resolve"); setScope([...fp, r < 0 ? 0 : r]); }} counts={counts} className="max-h-[340px] overflow-auto" />
          </section>
          {/* the page: what the client found -- the card, the signals, the patterns */}
          <section data-panel="page" className="rounded-lg border border-line p-2 text-[12px]">
            <div className="mb-1 flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">The page</span>
              {card && <><Chip tone="neutral">{card.kind}</Chip><Chip tone={card.status_code && card.status_code < 400 ? "ok" : "bad"}>{card.status_code}</Chip><Chip tone="neutral" title="the transport tiers walked">{(views.data?.tiers ?? [card.final_tier]).join(" → ")}</Chip>{timing && <Chip tone="neutral">{Object.entries(timing).map(([k, ms]) => `${k} ${Math.round(ms)}ms`).join(" · ")}</Chip>}</>}
              {views.data?.title && <span className="truncate text-muted" title={views.data.url}>{views.data.title}</span>}
            </div>
            {card?.description && <div className="mb-1 truncate text-[11px] text-muted" title={card.description}>{card.description}</div>}
            <FlagRow flags={flags} empty="no signals on this page" />
            {patternGroups.length > 0 && <div className="mt-1 flex flex-wrap gap-1 text-[10px]">{patternGroups.map((g) => <button key={g.selector} type="button" className="inline-flex items-center gap-1 rounded border border-line px-1 hover:bg-surface-2" title={`${g.why} — click to outline`} onClick={() => setShowGroups(true)}><span className="inline-block size-2 rounded-sm" style={{ background: g.colour }} />{g.name} <code className="font-mono">{g.selector}</code> ×{g.count}</button>)}</div>}
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "rows", label: "Rows", count: local.rows.length }, { value: "server", label: "Server run", count: run.rows?.length }, { value: "skeleton", label: "Skeleton" }, { value: "markdown", label: "Markdown" }, { value: "elements", label: "Elements", count: more.data?.elements?.length ?? views.data?.controls?.length }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="rows">{!sh.fields.length && !local.rows.length ? <EmptyState title={record ? "Read a field: click a value inside a record" : "Click a repeating element and choose select_all"} hint="Rows fill here as you pick; nothing is fetched until you run." /> : <DataFrame rows={local.rows} columns={sh.fields.length ? sh.fields.map((f) => f.name) : undefined} colours={sh.fields.map((_, i) => fieldColour(i))} className="max-h-[360px]" emptyHint="The record selector matched nothing in this page." />}</TabPanel>
              <TabPanel value="server">{run.error ? <div className="p-3 text-[12px]"><Chip tone="bad">{run.error.detail?.code ?? run.error.status}</Chip> {run.error.detail?.hint ?? run.error.message}{run.error.detail?.remedy && <div>remedy: <b>{run.error.detail.remedy}</b></div>}</div>
                : run.rows ? <><div className="px-2 pt-1 text-[11px] text-muted">{run.rows.length} rows from the server in {run.ms} ms · the run replays in the page</div><DataFrame rows={run.rows} className="max-h-[340px]" /></>
                : <EmptyState title="Not run yet" hint="Run ▶ executes this exact plan through your session." />}</TabPanel>
              <TabPanel value="skeleton" className="max-h-[420px] overflow-auto p-2">{more.data?.skeleton ? <SkeletonPane skeleton={more.data.skeleton} active={hover ? "<" + hover.tag : null} /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="markdown" className="max-h-[420px] overflow-auto p-2">{more.data?.markdown ? <CodeBlock lang="markdown" code={more.data.markdown} wrap /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="elements" className="max-h-[420px] overflow-auto">{(more.data?.elements ?? views.data?.controls) && <ElementTable elements={more.data?.elements ?? views.data!.controls!} />}</TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("extract", { url, result: record, fields: Object.fromEntries(sh.fields.filter((f) => f.selector).map((f) => [f.name, f.selector])) }, API_URL)} blob={planQ.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(planQ.data?.blob ?? "<the blob appears once the plan has a step>")}, wc).collect()`} /><CodeBlock lang="describe" code={plan ? describePlan(plan) : ""} className="m-2" wrap /></TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
      {(page?.live || (run.replay && tab === "server")) && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

function uniqueName(base: string, taken: string[]): string {
  const b = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
  if (!taken.includes(b)) return b;
  let i = 2; while (taken.includes(`${b}_${i}`)) i++; return `${b}_${i}`;
}

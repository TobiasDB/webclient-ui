import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, ElementTable, EmptyState, FlagRow, Input, MediaBar, Player, Select, SkeletonPane, StageGraph,
  TabPanel, Tabs, Toolbar, ToolbarGroup, ToolbarSpacer, describe, fieldColour, toolAsCode, usePlayerController, type Highlight, type Pick, type RREvent,
} from "@webclient/ui";
import { API_URL, api, ApiError, type DocViews } from "../lib/api";
import { call, plan as planBody, useActive, useSession } from "../lib/session";
import {
  absolute, activeStage, bestRecordSelector, childrenOf, columnName, decode, empty, encode, fromUrl, fullPlan, newId, project, relativeSelector, rootStage,
  type Author as Model, type Column, type Mode, type Source, type Stage, type Step, type Tier,
} from "../lib/author";

const VIEWS = ["card", "rrweb", "patterns", "records", "flags", "controls"];

/** THE Author workspace (docs/product/author-workspace.md): one page, one plan, three
 * modes. look = what is this page (flags, the record list, the controls); pick = the
 * record and the fields, rows filling locally; drive = act on the LIVE page, every action
 * recorded as a step (undo). Stages are the plan's pages: the listing, the detail pages
 * followed from a link field (rows nest). The model rides in the URL; the plan is derived. */
export function Author() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/author");
  const sessionId = useSession();
  const qc = useQueryClient();
  const controller = usePlayerController();
  // -- the model, its history (undo), and the URL ------------------------------------
  const [model, setModelRaw] = React.useState<Model>(() => decode(params.get("a") ?? "") ?? empty());
  const history = React.useRef<Model[]>([]);
  const setModel = React.useCallback((fn: (m: Model) => Model, undoable = true) => setModelRaw((m) => { const n = fn(m); if (undoable && n !== m) { history.current = [...history.current.slice(-40), m]; } return n; }), []);
  const undo = () => { const prev = history.current.pop(); if (prev) setModelRaw(prev); };
  React.useEffect(() => { if (!active) return; const a = params.get("a"); if (a && a !== encode(model)) { const m = decode(a); if (m) setModelRaw(m); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, params]);
  React.useEffect(() => { if (!active) return; setParams((p) => { const n = new URLSearchParams(p); if (model.stages.length) n.set("a", encode(model)); else n.delete("a"); n.delete("url"); n.delete("doc"); return n; }, { replace: true }); }, [model, active, setParams]);
  // a ?url= / ?doc= entry (from Home, the strip, a link) becomes a listing stage
  React.useEffect(() => {
    if (!active) return;
    const url = params.get("url"); const doc = params.get("doc"); const tier = (params.get("tier") as Tier) ?? "auto";
    if (url) { setModelRaw(fromUrl(url, tier)); history.current = []; }
    else if (doc && sessionId) { api.docs(sessionId).then((ds) => { const h = ds.find((d) => d.id === doc); if (h) { const m = fromUrl(h.url ?? "", (h.tier === "browser" ? "always" : "false") as Tier); m.stages[0]!.docId = h.id; m.stages[0]!.live = !!h.live; if (h.live) m.mode = "drive"; setModelRaw(m); history.current = []; } }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, params.get("url"), params.get("doc"), sessionId]);
  React.useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "z" && active) { e.preventDefault(); undo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [active]);

  const stage = activeStage(model);
  const root = rootStage(model);
  const mode = model.mode;
  const setMode = (m: Mode) => setModel((x) => ({ ...x, mode: m }), false);
  const patchStage = (id: string, patch: Partial<Stage>, undoable = true) => setModel((x) => ({ ...x, stages: x.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), undoable);
  const [draft, setDraft] = React.useState(stage?.url ?? "");
  React.useEffect(() => { if (stage?.url) setDraft(stage.url); }, [stage?.url]);
  const [openError, setOpenError] = React.useState<ApiError | null>(null);

  // -- the stage's document in the session: opened once, reused, reloadable ----------
  React.useEffect(() => {
    if (!active || !sessionId || !stage || stage.docId) return;
    let on = true;
    const wantLive = mode === "drive";
    api.docOpen(sessionId, { url: stage.url, browser: stage.tier === "false" && !wantLive ? false : stage.tier === "auto" && !wantLive ? "auto" : "always", live: wantLive })
      .then((h) => { if (on) { patchStage(stage.id, { docId: h.id, live: !!h.live }, false); setOpenError(null); } })
      .catch((e) => { if (on) setOpenError(e as ApiError); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId, stage?.id, stage?.docId, stage?.url, stage?.tier]);
  const views = useQuery({ queryKey: ["doc-views", sessionId, stage?.docId, "author"], queryFn: () => api.docViews(sessionId!, stage!.docId!, VIEWS), enabled: !!sessionId && !!stage?.docId, staleTime: Infinity, retry: false });
  React.useEffect(() => { // a handle the session no longer has (a restart, a close): open it again
    const e = views.error as ApiError | null; if (e && e.status === 404 && stage) patchStage(stage.id, { docId: undefined, live: false }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.error]);
  const more = useQuery({ queryKey: ["doc-views", sessionId, stage?.docId, "more"], queryFn: () => api.docViews(sessionId!, stage!.docId!, ["skeleton", "markdown"]), enabled: !!sessionId && !!stage?.docId && views.isSuccess, staleTime: Infinity });
  const reload = async () => { if (!sessionId || !stage?.docId) return; await api.docReload(sessionId, stage.docId); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, stage.docId] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); setStream([]); since.current = 0; };
  const open = (e?: React.FormEvent) => { e?.preventDefault(); if (!draft) return; setOpenError(null); if (!stage) { setModel(() => fromUrl(draft)); } else if (stage.url !== draft) { setModel(() => fromUrl(draft, stage.tier)); } };
  const setTier = async (t: Tier) => { if (!stage) return; if (stage.docId && sessionId) api.docClose(sessionId, stage.docId).catch(() => undefined); patchStage(stage.id, { tier: t, docId: undefined, live: false }); };

  // -- drive: the live page and its stream ---------------------------------------------
  const [stream, setStream] = React.useState<RREvent[]>([]);
  const since = React.useRef(0);
  const goLive = async () => {
    if (!sessionId || !stage) return;
    // only the active drive stage holds a page (Q4): release any other live stage first
    for (const s of model.stages) if (s.live && s.id !== stage.id && s.docId) { api.docClose(sessionId, s.docId).catch(() => undefined); patchStage(s.id, { docId: undefined, live: false }, false); }
    if (stage.docId) api.docClose(sessionId, stage.docId).catch(() => undefined);
    try { const h = await api.docOpen(sessionId, { url: stage.url, browser: "always", live: true }); patchStage(stage.id, { docId: h.id, live: true }, false); setStream([]); since.current = 0; setMode("drive"); }
    catch (e) { setOpenError(e as ApiError); }
  };
  React.useEffect(() => {
    if (!stage?.live || !stage.docId || mode !== "drive") return;
    let on = true; const docId = stage.docId;
    const pull = async () => {
      try {
        const evs = await api.history({ since: since.current, document_id: docId, payload: true });
        if (!on || !evs.length) return;
        since.current = Math.max(since.current, ...evs.map((c) => c.n ?? 0));
        const out: RREvent[] = [];
        for (const e of evs) { if (e.topic === "rrweb") out.push(...((e.events ?? []) as RREvent[])); else if (e.topic !== "snapshot") { const { events: _d, content: _c, body: _b, ...payload } = e as any; out.push({ type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? Date.now() / 1000) * 1000) }); } }
        setStream((s) => [...s, ...out]);
      } catch { /* next tick */ }
    };
    pull(); const t = setInterval(pull, 700); return () => { on = false; clearInterval(t); };
  }, [stage?.live, stage?.docId, mode]);
  const [action, setAction] = React.useState<Step["op"]>("click");
  const [selector, setSelector] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actError, setActError] = React.useState<ApiError | null>(null);
  const act = async (step: Step) => {
    if (!sessionId || !stage?.docId || !stage.live) return;
    const steps = step.op === "click" ? call("click", [step.selector]) : step.op === "write" ? call("write", [step.selector, step.text ?? ""]) : step.op === "scroll" ? call("scroll", step.selector ? [step.selector] : []) : step.op === "wait_for" ? call("wait_for", [step.selector]) : call("goto", [step.url]);
    setBusy(step.op); setActError(null);
    try {
      const h = await api.executeDoc({ plan: planBody("Document", [steps], sessionId), document_id: stage.docId });
      patchStage(stage.id, { steps: [...stage.steps, step], ...(step.op === "goto" && h.url ? { url: h.url } : {}) });  // recorded automatically; undo removes it
      qc.invalidateQueries({ queryKey: ["doc-views", sessionId, stage.docId] });
    } catch (e) { setActError(e as ApiError); } finally { setBusy(null); }
  };
  const controls = useQuery({ queryKey: ["controls", stage?.docId, stage?.steps.length], enabled: !!sessionId && !!stage?.docId && mode !== "pick",
    queryFn: async () => stage!.live ? (((await api.execute({ plan: planBody("Document", [call("controls")], sessionId), document_id: stage!.docId! })).rows as any[]) ?? []).map((m) => m.data ?? m) : views.data?.controls ?? [] });

  // -- pick: local evaluation in the rebuilt page --------------------------------------
  const [doc, setDoc] = React.useState<Document | null>(null);
  const [tick, setTick] = React.useState(0);
  const [pickFor, setPickFor] = React.useState<"record" | "column">("record");
  const [hover, setHover] = React.useState<Pick | null>(null);
  const record = stage?.record ?? "";
  const columns = stage?.columns ?? [];
  const suggestions = React.useMemo(() => {
    const out: { selector: string; count: number; why: string; confidence?: number }[] = [];
    for (const h of views.data?.patterns ?? []) if (h.name === "record_list") out.push({ selector: h.subject, count: h.count ?? 0, why: "pattern", confidence: h.confidence });
    for (const r of views.data?.records ?? []) if (!out.some((o) => o.selector === r.selector)) out.push({ selector: r.selector, count: r.repeats ?? 0, why: "repeating region" });
    return out;
  }, [views.data]);
  const recordEls = React.useMemo(() => { if (!doc || !record) return []; try { return [...doc.querySelectorAll(record)]; } catch { return []; } }, [doc, record, tick]);
  const recordInfo = React.useMemo(() => recordEls[0] ? describe(recordEls[0]) : null, [recordEls]);
  const fieldRoot = recordEls[0] ?? (record ? null : doc?.body ?? null); // a detail page without a record: its fields are on the page
  const fieldSuggestions = React.useMemo(() => {
    const first = fieldRoot; if (!first) return [] as { selector: string; classes: string[]; tag: string; sample: string; count: number }[];
    const seen = new Map<string, { selector: string; classes: string[]; tag: string; sample: string; count: number }>();
    const walk = (el: Element, depth: number) => { for (const c of el.children) { if (c.tagName === "SCRIPT" || c.tagName === "STYLE" || c.tagName === "NAV" || c.tagName === "FOOTER" || c.tagName === "HEADER") continue; const own = [...c.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim()); const leaf = c.children.length === 0 || c.tagName === "A" || own; if (leaf && (c.textContent || "").trim()) { const d = describe(c); const rel = relativeSelector(first, c, describe); const n = recordEls.length ? recordEls.filter((r) => { try { return !!r.querySelector(rel); } catch { return false; } }).length : 1; if (!seen.has(rel)) seen.set(rel, { selector: rel, classes: d.classes, tag: d.tag, sample: d.text, count: n }); } if (c.children.length && depth < 8) walk(c, depth + 1); } };
    walk(first, 0);
    return [...seen.values()].slice(0, 30);
  }, [fieldRoot, recordEls]);
  const nested = React.useMemo(() => { const out: Record<string, unknown> = {}; for (const c of columns) if (c.follow) out[c.follow] = `→ ${model.stages.find((s) => s.id === c.follow)?.url.replace(/^https?:\/\/[^/]+/, "") ?? c.follow}`; return out; }, [columns, model.stages]);
  const rows = React.useMemo(() => record ? recordEls.map((r) => project(r, columns, nested)) : (doc && columns.length ? [project(doc.body, columns, nested)] : []), [recordEls, columns, nested, record, doc, tick]);
  const addColumn = (s: { selector: string; tag: string }) => { if (!stage || columns.some((c) => c.selector === s.selector)) return; const name = columnName(s.selector, s.tag, columns.map((c) => c.name)); patchStage(stage.id, { columns: [...columns, { name, selector: s.selector, source: s.tag === "a" ? "href" : s.tag === "img" ? "attr" : "text", attr: s.tag === "img" ? "src" : undefined }] }); };
  const updateColumn = (i: number, patch: Partial<Column>) => stage && patchStage(stage.id, { columns: columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const removeColumn = (i: number) => stage && patchStage(stage.id, { columns: columns.filter((_, j) => j !== i) });
  const onPick = (p: Pick) => {
    if (!stage) return;
    if (mode === "drive") { setSelector(p.selector === p.tag ? p.path : p.selector); return; }
    if (mode === "look") { setMode("pick"); }
    if (pickFor === "record" || (!record && stage.kind === "listing")) { patchStage(stage.id, { record: bestRecordSelector(p, doc, describe), columns: [] }); setPickFor("column"); return; }
    const el = doc?.querySelector(p.path); if (!el) return;
    const container = record ? recordEls.find((r) => r.contains(el)) : doc?.body; if (!container) { patchStage(stage.id, { record: bestRecordSelector(p, doc, describe), columns: [] }); return; }
    addColumn({ selector: relativeSelector(container, el, describe), tag: p.tag });
  };
  /** follow a link column into each record: a new stage, the FIRST record's page opened as a capture */
  const follow = (i: number) => {
    if (!stage || !doc) return; const c = columns[i]!; const first = recordEls[0] ?? doc.body;
    const a = first.querySelector(c.selector); const href = a?.getAttribute("href"); if (!href) return;
    const s: Stage = { id: newId(), kind: "follow", parent: stage.id, via: c.name, url: absolute(href, stage.url), tier: stage.tier, columns: [], steps: [] };
    setModel((m) => ({ ...m, stages: [...m.stages.map((x) => (x.id === stage.id ? { ...x, columns: x.columns.map((y, j) => (j === i ? { ...y, follow: s.id } : y)) } : x)), s], active: s.id, mode: "pick" }));
    setPickFor("column");
  };
  const removeStage = (id: string) => setModel((m) => ({ ...m, stages: m.stages.filter((s) => s.id !== id && s.parent !== id).map((s) => ({ ...s, columns: s.columns.map((c) => (c.follow === id ? { ...c, follow: undefined } : c)) })), active: m.active === id ? (rootStage(m)?.id ?? "") : m.active }));

  // -- the plan and the run -----------------------------------------------------------
  const body = React.useMemo(() => fullPlan(model, sessionId), [model, sessionId]);
  const [tab, setTab] = React.useState("rows");
  const planView = useQuery({ queryKey: ["plan", JSON.stringify(body)], queryFn: () => api.plan({ plan: body, wireframe: true }), enabled: !!body && !!root?.record && (tab === "plan" || tab === "code") });
  const [run, setRun] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean; replay?: RREvent[] }>({ busy: false });
  const runServer = async () => {
    if (!body || !root) return; setRun({ busy: true }); setTab("server"); const t0 = performance.now();
    const cursor = (await api.history({ since: 0 }).catch(() => [])).reduce((m, e) => Math.max(m, e.n ?? 0), 0);
    try {
      const out = await api.execute({ plan: body, url: root.url });
      const evs = await api.history({ since: cursor }).catch(() => []);
      const customs: RREvent[] = evs.filter((e) => !["rrweb", "snapshot", "trace"].includes(e.topic)).map((e) => { const { events: _d, content: _c, body: _b, ...payload } = e as any; return { type: 5, data: { tag: e.topic, payload }, timestamp: Math.round((e.ts ?? 0) * 1000) }; });
      const base = (views.data?.rrweb ?? []) as RREvent[];
      const t = customs[0]?.timestamp ?? Date.now();
      const replay = base.length ? [{ ...base[0]!, timestamp: t - 2 }, { ...base[1]!, timestamp: t - 1 }, ...customs] : [];
      setRun({ rows: (Array.isArray(out.rows) ? out.rows : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false, replay });
    } catch (e) { setRun({ error: e as ApiError, busy: false }); }
  };

  // -- what the Player shows ----------------------------------------------------------
  const playerEvents = mode === "drive" && stage?.live ? stream : run.replay && tab === "server" ? run.replay : ((views.data?.rrweb ?? []) as RREvent[]);
  const playerLive = mode === "drive" && !!stage?.live;
  const recordHint = views.data?.patterns?.find((p) => p.name === "record_list");
  const highlights: Highlight[] = mode === "look"
    ? [...(recordHint ? [{ selector: recordHint.subject, label: `record list ×${recordHint.count}`, tone: "accent" as const }] : [])]
    : mode === "drive"
      ? (selector ? [{ selector, label: "target", tone: "warn" as const }] : [])
      : [...(record ? [{ selector: record, label: "record", tone: "accent" as const }] : []), ...columns.map((c, i) => ({ selector: record ? `${record} ${c.selector}` : c.selector, label: c.name, colour: fieldColour(i) }))];
  const flags = views.data?.flags ?? [];
  const present = (n: string) => flags.some((f) => f.present && f.name === n);
  const usedClass = (c: string, h: Pick) => [record, ...columns.map((x) => x.selector)].some((sel) => sel.split(/[\s>]+/).some((part) => part.startsWith(h.tag) && part.includes(`.${c}`)));
  const err = openError ?? (views.error as ApiError | null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form onSubmit={open} className="flex min-w-[280px] flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="the page to scrape (a listing, a search, a login…)" className="w-full" /></ToolbarGroup>
          <Select value={stage?.tier ?? "auto"} onChange={(e) => setTier(e.target.value as Tier)} title="the transport tier; changing it re-opens the page"><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId}>{stage ? "Open" : "Start"}</Button>
          {stage?.docId && <Button size="sm" variant="ghost" onClick={reload} title="reload the page">⟳</Button>}
        </form>
        <ToolbarSpacer />
        {stage?.live && <Chip tone="ok" dot>live page</Chip>}
        {history.current.length > 0 && <Button size="sm" variant="ghost" onClick={undo} title="undo (⌘Z)">undo</Button>}
        {root?.record && <Button variant="primary" size="sm" onClick={runServer} disabled={run.busy}>{run.busy ? "running…" : "Run ▶"}</Button>}
      </Toolbar>
      {/* ONE line, fixed height: the mode and the readout -- nothing here may reflow the page */}
      <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-line px-3 text-[12px]">
        <Chip tone={mode === "look" ? "accent" : "neutral"} interactive onClick={() => setMode("look")}>look</Chip>
        <Chip tone={mode === "pick" ? "accent" : "neutral"} interactive onClick={() => setMode("pick")}>pick</Chip>
        <Chip tone={mode === "drive" ? "accent" : "neutral"} interactive onClick={() => (stage?.live ? setMode("drive") : goLive())}>drive{stage && !stage.live ? " (go live)" : ""}</Chip>
        {mode === "pick" && <><span className="text-muted">·</span><Chip tone={pickFor === "record" ? "accent" : "neutral"} interactive onClick={() => setPickFor("record")}>the record</Chip><Chip tone={pickFor === "column" ? "accent" : "neutral"} interactive onClick={() => setPickFor("column")}>a field</Chip></>}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {hover ? <>{hover.tag}{hover.id ? `#${hover.id}` : ""}{hover.classes.map((c) => <span key={c} className={usedClass(c, hover) ? "rounded bg-accent-soft px-0.5 text-accent" : ""}>.{c}</span>)}{hover.text ? <span className="text-ink"> “{hover.text.slice(0, 48)}”</span> : null}</>
            : stage ? <>{views.data?.title ?? "…"} <span className="opacity-70">{stage.url}</span></> : "paste a URL to start"}
        </span>
        {views.data?.card && <Chip tone="neutral">{views.data.card.kind} · {views.data.card.status_code} · {views.data.tiers?.slice(-1)[0] ?? "static"}</Chip>}
      </div>
      {!stage ? <EmptyState title="Start with the page you want data from" hint="Look at what it is, pick the record and the fields, drive it when it needs a click or a login, follow a link into each record, and run the whole thing -- without leaving this screen." /> :
       err && !views.data ? <EmptyState title={`Could not open the page · ${err.code ?? err.status}`} hint={<>{err.hint ?? err.message}{err.remedy && <> — remedy: <b>{err.remedy}</b></>}</>}
         action={err.remedy === "browser" ? <Button variant="primary" onClick={() => setTier("always")}>Open with a browser</Button> : err.code === "pool.exhausted" && sessionId ? <Button variant="primary" onClick={async () => { await api.sessionRelease(sessionId); patchStage(stage.id, { docId: undefined }, false); }}>Release my live pages and retry</Button> : <Button onClick={() => patchStage(stage.id, { docId: undefined }, false)}>Retry</Button>} /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
        <div className="min-w-0">
          {playerEvents.length >= 2 || playerLive ? <Player events={playerEvents} live={playerLive} highlights={highlights} pickable onPick={onPick} onHover={setHover} onDocument={(d) => { setDoc(d); setTick((t) => t + 1); }} controls={false} controller={controller} autoPlay={!!run.replay && tab === "server"} maxHeight={760} />
            : <EmptyState title={views.isFetching || !stage.docId ? "Opening the page into your session…" : "Not an HTML page"} hint={views.data?.kind && views.data.kind !== "html" ? `${views.data.kind}: read it as a document in Tools, or extract from it as JSON.` : undefined} />}
          {mode === "drive" && stage.live && (
            <div className="mt-2 rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <Select value={action} onChange={(e) => setAction(e.target.value as Step["op"])} className="h-8"><option value="click">click</option><option value="write">write</option><option value="scroll">scroll</option><option value="wait_for">wait for</option><option value="goto">goto</option></Select>
                <Input mono value={selector} onChange={(e) => setSelector(e.target.value)} placeholder={action === "goto" ? "url" : "selector — or click the target in the page"} className="h-8 min-w-[200px] flex-1" />
                {action === "write" && <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="text" className="h-8 w-40" />}
                <Button variant="primary" size="sm" onClick={() => act(action === "goto" ? { op: "goto", url: selector } : { op: action, selector, ...(action === "write" ? { text } : {}) })} disabled={!!busy || (!selector && action !== "scroll")}>{busy ? `${busy}…` : "Do it — and record it"}</Button>
                {stage.steps.length > 0 && <Button size="sm" variant="ghost" onClick={undo}>undo last</Button>}
              </div>
              {actError && <div className="mt-1 text-[12px]"><Chip tone="bad">{actError.detail?.code ?? actError.status}</Chip> {actError.detail?.hint ?? actError.message}</div>}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-line p-2">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Stages — the plan's pages <span className="flex-1" />{stage.kind === "follow" && <Button size="sm" variant="ghost" onClick={() => removeStage(stage.id)}>remove this stage</Button>}</div>
            <StageGraph nodes={model.stages.map((s) => ({ id: s.id, label: s.kind === "listing" ? "listing" : `detail via ${s.via}`, sub: s.url.replace(/^https?:\/\/[^/]+/, "") || "/", active: s.id === stage.id, live: !!s.live, count: s.id === stage.id ? (s.record ? recordEls.length : undefined) : (s.record ? undefined : undefined), steps: s.steps.length }))}
              edges={model.stages.filter((s) => s.parent).map((s) => ({ from: s.parent!, to: s.id, label: s.via }))} onSelect={(id) => setModel((m) => ({ ...m, active: id }), false)} height={110} />
          </section>
          {mode === "look" && (
            <section className="rounded-lg border border-line p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Flags — click for evidence</div>
              {views.data ? <FlagRow flags={flags} empty="nothing notable — a plain page" /> : <span className="text-[12px] text-muted">detecting…</span>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recordHint && <Button variant="primary" size="sm" onClick={() => { patchStage(stage.id, { record: recordHint.subject, columns: [] }); setMode("pick"); setPickFor("column"); }}>Pick {recordHint.subject} ×{recordHint.count}</Button>}
                {!recordHint && <Button size="sm" onClick={() => { setMode("pick"); setPickFor("record"); }}>Pick the record by pointing</Button>}
                {present("spa") && stage.tier !== "always" && <Button size="sm" onClick={() => setTier("always")}>Needs a browser — open rendered</Button>}
                {present("pagination") && stage.kind === "listing" && <Button size="sm" onClick={() => patchStage(stage.id, { paginate: { by: "link", max_pages: 5 } })}>Follow rel=next</Button>}
                {(present("login_required") || present("forms")) && <Button size="sm" onClick={goLive}>Needs a click or a login — drive it</Button>}
              </div>
            </section>
          )}
          {mode !== "look" && (
            <section className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">This stage {record && recordEls.length > 0 && <Chip tone="ok">×{recordEls.length}</Chip>}</div>
              {stage.kind === "listing" || record || mode === "pick" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted">record</span>
                  <Input mono value={record} onChange={(e) => patchStage(stage.id, { record: e.target.value, columns: [] })} placeholder={stage.kind === "follow" ? "(none: fields on the page)" : "e.g. div.card"} className="h-7 w-48" />
                  {recordInfo?.classes.map((c) => <Chip key={c} interactive onClick={() => patchStage(stage.id, { record: `${recordInfo.tag}.${c}`, columns: [] })} tone={record.endsWith(`.${c}`) ? "accent" : "neutral"}>.{c}</Chip>)}
                  {stage.kind === "listing" && <><span className="ml-2 text-[11px] text-muted">pages</span><Select value={stage.paginate?.by ?? "none"} onChange={(e) => patchStage(stage.id, { paginate: e.target.value === "none" ? undefined : { by: e.target.value as "link" | "param", max_pages: stage.paginate?.max_pages ?? 5 } })} className="h-7"><option value="none">this one</option><option value="link">rel=next</option><option value="param">?page=</option></Select>{stage.paginate && <Input type="number" min={1} max={50} value={stage.paginate.max_pages} onChange={(e) => patchStage(stage.id, { paginate: { ...stage.paginate!, max_pages: Number(e.target.value) } })} className="h-7 w-14" />}</>}
                </div>) : null}
              {suggestions.length > 0 && !record && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]"><span className="text-muted">detected:</span>{suggestions.slice(0, 5).map((s) => <Chip key={s.selector} interactive onClick={() => { patchStage(stage.id, { record: s.selector, columns: [] }); setPickFor("column"); }}>{s.selector} ×{s.count}{s.confidence != null ? ` · ${Math.round(s.confidence * 100)}%` : ""}</Chip>)}</div>}
              {mode === "pick" && (
                <>
                  <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">fields — click to add a column</div>
                  {fieldSuggestions.length ? <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                    {fieldSuggestions.map((s) => { const on = columns.some((c) => c.selector === s.selector); const used = /\.([a-zA-Z0-9_-]+)/.exec(s.selector)?.[1]; return (
                      <button key={s.selector} type="button" onClick={() => on ? patchStage(stage.id, { columns: columns.filter((c) => c.selector !== s.selector) }) : addColumn(s)} className={`flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-left text-[11px] ${on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`} title={s.classes.length ? `classes: ${s.classes.join(" ")}` : "no classes"}>
                        <code className="font-mono">{s.tag}{s.classes.length ? s.classes.map((c) => <span key={c} className={c === used ? "font-semibold text-accent underline decoration-accent/60" : "text-muted"}>.{c}</span>) : s.selector.replace(/^[a-z0-9]+/, "")}</code>
                        <span className="truncate text-muted" title={s.sample}>“{s.sample.slice(0, 24)}”</span>{recordEls.length > 0 && <span className="text-muted">{s.count}/{recordEls.length}</span>}
                      </button>); })}
                  </div> : <span className="text-[12px] text-muted">{record ? "no text inside the record — click a field in the page" : "pick a record, or click a field on the page"}</span>}
                  {columns.length > 0 && <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                    {columns.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-1.5 rounded border border-line p-1">
                        <span className="inline-block size-2.5 rounded-sm" style={{ background: fieldColour(i) }} />
                        <Input value={c.name} onChange={(e) => updateColumn(i, { name: e.target.value })} className="h-6 w-24" />
                        <Input mono value={c.selector} onChange={(e) => updateColumn(i, { selector: e.target.value })} className="h-6 min-w-[100px] flex-1" />
                        <Select value={c.source} onChange={(e) => updateColumn(i, { source: e.target.value as Source })} className="h-6"><option value="text">text</option><option value="href">href</option><option value="html">html</option><option value="attr">attr…</option></Select>
                        {c.source === "attr" && <Input value={c.attr ?? ""} placeholder="data-price" onChange={(e) => updateColumn(i, { attr: e.target.value })} className="h-6 w-24" mono />}
                        <label className="inline-flex items-center gap-1 text-[10px] text-muted"><input type="checkbox" checked={!!c.all} onChange={(e) => updateColumn(i, { all: e.target.checked })} /> all</label>
                        {c.source === "href" && !c.follow && <Button size="sm" variant="secondary" onClick={() => follow(i)} title="open the first record's link as the next stage; every row gets this page's fields nested">follow ▸</Button>}
                        {c.follow && <Chip tone="accent" interactive onClick={() => setModel((m) => ({ ...m, active: c.follow! }), false)}>→ stage</Chip>}
                        <Button size="sm" variant="ghost" onClick={() => removeColumn(i)}>✕</Button>
                      </li>))}
                  </ul>}
                </>
              )}
              {mode === "drive" && (
                <>
                  <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">recorded steps (part of the plan)</div>
                  {stage.steps.length ? <ol className="flex flex-wrap gap-1 font-mono text-[11px]">{stage.steps.map((s, i) => <li key={i}><Chip>{i + 1}. {s.op}{s.selector ? ` ${s.selector}` : ""}{s.text ? ` “${s.text}”` : ""}{s.url ? ` ${s.url}` : ""}</Chip></li>)}</ol> : <span className="text-[12px] text-muted">act on the page above; every action is recorded here (undo removes the last).</span>}
                  <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">controls (what a model sees)</div>
                  <div className="max-h-40 overflow-auto rounded border border-line">{controls.data ? <ElementTable elements={controls.data} onSelect={(el) => setSelector(el.selector)} /> : <span className="p-2 text-[12px] text-muted">reading…</span>}</div>
                </>
              )}
            </section>
          )}
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "rows", label: "Rows", count: rows.length }, { value: "server", label: "Server run", count: run.rows?.length }, { value: "plan", label: "Plan" }, { value: "code", label: "As code" }, { value: "skeleton", label: "Skeleton" }, { value: "elements", label: "Elements", count: views.data?.controls?.length }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="rows">{!columns.length ? <EmptyState title={record ? "Add a field" : "Pick the record, then its fields"} hint="Rows fill here as you pick; nothing is fetched until you run." /> : <DataFrame rows={rows} columns={columns.map((c) => c.name)} colours={columns.map((_, i) => fieldColour(i))} className="max-h-[380px]" emptyHint="The record selector matched nothing in this page." />}</TabPanel>
              <TabPanel value="server">{run.error ? <div className="p-3 text-[12px]"><Chip tone="bad">{run.error.detail?.code ?? run.error.status}</Chip> {run.error.detail?.hint ?? run.error.message}{run.error.detail?.remedy && <div>remedy: <b>{run.error.detail.remedy}</b></div>}</div>
                : run.rows ? <><div className="px-2 pt-1 text-[11px] text-muted">{run.rows.length} rows from the server in {run.ms} ms{root?.id === stage.id && rows.length !== run.rows.length ? ` · the local preview had ${rows.length}` : ""} · the run replays in the page</div><DataFrame rows={run.rows} className="max-h-[360px]" /></>
                : <EmptyState title="Not run yet" hint="Run ▶ executes the whole plan -- every stage, the pagination, the recorded steps -- through your session." />}</TabPanel>
              <TabPanel value="plan" className="p-2">{planView.data ? <div className="flex flex-col gap-2"><CodeBlock lang="explain" code={planView.data.explain ?? planView.data.describe} /><iframe title="wireframe" sandbox="" srcDoc={planView.data.wireframe ?? ""} className="h-64 w-full rounded-md border border-line bg-white" /></div> : <span className="text-[12px] text-muted">{root?.record ? "asking the service…" : "pick a record on the listing to see the plan"}</span>}</TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("extract", { url: root?.url ?? "", result: root?.record ?? "", fields: Object.fromEntries((root?.columns ?? []).filter((c) => c.source === "text").map((c) => [c.name, c.selector])) }, API_URL)} blob={planView.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(planView.data?.blob ?? "<open the Plan tab>")}, wc).collect()`} /></TabPanel>
              <TabPanel value="skeleton" className="max-h-[420px] overflow-auto p-2">{more.data?.skeleton ? <SkeletonPane skeleton={more.data.skeleton} active={hover ? "<" + hover.tag : null} /> : <span className="text-[12px] text-muted">…</span>}</TabPanel>
              <TabPanel value="elements" className="max-h-[420px] overflow-auto">{views.data?.controls && <ElementTable elements={views.data.controls} onSelect={(el) => { setSelector(el.selector); }} />}</TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
      {(playerLive || (run.replay && tab === "server")) && <MediaBar controller={controller} className="shrink-0" />}
    </div>
  );
}

import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, DataFrame, EmptyState, Input, Player, Select, TabPanel, Tabs, Toolbar, ToolbarGroup, ToolbarSpacer,
  describe, fieldColour, toolAsCode, type Highlight, type Pick,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { call, plan, useActive, useSession } from "../lib/session";

type Source = "text" | "href" | "html" | "attr";
type Column = { name: string; selector: string; source: Source; attr?: string; all?: boolean; sub?: Column[] };
type Suggest = { selector: string; classes: string[]; tag: string; sample: string; count: number };

/** The query builder (stories 2.1-2.3). Build by pointing, in the Player: the page is
 * rebuilt once, selectors are evaluated LOCALLY in it (zero requests while you pick),
 * the class names are spelled out, the rows fill as a dataframe (nested JSON welcome),
 * and "run on the server" executes the same plan through the session. */
export function Query() {
  const [params, setParams] = useSearchParams();
  const active = useActive("/query");
  const [own, setOwn] = React.useState(() => new URLSearchParams(params));
  React.useEffect(() => { if (active) setOwn(new URLSearchParams(params)); }, [active, params]);
  const docId = own.get("doc") ?? "";
  const wantUrl = own.get("url") ?? "";
  const tier = own.get("tier") ?? "false";
  const sessionId = useSession();
  const [draft, setDraft] = React.useState(wantUrl);
  const [openError, setOpenError] = React.useState<ApiError | null>(null);
  React.useEffect(() => {  // a ?url= is opened into the session; the builder then works on the held document
    if (!active || !sessionId || !wantUrl || docId) return;
    let on = true;
    api.docOpen(sessionId, { url: wantUrl, browser: tier === "false" ? false : tier }).then((h) => { if (on) setParams((p) => { const n = new URLSearchParams(p); n.delete("url"); n.set("doc", h.id); return n; }, { replace: true }); }).catch((e) => { if (on) setOpenError(e as ApiError); });
    return () => { on = false; };
  }, [active, sessionId, wantUrl, docId, tier, setParams]);
  const [record, setRecord] = React.useState<string>(params.get("record") ?? "");
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [paginate, setPaginate] = React.useState(params.get("paginate") ?? "none");
  const [maxPages, setMaxPages] = React.useState(5);
  const [tab, setTab] = React.useState("rows");
  const [pickFor, setPickFor] = React.useState<"record" | "column">(params.get("record") ? "column" : "record");
  const [hover, setHover] = React.useState<Pick | null>(null);
  const [doc, setDoc] = React.useState<Document | null>(null);
  const [tick, setTick] = React.useState(0);
  const [server, setServer] = React.useState<{ rows?: Record<string, unknown>[]; error?: ApiError; ms?: number; busy: boolean }>({ busy: false });

  const snap = useQuery({ queryKey: ["doc-views", sessionId, docId, "query"], queryFn: () => api.docViews(sessionId!, docId, ["rrweb", "patterns", "records"]), enabled: !!sessionId && !!docId, staleTime: Infinity });
  const url = snap.data?.url ?? wantUrl;
  React.useEffect(() => { if (url) setDraft(url); }, [url]);
  // suggestions: the pattern hints + the repeating-region options, from the one snapshot call
  const suggestions = React.useMemo(() => {
    const out: { selector: string; count: number; why: string; confidence?: number }[] = [];
    for (const h of snap.data?.patterns ?? []) if (h.name === "record_list") out.push({ selector: h.subject, count: h.count ?? 0, why: "pattern", confidence: h.confidence });
    for (const r of snap.data?.records ?? []) if (!out.some((o) => o.selector === r.selector)) out.push({ selector: r.selector, count: r.repeats ?? 0, why: "repeating region" });
    return out;
  }, [snap.data]);
  React.useEffect(() => { if (!record && suggestions[0]) { setRecord(suggestions[0].selector); setPickFor("column"); } }, [suggestions, record]);

  // -- local evaluation in the rebuilt page --------------------------------------------
  const recordEls = React.useMemo(() => { if (!doc || !record) return []; try { return [...doc.querySelectorAll(record)]; } catch { return []; } }, [doc, record, tick]);
  const recordInfo = React.useMemo(() => recordEls[0] ? describe(recordEls[0]) : null, [recordEls]);
  const fieldSuggestions = React.useMemo<Suggest[]>(() => {
    const first = recordEls[0]; if (!first) return [];
    const seen = new Map<string, Suggest>();
    const walk = (el: Element) => {
      for (const c of el.children) {
        const own = [...c.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
        const isLeaf = c.children.length === 0 || c.tagName === "A" || own;
        if (isLeaf && (c.textContent || "").trim()) {
          const d = describe(c); const rel = relativeSelector(first, c);
          const n = recordEls.filter((r) => { try { return !!r.querySelector(rel); } catch { return false; } }).length;
          if (!seen.has(rel)) seen.set(rel, { selector: rel, classes: d.classes, tag: d.tag, sample: d.text, count: n });
        }
        if (c.children.length) walk(c);
      }
    };
    walk(first);
    return [...seen.values()].slice(0, 24);
  }, [recordEls]);
  const rows = React.useMemo(() => recordEls.map((r) => project(r, columns)), [recordEls, columns, tick]);

  const highlights: Highlight[] = [
    ...(record ? [{ selector: record, label: "record", tone: "accent" as const }] : []),
    ...columns.map((c, i) => ({ selector: `${record} ${c.selector}`, label: c.name, colour: fieldColour(i) })),
  ];
  const onPick = (p: Pick) => {
    if (pickFor === "record" || !record) { setRecord(bestRecordSelector(p, doc)); setColumns([]); setPickFor("column"); return; }
    const el = doc?.querySelector(p.path); if (!el) return;
    const container = recordEls.find((r) => r.contains(el)); if (!container) { setRecord(bestRecordSelector(p, doc)); setColumns([]); return; }
    addColumn({ selector: relativeSelector(container, el), classes: p.classes, tag: p.tag, sample: p.text, count: recordEls.length });
  };
  const addColumn = (s: Suggest) => {
    if (columns.some((c) => c.selector === s.selector)) return;
    const base = columnName(s.selector, s.tag); const name = columns.some((c) => c.name === base) ? `${base}_${columns.length + 1}` : base;
    setColumns((cs) => [...cs, { name, selector: s.selector, source: s.tag === "a" ? "href" : s.tag === "img" ? "attr" : "text", attr: s.tag === "img" ? "src" : undefined }]);
  };
  const update = (i: number, patch: Partial<Column>) => setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  React.useEffect(() => {  // restore columns from the URL once (a back / forward, a shared link)
    const raw = params.get("cols"); if (raw && !columns.length) { try { setColumns(JSON.parse(raw)); } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {  // ...and keep it there (only while this workspace is on screen)
    if (!active || !docId) return;
    setParams((p) => { const n = new URLSearchParams(p); if (record) n.set("record", record); else n.delete("record"); if (columns.length) n.set("cols", JSON.stringify(columns)); else n.delete("cols"); return n; }, { replace: true });
  }, [active, record, columns, docId, setParams]);

  // -- the plan (data) and the server run ------------------------------------------------
  const body = React.useMemo(() => record ? plan("Reference", [
    call("resolve", [], tier === "false" ? {} : { browser: tier }),
    ...(paginate !== "none" ? [call("paginate", [], { by: paginate, max_pages: maxPages })] : []),
    call("select_all", [record]),
    ...(columns.length ? [[{ kind: "get" as const, name: "extract" }, { kind: "call" as const, name: "extract", args: [], kwargs: Object.fromEntries(columns.map((c) => [c.name, { plan: fieldPlan(c) }])) as any }]] : []),
    call("project"),
  ], sessionId) : null, [record, columns, paginate, maxPages, tier, sessionId]);
  const planView = useQuery({ queryKey: ["plan", JSON.stringify(body)], queryFn: () => api.plan({ plan: body, wireframe: true }), enabled: !!body && (tab === "plan" || tab === "code") });
  const runServer = async () => {
    if (!body) return; setServer({ busy: true }); const t0 = performance.now(); setTab("server");
    try { const out = await api.execute({ plan: body, url }); setServer({ rows: (Array.isArray(out.rows) ? out.rows : []) as Record<string, unknown>[], ms: Math.round(performance.now() - t0), busy: false }); }
    catch (e) { setServer({ error: e as ApiError, busy: false }); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar className="flex-wrap">
        <form className="flex min-w-[280px] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); setColumns([]); setRecord(""); setPickFor("record"); setOpenError(null); setParams({ url: draft, tier }); }}>
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="the page with the records" className="w-full" /></ToolbarGroup>
          <Select value={tier} onChange={(e) => setParams({ url, tier: e.target.value })}><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          <Button type="submit" size="sm">Load</Button>
        </form>
        <ToolbarGroup>
          <span className="text-[12px] text-muted">pagination</span>
          <Select value={paginate} onChange={(e) => setPaginate(e.target.value)}><option value="none">none</option><option value="link">rel=next</option><option value="param">?page=</option></Select>
          {paginate !== "none" && <Input type="number" min={1} max={50} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="w-16" />}
        </ToolbarGroup>
        <ToolbarSpacer />
        {rows.length > 0 && <Chip tone="ok">{rows.length} rows · local</Chip>}
        <Button variant="primary" size="sm" onClick={runServer} disabled={!body || server.busy}>{server.busy ? "running…" : "Run on the server"}</Button>
      </Toolbar>
      {!url && !docId ? <EmptyState title="Load a page to build a query" hint="Pick the repeating record, then the fields inside one of them. Rows fill as you go -- no requests until you run it." /> :
      snap.isError || openError ? <EmptyState title="Could not load the page" hint={((snap.error ?? openError) as ApiError).detail?.hint ?? String(snap.error ?? openError)} /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted">picking:</span>
            <Chip tone={pickFor === "record" ? "accent" : "neutral"} interactive onClick={() => setPickFor("record")}>the record</Chip>
            <Chip tone={pickFor === "column" ? "accent" : "neutral"} interactive onClick={() => setPickFor("column")}>a field inside it</Chip>
            <span className="flex-1" />
            {hover && <span className="truncate font-mono text-[11px] text-muted">{hover.selector}{hover.classes.length > 1 ? ` · ${hover.classes.join(" ")}` : ""}</span>}
          </div>
          {snap.data?.rrweb ? <Player events={snap.data.rrweb as any} highlights={highlights} pickable onPick={onPick} onHover={setHover} onDocument={(d) => { setDoc(d); setTick((t) => t + 1); }} controls={false} maxHeight={720} />
            : <EmptyState title={snap.isLoading ? "Fetching…" : "Not an HTML page"} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-line p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">1 · the record {recordEls.length > 0 && <Chip tone="ok">×{recordEls.length}</Chip>}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input mono value={record} onChange={(e) => { setRecord(e.target.value); setColumns([]); }} placeholder="e.g. div.card" className="h-8 w-56" />
              {recordInfo && recordInfo.classes.length > 0 && <span className="text-[11px] text-muted">classes:</span>}
              {recordInfo?.classes.map((c) => <Chip key={c} interactive onClick={() => { setRecord(`${recordInfo.tag}.${c}`); setColumns([]); }} tone={record.endsWith(`.${c}`) ? "accent" : "neutral"}>.{c}</Chip>)}
            </div>
            {suggestions.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"><span className="text-muted">detected:</span>{suggestions.slice(0, 6).map((s) => <Chip key={s.selector} interactive tone={s.selector === record ? "accent" : "neutral"} onClick={() => { setRecord(s.selector); setColumns([]); setPickFor("column"); }} title={s.why}>{s.selector} ×{s.count}{s.confidence != null ? ` · ${Math.round(s.confidence * 100)}%` : ""}</Chip>)}</div>}
          </section>
          <section className="rounded-lg border border-line p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">2 · the fields (inside one record) — click to add a column</div>
            {!record ? <span className="text-[12px] text-muted">pick a record first</span> : fieldSuggestions.length ? (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {fieldSuggestions.map((s) => { const on = columns.some((c) => c.selector === s.selector); return (
                  <button key={s.selector} type="button" onClick={() => on ? setColumns((cs) => cs.filter((c) => c.selector !== s.selector)) : addColumn(s)} className={`flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] ${on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}>
                    <code className="font-mono">{s.selector}</code><span className="truncate text-muted" title={s.sample}>“{s.sample.slice(0, 28)}”</span><span className="text-muted">{s.count}/{recordEls.length}</span>
                  </button>); })}
              </div>) : <span className="text-[12px] text-muted">no text inside the record — click a field in the page</span>}
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "rows", label: "Rows", count: rows.length }, { value: "columns", label: "Columns", count: columns.length }, { value: "server", label: "Server run", count: server.rows?.length }, { value: "plan", label: "Plan" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="rows">
                {!columns.length ? <EmptyState title="Add a column" hint="Click a field chip above, or a field in the page." /> :
                 <DataFrame rows={rows} columns={columns.map((c) => c.name)} colours={columns.map((_, i) => fieldColour(i))} className="max-h-[420px]" emptyHint="The record selector matched nothing in the page." />}
              </TabPanel>
              <TabPanel value="columns" className="p-2">
                <ul className="flex flex-col gap-1 text-[12px]">
                  {columns.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-line p-1.5">
                      <span className="inline-block size-2.5 rounded-sm" style={{ background: fieldColour(i) }} />
                      <Input value={c.name} onChange={(e) => update(i, { name: e.target.value })} className="h-7 w-32" />
                      <Input mono value={c.selector} onChange={(e) => update(i, { selector: e.target.value })} className="h-7 min-w-[140px] flex-1" />
                      <Select value={c.source} onChange={(e) => update(i, { source: e.target.value as Source })} className="h-7"><option value="text">text</option><option value="href">href</option><option value="html">html</option><option value="attr">attribute…</option></Select>
                      {c.source === "attr" && <Input value={c.attr ?? ""} placeholder="data-price" onChange={(e) => update(i, { attr: e.target.value })} className="h-7 w-28" mono />}
                      <label className="inline-flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={!!c.all} onChange={(e) => update(i, { all: e.target.checked })} /> all matches (a list)</label>
                      <Button size="sm" variant="ghost" onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}>✕</Button>
                    </li>
                  ))}
                  {!columns.length && <li className="text-muted">No columns yet.</li>}
                </ul>
              </TabPanel>
              <TabPanel value="server">
                {server.error ? <div className="p-3 text-[12px]"><Chip tone="bad">{server.error.detail?.code ?? server.error.status}</Chip> {server.error.detail?.hint ?? server.error.message}{server.error.detail?.remedy && <div>remedy: <b>{server.error.detail.remedy}</b></div>}</div>
                 : server.rows ? <><div className="px-2 pt-1 text-[11px] text-muted">{server.rows.length} rows from the server in {server.ms} ms{rows.length !== server.rows.length ? ` · the local preview had ${rows.length}` : " · same as the local preview"}</div><DataFrame rows={server.rows} className="max-h-[400px]" /></>
                 : <EmptyState title="Not run yet" hint="Run on the server executes this exact plan through your session (pagination included)." />}
              </TabPanel>
              <TabPanel value="plan" className="p-2">
                {planView.data ? <div className="flex flex-col gap-2"><CodeBlock lang="explain" code={planView.data.explain ?? planView.data.describe} /><iframe title="wireframe" sandbox="" srcDoc={planView.data.wireframe ?? ""} className="h-72 w-full rounded-md border border-line bg-white" /></div> : <span className="text-[12px] text-muted">{body ? "asking the service…" : "pick a record to see the plan"}</span>}
              </TabPanel>
              <TabPanel value="code">
                <AsCode {...toolAsCode("extract", { url, result: record, fields: Object.fromEntries(columns.filter((c) => c.source === "text").map((c) => [c.name, c.selector])) }, API_URL)} blob={planView.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(planView.data?.blob ?? "<open the Plan tab>")}, wc).collect()`} />
              </TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
    </div>
  );
}

/** The sub-plan a column becomes in `extract(name=<plan>)`. */
function fieldPlan(c: Column): Record<string, unknown> {
  const sel = c.all ? call("select_all", [c.selector]) : call("select", [c.selector]);
  const attr = c.source === "text" ? "text" : c.source === "href" ? "href" : c.source === "html" ? "html" : c.attr ?? "text";
  return { root: "Document", steps: [...sel, ...call("attr", [attr])] };
}

function project(recordEl: Element, columns: Column[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    let els: Element[] = []; try { els = c.all ? [...recordEl.querySelectorAll(c.selector)] : ([recordEl.querySelector(c.selector)].filter(Boolean) as Element[]); } catch { /* a bad selector: nothing */ }
    const val = (el: Element): unknown => c.sub?.length ? project(el, c.sub) : c.source === "text" ? (el.textContent || "").trim() : c.source === "href" ? el.getAttribute("href") : c.source === "html" ? el.innerHTML : el.getAttribute(c.attr ?? "");
    out[c.name] = c.all ? els.map(val) : els[0] ? val(els[0]) : null;
  }
  return out;
}

/** A selector for `el` relative to `root`: tag.class when unique inside the record, else a short path. */
function relativeSelector(root: Element, el: Element): string {
  const d = describe(el);
  const tries = [d.selector, ...(d.classes.length > 1 ? [`${d.tag}.${d.classes.slice(0, 2).join(".")}`] : []), d.tag];
  for (const t of tries) { try { if (root.querySelectorAll(t).length === 1 && root.querySelector(t) === el) return t; } catch { /* next */ } }
  const steps: string[] = []; let n: Element | null = el;
  while (n && n !== root) { const p: Element | null = n.parentElement; if (!p) break; const same = [...p.children].filter((c) => c.tagName === n!.tagName); steps.push(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase()); n = p; }
  return steps.reverse().join(" > ");
}

/** From a click inside a page: the selector of the repeating ancestor (the record), preferring a class shared by ≥2 siblings. */
function bestRecordSelector(p: Pick, doc: Document | null): string {
  if (!doc) return p.selector;
  let el: Element | null = doc.querySelector(p.path);
  while (el && el.tagName !== "BODY") {
    const d = describe(el);
    for (const c of d.classes) { const sel = `${d.tag}.${c}`; try { if (doc.querySelectorAll(sel).length >= 2) return sel; } catch { /* next */ } }
    el = el.parentElement;
  }
  return p.selector;
}

function columnName(selector: string, tag: string): string {
  const leaf = selector.split(/\s*[> ]\s*/).filter(Boolean).pop() ?? selector;
  const cls = /\.([a-zA-Z0-9_-]+)/.exec(leaf)?.[1]; const attr = /\[(?:data-)?([a-zA-Z0-9_-]+)/.exec(leaf)?.[1]; const id = /#([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const raw = cls ?? id ?? attr ?? (tag === "a" ? "link" : tag === "img" ? "image" : tag === "time" ? "when" : /^[a-z0-9]+/.exec(leaf)?.[0] ?? tag);
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "field";
}

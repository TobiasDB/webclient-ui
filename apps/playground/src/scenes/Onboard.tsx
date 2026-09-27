import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Chip, EmptyState, StageRail, cn, stagesLib, type Event, type Plan, type StageStatus } from "@webclient/ui";
import { api, ApiError, type Brief, type CrawlPage, type Evaluation, type OnboardingExample, type OnboardingResult, type QueryView } from "../lib/api";
import { encSpec } from "./Run";

/** a readable message from an API error: the problem detail + its hint when the API sent them. */
function errMsg(e: unknown): string {
  const a = e as ApiError;
  const d = a?.detail;
  if (d?.message) return d.hint ? `${d.message} — ${d.hint}` : d.message;
  return a?.message ?? String(e);
}

/** The ONBOARD workspace: the pipeline finds a source for a brief and authors two queries --
 * A/latest (the newest rows) and B/all (the whole dataset, pagination walked) -- each judged on
 * completeness / correctness / timeliness. Worked EXAMPLES (one per dataset shape) come from the
 * API's GET /examples ($0, no model); a live run needs a model configured on the API. Every query
 * links straight into the Author (open its plan to refine) and Run (execute it). */
export function Onboard({ events = [] }: { events?: Event[] }) {
  const nav = useNavigate();
  const examples = useQuery({ queryKey: ["examples"], queryFn: api.examples, staleTime: Infinity, retry: false });

  const spec = (view: QueryView, source: string, name: string) =>
    ({ plan: view.plan as unknown as Plan, url: source, name });
  const openAuthor = (view: QueryView, source: string) => nav(`/author?plan=${encSpec(spec(view, source, "onboard"))}`);
  const openRun = (view: QueryView, source: string, name: string) => nav(`/run?p=${encSpec(spec(view, source, name))}`);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
      <header className="max-w-3xl">
        <h1 className="text-[17px] font-semibold tracking-tight">Onboard a dataset</h1>
        <p className="mt-1 text-[13px] text-muted">
          Give the pipeline a brief; it searches, crawls, evaluates and authors two queries for the
          best source — <b>A/latest</b> (the newest rows — a cheap incremental poll) and <b>B/all</b>
          {" "}(the whole dataset, pagination walked) — each judged on completeness, correctness and
          timeliness. Open a query in the Author to refine it, or run it in Run.
        </p>
      </header>

      <LiveOnboard events={events} onOpenAuthor={openAuthor} onOpenRun={openRun} />

      <details className="mt-1">
        <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-wide text-muted">
          Worked examples <span className="font-normal normal-case text-muted">({examples.data?.length ?? 0}) · one per dataset shape, built by the pipeline (no model)</span>
        </summary>
        {examples.isLoading && <p className="mt-2 text-[12px] text-muted">building the examples (running the pipeline)…</p>}
        {examples.isError && <p className="mt-2 text-[12px] text-bad">could not load examples: {errMsg(examples.error)}</p>}
        <div className="mt-2 grid gap-2 xl:grid-cols-2">
          {(examples.data ?? []).map((ex) => (
            <ResultCard key={ex.name} ex={ex} onOpenAuthor={openAuthor} onOpenRun={openRun} />
          ))}
        </div>
      </details>
    </div>
  );
}

/** A live onboarding run: a company + brief -> POST /onboard. Needs a model on the API (else a
 * clear note). The result renders exactly like an example card. */
const BROWSER: Record<string, { label: string; opts: () => Record<string, unknown> | undefined; note: string }> = {
  default: { label: "headless · stealth (default)", opts: () => undefined, note: "the shared headless browser with stealth masks — fast, fine for most sites." },
  hardened: { label: "hardened (fingerprint)", opts: () => ({ fingerprint: true }), note: "a randomised realistic identity per page — a stronger stealth for pickier sites." },
  headed: { label: "headed (visible browser)", opts: () => ({ headless: false, fingerprint: true }), note: "a VISIBLE browser (a virtual display is started on the server) — defeats headless-only anti-bot detection." },
  cdp: { label: "real Chrome (CDP)", opts: () => undefined, note: "attach to your own running Chrome/Edge (start it with --remote-debugging-port=9222) — your real profile, session and fingerprint. The strongest anti-bot path." },
};

/** an empty brief -- the starting point before a template is picked or fields are typed. */
function emptyBrief(): Brief {
  return { name: "", title: "", description: "", fields: [], descriptions: {}, optional: [], schema_tree: [],
    search: "", start_url: "", look: [], ignore: [], exit_when: "", hints: "", crawl: {} };
}

function LiveOnboard({ events, onOpenAuthor, onOpenRun }: { events: Event[] } & CardHandlers) {
  const [company, setCompany] = React.useState("");
  const [brief, setBrief] = React.useState<Brief>(emptyBrief);
  const [model, setModel] = React.useState("shim");
  const [browser, setBrowser] = React.useState("default");
  const [cdp, setCdp] = React.useState("http://localhost:9222");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<OnboardingResult | null>(null);
  const [runAt, setRunAt] = React.useState(0);  // events since this run started (drop earlier ones)

  // the live pipeline of the onboarding run: search -> crawl -> select -> evaluate -> source ->
  // query. Both the STATUS (the rail) and the per-stage DETAIL (what each step produced) come from
  // the bus as the run unfolds -- so every card fills in the moment its stage finishes, not at the end.
  const runEvents = React.useMemo(
    () => events.filter((e) => e.topic === "pipeline" && (e as { pipeline?: string }).pipeline === "onboarding" && (e.ts ?? 0) * 1000 >= runAt),
    [events, runAt],
  );
  const stages = React.useMemo(() => stagesLib.pipelineStages(runEvents), [runEvents]);
  const detail = React.useMemo(() => {
    const m: Record<string, Record<string, unknown>> = {};
    for (const e of runEvents) {
      const pe = e as unknown as { phase?: string; stage?: string; detail?: Record<string, unknown> };
      if (pe.phase === "exit" && pe.detail) m[pe.stage ?? ""] = pe.detail;
    }
    return m;
  }, [runEvents]);

  const run = async () => {
    setBusy(true); setError(null); setRes(null); setRunAt(Date.now());
    const bopts = browser === "cdp" ? { cdp_endpoint: cdp } : BROWSER[browser]?.opts();
    try {
      setRes(await api.onboard({
        company, model, ...(bopts ? { browser: bopts } : {}),
        brief: briefToBody(brief),  // the FULL brief (schema, look/ignore, start_url, crawl, …)
      }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const canRun = !!company && !!(brief.description || brief.fields.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input className="w-40 rounded border border-line bg-surface px-2 py-1 text-[13px]" placeholder="company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <select className="rounded border border-line bg-surface px-2 py-1 text-[13px]" value={model} onChange={(e) => setModel(e.target.value)} title="shim = the local claude CLI (no API key, slower); api = a model configured on the API (ANTHROPIC_API_KEY)">
            <option value="shim">model: shim (local claude)</option>
            <option value="">model: API key</option>
          </select>
          <select className="rounded border border-line bg-surface px-2 py-1 text-[12px]" value={browser} onChange={(e) => setBrowser(e.target.value)} title={BROWSER[browser]?.note}>
            {Object.entries(BROWSER).map(([k, v]) => <option key={k} value={k}>browser: {v.label}</option>)}
          </select>
          {browser === "cdp" && <input className="rounded border border-line bg-surface px-2 py-1 font-mono text-[11px]" style={{ minWidth: 220 }} placeholder="http://localhost:9222" value={cdp} onChange={(e) => setCdp(e.target.value)} />}
          <span className="flex-1" />
          <Button variant="primary" size="sm" disabled={busy || !canRun} onClick={run}>{busy ? "onboarding…" : "Onboard ▶"}</Button>
        </div>
        <BriefEditor brief={brief} onChange={setBrief} />
        <p className="mt-2 text-[11px] text-muted">The brief is the <b>source of truth</b>. The <b>shim</b> routes through your local <code className="font-mono">claude</code> CLI — no API key, runs out of the box (~30–60s).</p>
      </div>

      {/* the pipeline itself -- the main content: every stage, with what it produced, LIVE */}
      <PipelineView detail={detail} res={res} stages={stages} busy={busy} error={error} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} />
    </div>
  );
}

/** the brief as the /onboard body wants it: frontmatter-shaped, so the API's Brief.from_front rebuilds
 * it exactly. Drops empties so a sparse brief stays sparse. */
function briefToBody(b: Brief): Record<string, unknown> {
  const out: Record<string, unknown> = { description: b.description };
  // schema as {path: description} items (dotted paths nest; a trailing "?" marks optional)
  if (b.fields.length) out.schema = b.fields.map((f) => {
    const path = b.optional.includes(f) ? `${f}?` : f;
    return b.descriptions[f] ? { [path]: b.descriptions[f] } : path;
  });
  for (const k of ["name", "title", "search", "start_url", "exit_when", "hints"] as const) if (b[k]) out[k] = b[k];
  if (b.look.length) out.look = b.look;
  if (b.ignore.length) out.ignore = b.ignore;
  if (Object.keys(b.crawl).length) out.crawl = b.crawl;
  return out;
}

/** one editable row of the target schema: a dotted path (nests), what the field is, and whether it
 * may be absent (optional=True, so the query author doesn't force it). */
type FieldRow = { path: string; description: string; optional: boolean };

/** The BRIEF editor -- a full representation of every frontmatter field the pipeline reads, so a brief
 * can be built from scratch or from a packaged template and edited before a run. Schema generation
 * (add/remove/describe fields, dotted paths for nesting, an optional toggle), source (web search OR a
 * start URL), look/ignore guides, a stop condition, structural hints, and the crawl config. */
function BriefEditor({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const templates = useQuery({ queryKey: ["briefs"], queryFn: api.briefs, staleTime: Infinity, retry: false });
  const set = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });
  const rows: FieldRow[] = brief.fields.map((f) => ({ path: f, description: brief.descriptions[f] ?? "", optional: brief.optional.includes(f) }));
  const setRows = (next: FieldRow[]) => {
    const fields = next.map((r) => r.path.trim()).filter(Boolean);
    const descriptions: Record<string, string> = {};
    const optional: string[] = [];
    for (const r of next) { const p = r.path.trim(); if (!p) continue; if (r.description.trim()) descriptions[p] = r.description.trim(); if (r.optional) optional.push(p); }
    set({ fields, descriptions, optional });
  };
  const useStartUrl = !!brief.start_url;
  const lines = (v: string[]) => v.join("\n");
  const parseLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const crawl = brief.crawl as { max_pages?: number; depth?: number; rounds?: number; browser?: string };
  const setCrawl = (patch: Record<string, unknown>) => {
    const next = { ...brief.crawl, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] == null) delete next[k];
    set({ crawl: next });
  };

  return (
    <div className="grid gap-2.5 rounded-md border border-line bg-surface p-2.5 md:grid-cols-2">
      {/* template + identity */}
      <label className="flex items-center gap-2 text-[11px] text-muted md:col-span-2">
        start from
        <select className="rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink" value={brief.name}
          onChange={(e) => { const t = templates.data?.find((b) => b.name === e.target.value); if (t) onChange(t); else set({ name: e.target.value }); }}>
          <option value="">— a blank brief —</option>
          {(templates.data ?? []).map((t) => <option key={t.name} value={t.name}>{t.title || t.name}</option>)}
        </select>
        {templates.isError && <span className="text-bad">briefs unavailable</span>}
        <span className="flex-1" />
        <input className="w-36 rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink" placeholder="title" value={brief.title} onChange={(e) => set({ title: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-muted md:col-span-2">
        description <span className="font-normal">— the dataset you want, in plain words</span>
        <textarea className="min-h-[3rem] rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink" placeholder="every product with its name and price" value={brief.description} onChange={(e) => set({ description: e.target.value })} />
      </label>

      {/* schema generation */}
      <div className="md:col-span-2">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          schema <span className="font-normal normal-case">— the fields each record carries (dotted paths nest: <code className="font-mono">price.value</code>)</span>
        </div>
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input className="w-40 rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink" placeholder="field.path" value={r.path} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, path: e.target.value } : x))} />
              <input className="flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink" placeholder="what it is / how to fill it (optional)" value={r.description} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <label className="flex items-center gap-1 text-[10px] text-muted" title="may be absent on some pages — the query author won't force it (optional=True)">
                <input type="checkbox" checked={r.optional} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, optional: e.target.checked } : x))} /> opt
              </label>
              <button type="button" className="rounded px-1.5 text-[13px] text-muted hover:text-bad" title="remove field" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setRows([...rows, { path: "", description: "", optional: false }])}>+ add field</button>
        </div>
      </div>

      {/* source: web search OR a start URL */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          source
          <label className="flex items-center gap-1 font-normal normal-case"><input type="radio" checked={!useStartUrl} onChange={() => set({ start_url: "" })} /> web search</label>
          <label className="flex items-center gap-1 font-normal normal-case"><input type="radio" checked={useStartUrl} onChange={() => set({ start_url: brief.start_url || "https://" })} /> start URL</label>
        </div>
        {useStartUrl
          ? <input className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink" placeholder="https://example.com/{company}/data" value={brief.start_url} onChange={(e) => set({ start_url: e.target.value })} />
          : <input className="w-full rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink" placeholder='search qualifier, e.g. "investor relations news" (after the company)' value={brief.search} onChange={(e) => set({ search: e.target.value })} />}
      </div>

      {/* stop condition */}
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        stop when <span className="font-normal normal-case">— a clean exit before authoring (optional)</span>
        <input className="rounded border border-line bg-surface px-2 py-1 text-[12px] font-normal text-ink" placeholder="the upcoming-events section is empty" value={brief.exit_when} onChange={(e) => set({ exit_when: e.target.value })} />
      </label>

      {/* look / ignore */}
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        look for <span className="font-normal normal-case">— kinds of pages to head for (one per line)</span>
        <textarea className="min-h-[3rem] rounded border border-line bg-surface px-2 py-1 text-[11px] font-normal text-ink" placeholder="the pricing / plans page" value={lines(brief.look)} onChange={(e) => set({ look: parseLines(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        ignore <span className="font-normal normal-case">— kinds of pages to skip (one per line)</span>
        <textarea className="min-h-[3rem] rounded border border-line bg-surface px-2 py-1 text-[11px] font-normal text-ink" placeholder="blog, docs, careers" value={lines(brief.ignore)} onChange={(e) => set({ ignore: parseLines(e.target.value) })} />
      </label>

      {/* structural hints */}
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted md:col-span-2">
        hints <span className="font-normal normal-case">— structural guidance for the query author (how this dataset is laid out)</span>
        <textarea className="min-h-[2.5rem] rounded border border-line bg-surface px-2 py-1 text-[11px] font-normal text-ink" placeholder="the dataset splits into UPCOMING and ARCHIVED sections; ARCHIVED is tabbed by year" value={brief.hints} onChange={(e) => set({ hints: e.target.value })} />
      </label>

      {/* crawl config */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:col-span-2">
        crawl
        <NumBox label="max pages" value={crawl.max_pages} onChange={(v) => setCrawl({ max_pages: v })} />
        <NumBox label="depth" value={crawl.depth} onChange={(v) => setCrawl({ depth: v })} />
        <NumBox label="rounds" value={crawl.rounds} onChange={(v) => setCrawl({ rounds: v })} />
        <label className="flex items-center gap-1 font-normal normal-case">browser
          <select className="rounded border border-line bg-surface px-1 py-0.5 text-[11px] text-ink" value={crawl.browser ?? ""} onChange={(e) => setCrawl({ browser: e.target.value })}>
            <option value="">auto</option><option value="always">always</option><option value="never">never</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function NumBox({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | "") => void }) {
  return (
    <label className="flex items-center gap-1 font-normal normal-case">{label}
      <input type="number" min={0} className="w-16 rounded border border-line bg-surface px-1 py-0.5 text-[11px] text-ink" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
    </label>
  );
}

const STATUS_TONE: Record<StageStatus, string> = {
  pending: "text-muted", running: "text-accent", done: "text-ok", failed: "text-bad", waiting: "text-warn", skipped: "text-muted",
};

/** The onboarding pipeline as its OWN view -- a stage rail plus one rich card per step (what the
 * search found, what was crawled, the candidates, the evaluation with its flags, the fetch policy,
 * and the A/B queries). The main content of the workspace, so a run is fully inspectable. */
function PipelineView({ detail, res, stages, busy, error, onOpenAuthor, onOpenRun }: {
  detail: Record<string, Record<string, unknown>>; res: OnboardingResult | null; stages: import("@webclient/ui").StageInfo[]; busy: boolean; error: string | null;
} & CardHandlers) {
  const statusOf = (name: string): StageStatus => stages.find((s) => s.name === name)?.status ?? "pending";
  const d = (stage: string) => detail[stage];
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v as Record<string, unknown>[] : []);
  const source = (d("evaluate")?.url as string) || res?.evaluation?.url || "";
  const started = busy || stages.length > 0 || !!res;
  const seeds = (d("search")?.seeds as string[]) ?? [];
  const pages = arr(d("crawl")?.pages);
  const cands = arr(d("select")?.candidates);
  const q = d("query");
  return (
    <section className="flex min-h-[440px] flex-col rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        pipeline {busy && <span className="text-accent">· running</span>}
        <span className="flex-1" />
        {res && !res.ok && <Chip tone="bad">stopped: {res.reason || "unknown"}</Chip>}
        {res?.ok && <Chip tone="ok">onboarded</Chip>}
      </div>
      {started && <div className="border-b border-line px-3 py-2"><StageRail stages={stages} /></div>}
      {error && <p className="px-3 py-2 text-[12px] text-warn">{error}</p>}
      {!started && !error && <div className="p-4"><EmptyState title="No run yet" hint="Fill a brief above and Onboard ▶. Each stage below then fills in — LIVE as it completes — with exactly what it produced: the seeds, the crawled pages, the candidates, the page evaluation with its signals, the fetch policy, and the two queries." /></div>}
      {started && (
        <div className="grid gap-2 p-3">
          <StageCard n={1} title="Search" status={statusOf("search")} summary={d("search") ? `${d("search")!.count ?? seeds.length} seed(s)` : undefined}>
            {d("search") ? (seeds.length ? <ul className="space-y-0.5">{seeds.map((u) => <li key={u}><a className="font-mono text-[11px] text-accent hover:underline" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul> : <Muted>no seeds — web search returned nothing (install ddgs, or paste a seed URL)</Muted>) : <Pending status={statusOf("search")} />}
          </StageCard>
          <StageCard n={2} title="Crawl" status={statusOf("crawl")} summary={d("crawl") ? `${d("crawl")!.fetched ?? pages.length} fetched · ${d("crawl")!.failed ?? 0} failed` : undefined}>
            {d("crawl") ? <PageTable pages={pages as unknown as CrawlPage[]} /> : <Pending status={statusOf("crawl")} />}
          </StageCard>
          <StageCard n={3} title="Select" status={statusOf("select")} summary={d("select") ? `${cands.length} candidate(s)` : undefined}>
            {d("select") ? (cands.length ? <ul className="space-y-0.5">{cands.map((c) => <li key={String(c.url)} className="flex items-center gap-2 text-[11px]"><span className="rounded bg-surface-3 px-1 text-[10px] text-muted">{String(c.tier)}</span><span className="truncate font-mono" title={String(c.url)}>{String(c.url)}</span>{c.note ? <span className="truncate text-muted" title={String(c.note)}>— {String(c.note)}</span> : null}</li>)}</ul> : <Muted>no candidates</Muted>) : <Pending status={statusOf("select")} />}
          </StageCard>
          <StageCard n={4} title="Evaluate" status={statusOf("evaluate")} summary={d("evaluate")?.url as string | undefined}>
            {d("evaluate") ? <EvalPanel ev={d("evaluate") as unknown as Evaluation} /> : <Pending status={statusOf("evaluate")} />}
          </StageCard>
          <StageCard n={5} title="Source" status={statusOf("source")} summary={d("source") ? resolveSummary((d("source")!.resolve as Record<string, unknown>) ?? {}) : undefined}>
            {d("source") ? <div className="text-[11px] text-muted">{source && <>fetches <span className="font-mono">{source}</span> with </>}{resolveSummary((d("source")!.resolve as Record<string, unknown>) ?? {})}.</div> : <Pending status={statusOf("source")} />}
          </StageCard>
          <StageCard n={6} title="Query" status={statusOf("query")} summary={q ? (q.authored ? "the latest (A) and all (B) queries" : "no query") : undefined}>
            {res && (res.query_latest || res.query_all) ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <QueryBlock label="A · latest" hint="the newest rows (incremental poll)" view={res.query_latest ?? null} source={source} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} name={`${res.company}-latest`} binary={false} />
                <QueryBlock label="B · all" hint="the whole dataset (backfill)" view={res.query_all ?? null} source={source} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} name={`${res.company}-all`} binary={false} />
              </div>
            ) : q?.authored ? (
              <div className="space-y-1">
                <code className="block truncate font-mono text-[10.5px] text-ink-2" title={String(q.describe)}>{String(q.describe)}</code>
                <div className="flex flex-wrap gap-1"><Assess ok={true} note={String(q.completeness ?? "")} label="complete" /><Assess ok={true} note={String(q.correctness ?? "")} label="correct" /><Assess ok={!/STALE|MISSING/.test(String(q.timeliness ?? ""))} note={String(q.timeliness ?? "")} label="timely" /></div>
              </div>
            ) : q ? <Muted>no query authored{res?.reason ? ` — ${res.reason}` : ""}</Muted> : <Pending status={statusOf("query")} />}
          </StageCard>
          {res?.steps?.length ? <Trace steps={res.steps} /> : null}
        </div>
      )}
    </section>
  );
}

/** a stage that hasn't produced its detail yet -- running or still to come. */
function Pending({ status }: { status: StageStatus }) {
  return <Muted>{status === "running" ? "working…" : status === "failed" ? "did not complete" : "—"}</Muted>;
}

function StageCard({ n, title, status, summary, children }: { n: number; title: string; status: StageStatus; summary?: string | null; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-2 text-[10px] text-muted">{n}</span>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className={cn("text-[11px] font-medium capitalize", STATUS_TONE[status])}>{status}</span>
        {summary && <span className="ml-auto max-w-[55%] truncate text-[11px] text-muted" title={summary}>{summary}</span>}
      </div>
      <div className="px-3 py-2 text-[12px]">{children}</div>
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-[11px] text-muted">{children}</span>;

function PageTable({ pages }: { pages: CrawlPage[] }) {
  if (!pages.length) return <Muted>no pages fetched</Muted>;
  return (
    <div className="space-y-0.5">
      {pages.slice(0, 25).map((p) => (
        <div key={p.url} className="flex items-center gap-2 text-[11px]">
          {p.tier && <span className="rounded bg-surface-3 px-1 text-[10px] text-muted">{p.tier}</span>}
          <span className="min-w-0 flex-1 truncate" title={p.url}>{p.title || p.url}</span>
          {p.flags.map((f) => <span key={f} className="rounded bg-warn-soft px-1 text-[9px] text-warn">{f}</span>)}
        </div>
      ))}
      {pages.length > 25 && <Muted>+{pages.length - 25} more</Muted>}
    </div>
  );
}

function EvalPanel({ ev }: { ev?: Evaluation | null }) {
  if (!ev) return <Muted>not evaluated</Muted>;
  const flags = Object.entries(ev.flags ?? {});
  const Score = ({ label, on }: { label: string; on?: boolean }) => <span className={cn("rounded px-1.5 py-0.5 text-[10px]", on ? "bg-ok-soft text-ok" : "bg-surface-3 text-muted")}>{on ? "✓" : "·"} {label}</span>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <Score label="queryable" on={ev.is_queryable} />
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-2">scrapability {ev.scrapability ?? "?"}/10</span>
        <Score label="paginated" on={ev.has_pagination} />
        <Score label="filtered" on={ev.has_filters} />
        {ev.dataset_is_subset && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">a subset</span>}
        {ev.sort_order && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-2">{ev.sort_order}</span>}
        {ev.api_endpoint && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent" title={ev.api_endpoint}>data API</span>}
      </div>
      {flags.length > 0 && <div className="flex flex-wrap gap-1">{flags.sort((a, b) => b[1] - a[1]).map(([name, c]) => <span key={name} className="rounded bg-surface-3 px-1 text-[10px] text-ink-2" title={(ev.flag_signals?.[name] ?? []).join("\n") || undefined}>{name.replace(/_/g, " ")} {Math.round(c * 100)}%</span>)}</div>}
      {ev.verdict && <p className="text-[11px] text-muted">“{ev.verdict}”</p>}
      {ev.recency_hint && <p className="text-[11px] text-muted">recency: {ev.recency_hint}</p>}
    </div>
  );
}

function resolveSummary(resolve: Record<string, unknown>): string {
  const b = resolve.browser as { when?: string } | null | undefined;
  const antibot = resolve.antibot as { level?: string } | null | undefined;
  const bits = [b?.when ? `a browser (${b.when})` : "a plain static fetch", resolve.proxy ? "a proxy" : null, antibot?.level && antibot.level !== "off" ? `anti-bot ${antibot.level}` : null].filter(Boolean);
  return bits.join(" · ");
}

/** The run's step trace (what each stage did) -- collapsible, for debugging a run. */
function Trace({ steps }: { steps: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-2">
      <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} trace ({steps.length} step{steps.length === 1 ? "" : "s"})
      </button>
      {open && (
        <pre className="mt-1 max-h-56 overflow-auto rounded bg-surface-2 p-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
          {steps.join("\n")}
        </pre>
      )}
    </div>
  );
}

type CardHandlers = {
  onOpenAuthor: (view: QueryView, source: string) => void;
  onOpenRun: (view: QueryView, source: string, name: string) => void;
};

function ResultCard({ ex, onOpenAuthor, onOpenRun }: { ex: OnboardingExample } & CardHandlers) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">{ex.title}</h3>
        {ex.ok ? <Chip tone="ok">onboarded</Chip> : <Chip tone="bad">{ex.reason || "failed"}</Chip>}
      </div>
      <div className="mt-0.5 truncate text-[12px] text-muted" title={ex.source}>
        source: <span className="font-mono">{ex.source}</span>
      </div>
      {ex.brief.fields.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
          {ex.brief.fields.map((f) => <span key={f} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-ink-2">{f}</span>)}
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <QueryBlock label="A · latest" hint="the newest rows (incremental poll)" view={ex.latest} source={ex.source} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} name={`${ex.name}-latest`} binary={ex.binary} />
        <QueryBlock label="B · all" hint="the whole dataset (backfill)" view={ex.all} source={ex.source} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} name={`${ex.name}-all`} binary={ex.binary} />
      </div>
    </div>
  );
}

function QueryBlock({ label, hint, view, source, onOpenAuthor, onOpenRun, name, binary }: {
  label: string; hint: string; view: QueryView | null; source: string; name: string; binary: boolean;
} & CardHandlers) {
  if (!view) return <div className="rounded border border-dashed border-line p-2 text-[11px] text-muted">{label}: {binary ? "a binary download — the file itself" : "not authored"}</div>;
  const hasPlan = view.plan && Object.keys(view.plan).length > 0;  // a split query's plan is per-section
  return (
    <div className="rounded border border-line bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-ink">{label}</span>
        <span className="text-[10px] text-muted">{hint}</span>
        <span className="flex-1" />
        <span className="rounded bg-accent-soft px-1 text-[10px] text-accent">{view.row_count} row{view.row_count === 1 ? "" : "s"}</span>
      </div>
      <code className="mt-1 block truncate font-mono text-[10.5px] text-ink-2" title={view.describe}>{view.describe}</code>
      <div className="mt-1 flex flex-wrap gap-1">
        <Assess ok={view.covers_all} note={view.completeness} label="complete" />
        <Assess ok={view.correct} note={view.correctness} label="correct" />
        {view.timeliness && <Assess ok={!/STALE|MISSING/.test(view.timeliness)} note={view.timeliness} label="timely" />}
      </div>
      <div className="mt-1.5 flex gap-1">
        <button type="button" disabled={!hasPlan} title={hasPlan ? "open this query's plan in the Author to refine it" : "a split query — open its sections in the Author individually"} onClick={() => onOpenAuthor(view, source)} className="rounded border border-line px-1.5 py-0.5 text-[11px] hover:bg-surface disabled:opacity-40">Open in Author ✎</button>
        <button type="button" disabled={!hasPlan} title={hasPlan ? "run this query in the Run workspace" : "a split query cannot open as one plan"} onClick={() => onOpenRun(view, source, name)} className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-white hover:brightness-110 disabled:opacity-40">Run ▶</button>
      </div>
    </div>
  );
}

function Assess({ ok, note, label }: { ok: boolean; note: string; label: string }) {
  if (!note) return null;
  return (
    <span className={cn("rounded px-1 text-[10px]", ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")} title={note}>
      {ok ? "✓" : "⚠"} {label}
    </span>
  );
}

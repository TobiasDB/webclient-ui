import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AskCard, Button, Chip, DataFrame, EmptyState, FrontierMap, Input, Select, StageRail, TabPanel, Tabs, Toolbar, ToolbarGroup, ToolbarSpacer, type Event, type LoopEvent, type PipelineEvent, type StageInfo } from "@webclient/ui";
import { api, ApiError, type CrawlState } from "../lib/api";
import { useSession } from "../lib/session";

/** Crawl · Loops (stories 3.1-3.3, 5.1, 10.2): start a crawl in your session -- auto to its
 * budget, manual (you pick each round on the map), or with a goal (a locate that stops at
 * the page you described) -- and watch the frontier, the pages, the failures and the rounds
 * fill; answer any Ask a driver raises. Pipelines from the live stream show as stage rails. */
export function Loops({ liveEvents }: { liveEvents: Event[] }) {
  const [params] = useSearchParams();
  const sessionId = useSession();
  const qc = useQueryClient();
  const [seed, setSeed] = React.useState(params.get("seed") ?? "");
  const [mode, setMode] = React.useState<"auto" | "manual" | "goal">("auto");
  const [maxPages, setMaxPages] = React.useState(12);
  const [width, setWidth] = React.useState(3);
  const [depth, setDepth] = React.useState(3);
  const [keywords, setKeywords] = React.useState("");
  const [robots, setRobots] = React.useState(true);
  const [goalTitle, setGoalTitle] = React.useState("");
  const [goalUrl, setGoalUrl] = React.useState("");
  const [crawlId, setCrawlId] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<ApiError | null>(null);
  const [tab, setTab] = React.useState("pages");

  const crawls = useQuery({ queryKey: ["crawls", sessionId], queryFn: () => api.crawls(sessionId!), enabled: !!sessionId, refetchInterval: 4000 });
  const crawl = useQuery({ queryKey: ["crawl", crawlId], queryFn: () => api.crawl(crawlId!), enabled: !!crawlId, refetchInterval: (q) => (q.state.data?.running || q.state.data?.pending ? 700 : 3000) });
  const st: CrawlState | undefined = crawl.data;

  const start = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!sessionId || !seed) return; setError(null);
    const body: Record<string, unknown> = { seeds: seed, mode: mode === "goal" ? "auto" : mode, max_pages: maxPages, width, depth, obey_robots: robots };
    if (keywords.trim()) body.keywords = keywords.split(/[,\s]+/).filter(Boolean);
    if (mode === "goal") body.goal = { ...(goalTitle ? { title_contains: goalTitle } : {}), ...(goalUrl ? { url_contains: goalUrl } : {}) };
    try { const s = await api.crawlStart(sessionId, body); setCrawlId(s.id); setPicked(new Set()); qc.invalidateQueries({ queryKey: ["crawls"] }); }
    catch (err) { setError(err as ApiError); }
  };
  const step = async () => { if (!crawlId) return; setError(null); try { await api.crawlStep(crawlId, picked.size ? [...picked] : undefined); setPicked(new Set()); crawl.refetch(); } catch (err) { setError(err as ApiError); } };
  const run = async () => { if (!crawlId) return; await api.crawlRun(crawlId); crawl.refetch(); };
  const close = async () => { if (!crawlId) return; await api.crawlClose(crawlId); setCrawlId(null); qc.invalidateQueries({ queryKey: ["crawls"] }); };

  // the live rounds of THIS crawl (loop events on the bus) and every pipeline on the stream
  const rounds = React.useMemo(() => liveEvents.filter((e) => e.topic === "loop" && (e as LoopEvent).loop === "crawl").slice(-40) as LoopEvent[], [liveEvents]);
  const pipelines = React.useMemo(() => {
    const m = new Map<string, PipelineEvent[]>();
    for (const e of liveEvents) if (e.topic === "pipeline") { const pe = e as PipelineEvent; if (!m.has(pe.pipeline)) m.set(pe.pipeline, []); m.get(pe.pipeline)!.push(pe); }
    return [...m];
  }, [liveEvents]);
  const stagesOf = (evs: PipelineEvent[]): StageInfo[] => {
    const order: string[] = []; const s = new Map<string, StageInfo>();
    for (const e of evs) { if (!s.has(e.stage)) { order.push(e.stage); s.set(e.stage, { name: e.stage, status: "pending" }); } const x = s.get(e.stage)!; if (e.phase === "enter") x.status = "running"; if (e.phase === "exit") x.status = e.detail.stopped ? "failed" : "done"; if (e.phase === "error") x.status = "failed"; if (e.phase === "gate") { if (e.detail.waiting) x.status = "waiting"; else x.gate = e.detail.passed === false ? "failed" : "passed"; } }
    return order.map((n) => s.get(n)!);
  };
  const waiting = useQuery({ queryKey: ["loops"], queryFn: api.loops, refetchInterval: 3000 });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form id="crawl-form" onSubmit={start} className="flex min-w-[280px] flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="seed URL" className="w-full" /></ToolbarGroup>
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="auto">auto · best-first to the budget</option><option value="manual">manual · I pick each round</option><option value="goal">goal · stop at the page that…</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId || !seed}>Start</Button>
        </form>
        <ToolbarSpacer />
        {crawls.data && crawls.data.length > 0 && <Select value={crawlId ?? ""} onChange={(e) => setCrawlId(e.target.value || null)}><option value="">— crawls in this session —</option>{crawls.data.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.seeds[0]?.replace(/^https?:\/\//, "").slice(0, 28)} · {c.pages.length} pages</option>)}</Select>}
      </Toolbar>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-1.5 text-[12px] [&_label]:whitespace-nowrap [&_span]:whitespace-nowrap">
        {mode === "goal" && <span className="inline-flex items-center gap-1.5"><span className="text-muted">stop when the title contains</span><Input form="crawl-form" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="e.g. about" className="h-7 w-32" /><span className="text-muted">or the url contains</span><Input form="crawl-form" value={goalUrl} onChange={(e) => setGoalUrl(e.target.value)} placeholder="/about" className="h-7 w-32" /></span>}
        <label className="inline-flex items-center gap-1.5 text-muted">pages <Input form="crawl-form" type="number" min={1} max={200} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="h-7 w-16" /></label>
        <label className="inline-flex items-center gap-1.5 text-muted">width <Input form="crawl-form" type="number" min={1} max={20} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="h-7 w-14" /></label>
        <label className="inline-flex items-center gap-1.5 text-muted">depth <Input form="crawl-form" type="number" min={0} max={10} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="h-7 w-14" /></label>
        <label className="inline-flex items-center gap-1.5 text-muted">steer towards <Input form="crawl-form" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="keywords, e.g. about pricing" className="h-7 w-52" /></label>
        <label className="inline-flex items-center gap-1 text-muted"><input type="checkbox" checked={robots} onChange={(e) => setRobots(e.target.checked)} /> obey robots.txt</label>
      </div>
      {error && <div className="border-b border-line px-3 py-1 text-[12px]"><Chip tone="bad">{error.detail?.code ?? error.status}</Chip> {error.detail?.hint ?? error.message}</div>}
      {!st ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2">
          <EmptyState title="Start a crawl" hint="Auto runs best-first to the budget; manual lets you pick every round on the map; a goal turns it into a locate that stops at the page you described. Keywords steer the frontier towards links that mention them." />
          <div className="flex flex-col gap-3">
            <section className="rounded-lg border border-line p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Waiting for a decision</div>
              {waiting.data?.length ? waiting.data.map((w) => <div key={w.id} className="mb-2"><AskCard ask={w.ask} from={w.id} kind={w.kind} onAnswer={async (a) => { await api.resume(w.id, a); qc.invalidateQueries({ queryKey: ["loops"] }); }} /></div>) : <span className="text-[12px] text-muted">Nothing is waiting.</span>}
            </section>
            <section className="rounded-lg border border-line p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Pipelines (live)</div>
              {pipelines.length ? pipelines.map(([name, evs]) => <div key={name} className="mb-3"><div className="mb-1 text-[12px] font-semibold">{name}</div><StageRail stages={stagesOf(evs)} /></div>) : <span className="text-[12px] text-muted">An onboarding run shows its stage rail here.</span>}
            </section>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.9fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
              <Chip tone={st.running ? "accent" : st.pending ? "warn" : st.done ? "ok" : "neutral"} dot>{st.running ? "running" : st.pending ? "waiting for you" : st.done ? "done" : st.mode === "manual" ? "your move" : "idle"}</Chip>
              <span className="text-muted">round {st.round} · {st.pages.length} pages · {st.frontier.length} in the frontier · {st.failures.length} failed</span>
              {st.result && <Chip tone={st.result.reason === "found" ? "ok" : "warn"}>goal: {st.result.reason}{st.result.found.length ? ` → ${st.result.found[0]}` : ""}</Chip>}
              {st.error && <Chip tone="bad">{st.error}</Chip>}
              <span className="flex-1" />
              {!st.running && !st.done && <Button size="sm" variant="primary" onClick={step}>{picked.size ? `Fetch ${picked.size} picked` : st.mode === "manual" ? "Pick edges on the map" : "Step (best-first)"}</Button>}
              {!st.running && !st.done && st.mode !== "manual" && <Button size="sm" onClick={run}>Run to the budget</Button>}
              <Button size="sm" variant="ghost" onClick={close}>Close</Button>
            </div>
            <FrontierMap seeds={st.seeds} pages={st.pages} frontier={st.frontier} failures={st.failures} picked={picked} onPick={(u) => setPicked((p) => { const n = new Set(p); n.has(u) ? n.delete(u) : n.add(u); return n; })} onOpen={(u) => window.open(`/explore?url=${encodeURIComponent(u)}`, "_blank")} height={520} />
            <p className="mt-1 text-[11px] text-muted">solid = fetched · hollow = in the frontier (bigger = higher score) · red = failed · a line joins a link to the page it was found on · click a hollow node to pick it for the next step, a solid one to explore it</p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {st.pending && <AskCard ask={st.pending} from={st.id} kind="crawl" onAnswer={async (a) => { await api.crawlResume(st.id, a); crawl.refetch(); }}>Pick the edges to expand (a URL, or several).</AskCard>}
            <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
              <Tabs items={[{ value: "pages", label: "Pages", count: st.pages.length }, { value: "frontier", label: "Frontier", count: st.frontier.length }, { value: "failures", label: "Failures", count: st.failures.length }, { value: "rounds", label: "Rounds", count: rounds.length }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
                <TabPanel value="pages"><DataFrame rows={st.pages.map((p) => ({ url: p.url, title: p.title ?? "", status: p.status_code ?? "" }))} className="max-h-[520px]" emptyHint="Nothing fetched yet." /></TabPanel>
                <TabPanel value="frontier"><DataFrame rows={st.frontier.map((e) => ({ url: e.url, text: e.text, depth: e.depth, score: Math.round(e.score * 100) / 100, from: e.parent }))} className="max-h-[520px]" emptyHint="The frontier is empty." onRow={(i) => { const u = st.frontier[i]?.url; if (u) setPicked((p) => { const n = new Set(p); n.has(u) ? n.delete(u) : n.add(u); return n; }); }} /></TabPanel>
                <TabPanel value="failures"><DataFrame rows={st.failures.map((f) => ({ url: f.url, reason: f.reason, status: f.status_code ?? "" }))} className="max-h-[520px]" emptyHint="No failures." /></TabPanel>
                <TabPanel value="rounds" className="p-2">
                  <ul className="flex flex-col gap-1 font-mono text-[11px]">{rounds.slice().reverse().map((r, i) => <li key={i}><Chip tone={r.phase === "decision" ? "accent" : r.phase === "done" ? "ok" : "neutral"}>{r.round}:{r.phase}</Chip> <span className="text-muted">{JSON.stringify(r.detail).slice(0, 140)}</span></li>)}</ul>
                  {!rounds.length && <span className="text-[12px] text-muted">The crawl's rounds and decisions stream here as they happen.</span>}
                </TabPanel>
              </Tabs>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

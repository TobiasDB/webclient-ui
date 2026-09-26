import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Chip, cn, type Plan } from "@webclient/ui";
import { api, type OnboardingExample, type QueryView, type ApiError } from "../lib/api";
import { encSpec } from "./Run";

/** The ONBOARD workspace: the pipeline finds a source for a brief and authors two queries --
 * A/latest (the newest rows) and B/all (the whole dataset, pagination walked) -- each judged on
 * completeness / correctness / timeliness. Worked EXAMPLES (one per dataset shape) come from the
 * API's GET /examples ($0, no model); a live run needs a model configured on the API. Every query
 * links straight into the Author (open its plan to refine) and Run (execute it). */
export function Onboard() {
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

      <LiveOnboard onOpenAuthor={openAuthor} onOpenRun={openRun} />

      <div className="mt-2">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Worked examples</h2>
          <span className="text-[11px] text-muted">one per dataset shape · built by the pipeline, no model</span>
        </div>
        {examples.isLoading && <p className="text-[12px] text-muted">building the examples (running the pipeline)…</p>}
        {examples.isError && <p className="text-[12px] text-bad">could not load examples: {(examples.error as ApiError)?.message}</p>}
        <div className="grid gap-2 xl:grid-cols-2">
          {(examples.data ?? []).map((ex) => (
            <ResultCard key={ex.name} ex={ex} onOpenAuthor={openAuthor} onOpenRun={openRun} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A live onboarding run: a company + brief -> POST /onboard. Needs a model on the API (else a
 * clear note). The result renders exactly like an example card. */
function LiveOnboard({ onOpenAuthor, onOpenRun }: CardHandlers) {
  const [company, setCompany] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [fields, setFields] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<OnboardingExample | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.onboard({
        company, url: url || undefined,
        brief: { description, fields: fields.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      setResult({
        name: company, title: company, description, source: r.evaluation?.url ?? "", ok: r.ok, reason: r.reason,
        binary: false, brief: { description, fields: fields.split(",").map((s) => s.trim()).filter(Boolean) },
        resolve: {}, latest: r.query_latest ?? null, all: r.query_all ?? null,
      });
    } catch (e) {
      setError((e as ApiError)?.message ?? "onboarding failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <input className="rounded border border-line bg-surface px-2 py-1 text-[13px]" placeholder="company" value={company} onChange={(e) => setCompany(e.target.value)} />
        <input className="rounded border border-line bg-surface px-2 py-1 text-[13px] md:col-span-2" placeholder="what data do you want? (the brief)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className="rounded border border-line bg-surface px-2 py-1 text-[13px]" placeholder="fields (comma-separated)" value={fields} onChange={(e) => setFields(e.target.value)} />
        <input className="rounded border border-line bg-surface px-2 py-1 font-mono text-[12px] md:col-span-3" placeholder="a seed URL (optional — skips web search)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button variant="primary" size="sm" disabled={busy || !company || !description} onClick={run}>{busy ? "onboarding…" : "Onboard ▶"}</Button>
      </div>
      {error && <p className="mt-2 text-[12px] text-warn">{error}</p>}
      {result && <div className="mt-2"><ResultCard ex={result} onOpenAuthor={onOpenAuthor} onOpenRun={onOpenRun} /></div>}
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

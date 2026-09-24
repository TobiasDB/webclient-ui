import * as React from "react";
import { Button, Chip, CodeBlock, PlanView, RowsTable } from "@webclient/ui";
import { api, siteOrigin } from "../lib/api";

/** Story C1: a query is data. The same plan shown as its explain tree, its wireframe and
 * its blob, then executed against this site -- and run again, identical rows, no model. */
export function PlanDemo({ record, fields, path, paginate }: { record: string; fields: Record<string, string>; path: string; paginate?: boolean }) {
  const body = React.useMemo(() => ({ root: "Reference", steps: [
    { kind: "get", name: "resolve" }, { kind: "call", name: "resolve", args: [], kwargs: {} },
    ...(paginate ? [{ kind: "get", name: "paginate" }, { kind: "call", name: "paginate", args: [], kwargs: { by: { value: "link" }, max_pages: { value: 10 } } }] : []),
    { kind: "get", name: "select_all" }, { kind: "call", name: "select_all", args: [{ value: record }], kwargs: {} },
    { kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: Object.fromEntries(Object.entries(fields).map(([k, sel]) => [k, { plan: { root: "Document", steps: [
      { kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: sel }], kwargs: {} },
      { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: "text" }], kwargs: {} }] } }])) },
    { kind: "get", name: "project" }, { kind: "call", name: "project", args: [], kwargs: {} },
  ] }), [record, fields, paginate]);
  const [plan, setPlan] = React.useState<Awaited<ReturnType<typeof api.plan>> | null>(null);
  const [runs, setRuns] = React.useState<{ rows: Record<string, unknown>[]; ms: number }[]>([]);
  const [tab, setTab] = React.useState<"plan" | "explain" | "blob">("plan");
  React.useEffect(() => { api.plan({ plan: body }).then(setPlan).catch(() => setPlan(null)); }, [body]);
  const run = async () => { const t0 = performance.now(); const out = await api.execute({ plan: body, url: siteOrigin() + path }); setRuns((r) => [...r, { rows: (out.rows as Record<string, unknown>[]) ?? [], ms: Math.round(performance.now() - t0) }]); };
  React.useEffect(() => { run().catch(() => undefined); }, [body]);
  const identical = runs.length > 1 && runs.every((r) => JSON.stringify(r.rows) === JSON.stringify(runs[0]!.rows));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 flex gap-1 text-[12px]">{(["plan", "explain", "blob"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? "bg-accent-soft font-medium" : "text-muted"}`}>{t}</button>)}</div>
        {!plan ? <span className="text-[12px] text-muted">asking the service for the plan…</span>
         : tab === "plan" ? <PlanView plan={body as any} url={siteOrigin() + path} readOnly />
         : tab === "explain" ? <CodeBlock lang="explain" code={plan.explain ?? plan.describe} />
         : <CodeBlock lang="blob" code={plan.blob} wrap />}
      </div>
      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-[12px]"><b>run against {path}</b><span className="flex-1" /><Button size="sm" variant="secondary" onClick={run}>run again</Button>{runs.length > 1 && <Chip tone={identical ? "ok" : "bad"}>{identical ? `${runs.length}× identical · $0` : "diverged"}</Chip>}</div>
        {runs.length ? <><RowsTable rows={runs[runs.length - 1]!.rows} className="max-h-64 overflow-auto" /><div className="mt-1 font-mono text-[11px] text-muted">{runs.map((r, i) => `run ${i + 1}: ${r.rows.length} rows in ${r.ms} ms`).join(" · ")}</div></> : <span className="text-[12px] text-muted">running…</span>}
      </div>
    </div>
  );
}

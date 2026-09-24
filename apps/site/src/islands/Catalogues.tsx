import * as React from "react";
import { Chip, EmptyState } from "@webclient/ui";
import { api } from "../lib/api";

/** Feature story C3: the signals catalogue, rendered from the registry (never hand-copied),
 * with a live example page on this site per flag. */
export function SignalsCatalogue({ examples }: { examples: Record<string, string> }) {
  const [flags, setFlags] = React.useState<Awaited<ReturnType<typeof api.signals>> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { api.signals().then(setFlags).catch((e) => setErr(String(e.message))); }, []);
  if (err) return <EmptyState title="The service is not reachable" hint={err} />;
  if (!flags) return <div className="text-[12px] text-muted">reading the registry…</div>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {flags.map((f) => (
        <div key={f.name} className="rounded-lg border border-line p-3">
          <div className="mb-1 flex items-center gap-2"><code className="font-mono text-[13px] font-semibold">{f.name}</code>{f.remedy && <Chip tone="warn">remedy: {f.remedy}</Chip>}{f.has_value && <Chip>carries a value</Chip>}</div>
          <ul className="my-2 flex flex-col gap-1 text-[12px]">
            {f.detectors.map((d) => <li key={d.name}><span className="font-mono">{d.name}</span> <Chip tone={d.contra ? "bad" : "neutral"}>{d.contra ? "contra · " : ""}{d.stage}</Chip> <span className="text-muted">{d.description}</span></li>)}
          </ul>
          {examples[f.name] && <a className="text-[12px] text-accent" href={examples[f.name]}>see it on this site → {examples[f.name]}</a>}
        </div>
      ))}
      <p className="text-[12px] text-muted md:col-span-2">{flags.length} flags · {flags.reduce((n, f) => n + f.detectors.length, 0)} detectors, from <code>GET /signals</code>.</p>
    </div>
  );
}

/** Feature story C9: the error catalogue, with a "trigger it" link per code that has a page here. */
export function ErrorsCatalogue({ triggers }: { triggers: Record<string, string> }) {
  const [errs, setErrs] = React.useState<Awaited<ReturnType<typeof api.errors>> | null>(null);
  React.useEffect(() => { api.errors().then(setErrs).catch(() => setErrs([])); }, []);
  if (!errs) return <div className="text-[12px] text-muted">reading the catalogue…</div>;
  return (
    <table className="w-full text-[13px]">
      <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-1">code</th><th>remedy</th><th>retriable</th><th>hint</th><th>trigger</th></tr></thead>
      <tbody>{errs.map((e) => (
        <tr key={e.code} className="border-t border-line/60 align-top">
          <td className="py-1.5 font-mono">{e.code}</td><td><Chip tone="warn">{e.remedy}</Chip></td><td>{e.retriable ? "yes" : "no"}</td><td className="text-muted">{e.hint}</td>
          <td>{triggers[e.code] && <a className="text-accent" href={triggers[e.code]}>{triggers[e.code]}</a>}</td>
        </tr>))}</tbody>
    </table>
  );
}

/** Feature story C7: the tool list with schemas, from GET /tools. */
export function ToolsList() {
  const [tools, setTools] = React.useState<Awaited<ReturnType<typeof api.tools>> | null>(null);
  React.useEffect(() => { api.tools().then(setTools).catch(() => setTools([])); }, []);
  if (!tools) return <div className="text-[12px] text-muted">reading the registry…</div>;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {tools.map((t) => (
        <div key={t.name} className="rounded-lg border border-line p-3 text-[13px]">
          <div className="flex items-center gap-2"><code className="font-mono font-semibold">{t.name}</code><Chip>{t.story}</Chip><span className="text-muted">→ {t.returns}</span></div>
          <p className="mt-1 text-muted">{t.description}</p>
          <div className="mt-1 font-mono text-[11px] text-muted">{Object.entries(t.input_schema.properties ?? {}).map(([k, s]) => `${k}${t.input_schema.required?.includes(k) ? "" : "?"}: ${s.type ?? "any"}`).join(" · ")}</div>
        </div>))}
    </div>
  );
}

/** Feature story C8: /health of the service powering these demos, live. */
export function HealthWidget() {
  const [h, setH] = React.useState<Record<string, unknown> | null>(null);
  React.useEffect(() => { const tick = () => api.health().then(setH).catch(() => setH(null)); tick(); const i = setInterval(tick, 5000); return () => clearInterval(i); }, []);
  if (!h) return <Chip tone="bad">service unreachable</Chip>;
  const r = (h.resources ?? {}) as Record<string, unknown>; const pool = (r.pool ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-wrap gap-2 text-[12px]">
      <Chip tone="ok" dot>ok</Chip><Chip>mode {String(r.mode)}</Chip><Chip>events {String(r.events)}</Chip><Chip>rss {String(r.rss_mb)} MB</Chip>
      <Chip>http {String(pool.http_free)}/{String(pool.http_total)} free</Chip><Chip>pages {String(pool.pages_free)}/{String(pool.pages_total)} free</Chip>
    </div>
  );
}

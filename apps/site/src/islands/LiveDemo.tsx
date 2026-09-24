import * as React from "react";
import { AsCode, Button, Chip, CodeBlock, RowsTable, toolAsCode } from "@webclient/ui";
import { API_URL, api, ApiError, siteOrigin } from "../lib/api";

export type LiveDemoProps = {
  /** the tool to call (`/tools/{tool}`) with these args; `{site}` in a string arg is this site's origin */
  tool: string;
  args: Record<string, unknown>;
  /** how to show the result */
  view?: "rows" | "json" | "text" | "card";
  title?: string;
  /** run on mount (the default) or wait for the button */
  auto?: boolean;
  className?: string;
};

function fill(v: unknown): unknown {
  if (typeof v === "string") return v.replace("{site}", siteOrigin());
  if (Array.isArray(v)) return v.map(fill);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fill(x)]));
  return v;
}

/** A feature page's live demo: input on the left (the call), output on the right (the
 * result, rendered by type), the code that produced it below, and a "last run" stamp. It
 * runs against THIS site through the service -- the claim and its proof, adjacent. */
export function LiveDemo({ tool, args, view = "json", title, auto = true, className }: LiveDemoProps) {
  const [state, setState] = React.useState<{ result?: unknown; error?: ApiError; ms?: number; at?: number; busy: boolean }>({ busy: false });
  const filled = React.useMemo(() => fill(args) as Record<string, unknown>, [args]);
  const run = React.useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    const t0 = performance.now();
    try { const result = await api.tool(tool, filled); setState({ result, ms: Math.round(performance.now() - t0), at: Date.now(), busy: false }); }
    catch (e) { setState({ error: e as ApiError, ms: Math.round(performance.now() - t0), at: Date.now(), busy: false }); }
  }, [tool, filled]);
  React.useEffect(() => { if (auto) run(); }, [auto, run]);
  const [ago, setAgo] = React.useState("");
  React.useEffect(() => { const i = setInterval(() => state.at && setAgo(`${Math.max(0, Math.round((Date.now() - state.at) / 1000))} s ago`), 1000); return () => clearInterval(i); }, [state.at]);
  return (
    <div className={`rounded-lg border border-line ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
        <span className="font-semibold">{title ?? `${tool}()`}</span>
        <Chip tone="accent">live · against this site</Chip>
        <span className="flex-1" />
        {state.at && <span className="font-mono text-muted">last run: {ago || "now"} · {state.ms} ms</span>}
        <Button size="sm" variant="secondary" onClick={run} disabled={state.busy}>{state.busy ? "running…" : "run again"}</Button>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        <div><div className="mb-1 text-[11px] uppercase tracking-wide text-muted">the call</div><AsCode {...toolAsCode(tool, filled, API_URL)} /></div>
        <div><div className="mb-1 text-[11px] uppercase tracking-wide text-muted">the result</div>
          {state.error ? <div className="rounded-md border border-bad/40 bg-bad-soft p-2 text-[12px]"><b>{state.error.detail?.code ?? state.error.status}</b> {state.error.detail?.hint ?? state.error.message}{state.error.detail?.remedy && <div>remedy: <b>{state.error.detail.remedy}</b></div>}{state.error.status === 0 || !state.error.detail ? <div className="mt-1 text-muted">Is the WebClient service running next to this site? (PUBLIC_API_URL)</div> : null}</div>
          : state.result === undefined ? <div className="text-[12px] text-muted">{state.busy ? "running…" : "not run yet"}</div>
          : <Result value={state.result} view={view} />}
        </div>
      </div>
    </div>
  );
}

function Result({ value, view }: { value: unknown; view: LiveDemoProps["view"] }) {
  if (view === "rows" && Array.isArray(value)) return <RowsTable rows={value as Record<string, unknown>[]} className="max-h-72 overflow-auto" />;
  if (view === "text" && typeof value === "string") return <CodeBlock code={value} wrap className="max-h-72 overflow-auto" />;
  return <CodeBlock lang="json" code={JSON.stringify(value, null, 2)} className="max-h-72 overflow-auto" />;
}

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, EmptyState, KeyValue, Panel } from "@webclient/ui";
import { api } from "../lib/api";
import { closeSession, ensureSession, useSession } from "../lib/session";

/** Settings (stories 9.1-9.5). Read-only where the API has no write endpoint yet: the model
 * (stub by default -- a key is configured on the API side), resources, limits. */
export function Settings() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const sessionId = useSession();
  const [sid, setSid] = React.useState<string | null>(null);
  React.useEffect(() => setSid(sessionId), [sessionId]);
  const r = (health.data?.resources ?? {}) as Record<string, unknown>;
  const pool = (r.pool ?? {}) as Record<string, unknown>;
  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2">
      <Panel title="Your session">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Chip tone={sid ? "ok" : "warn"} dot>{sid ? `session ${sid}` : "no session"}</Chip>
          <span className="text-muted">Everything server-held -- the live pages you open, the plans you run -- lives in this one server-side session object (opened with the DOM recorder on).</span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={async () => { await closeSession(); setSid(await ensureSession()); }}>Close and open a fresh one</Button>
        </div>
      </Panel>
      <Panel title="Model">
        <div className="flex items-center gap-2 text-[13px]"><Chip tone="warn">stub</Chip> The demo model ships with WebClient: Onboard and the index author work out of the box, deterministically.</div>
        <p className="mt-2 text-[12px] text-muted">A real model is configured on the API side (<code className="font-mono">WEBCLIENT_LLM__MODEL</code>, <code className="font-mono">ANTHROPIC_API_KEY</code>, <code className="font-mono">WEBCLIENT_LLM__BUDGET_USD</code>); a write endpoint for it (<code className="font-mono">/settings/llm</code>) is on the backend contract list.</p>
      </Panel>
      <Panel title="Resources (live)">
        {health.data ? <KeyValue rows={[["mode", String(r.mode)], ["events", String(r.events)], ["rss", `${String(r.rss_mb)} MB`], ["errors on the ledger", String(r.errors)], ["loops waiting", String((r.waiting as unknown[] | undefined)?.length ?? 0)], ["http pool", `${String(pool.http_free)} free / ${String(pool.http_total)}`], ["page pool", `${String(pool.pages_free)} free / ${String(pool.pages_total)}`], ["pages per session", JSON.stringify(pool.owners ?? {})], ["scripts", String(r.scripts)]]} /> : <EmptyState title="No API" />}
      </Panel>
    </div>
  );
}

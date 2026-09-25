import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, EmptyState, KeyValue, Panel } from "@webclient/ui";
import { api } from "../lib/api";
import { closeSession, reconnect, useSessionState } from "../lib/session";
import { useQueryClient } from "@tanstack/react-query";

/** Settings (stories 9.1-9.5). Read-only where the API has no write endpoint yet: the model
 * (stub by default -- a key is configured on the API side), resources, limits. */
export function Settings() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const ss = useSessionState();
  const sid = ss.status === "ok" ? ss.id : null;
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions, refetchInterval: 4000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["sessions"] }); qc.invalidateQueries({ queryKey: ["health"] }); qc.invalidateQueries({ queryKey: ["session-docs"] }); };
  const r = (health.data?.resources ?? {}) as Record<string, unknown>;
  const pool = (r.pool ?? {}) as Record<string, unknown>;
  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2">
      <Panel title="Your session">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Chip tone={sid ? "ok" : ss.status === "gone" ? "bad" : "warn"} dot>{sid ? `session ${sid}` : ss.status === "gone" ? "session lost" : ss.status === "offline" ? "API unreachable" : "connecting…"}</Chip>
          <span className="text-muted">Everything server-held -- the live pages you open, the plans you run -- lives in this one server-side session object (opened with the DOM recorder on).</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={async () => { await closeSession(); await reconnect(); refresh(); }}>Close and open a fresh one</Button>
          {sid && <Button size="sm" variant="secondary" onClick={async () => { await api.sessionRelease(sid); refresh(); }}>Release my live pages</Button>}
        </div>
        <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Every session on the API</div>
        <p className="mb-2 text-[12px] text-muted">A live page holds one of the API's browser pages until it is released; when none are free a browser fetch waits. Sessions idle past their ttl are reclaimed with their pages. Close what is not yours any more.</p>
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted"><th className="py-1">session</th><th>docs</th><th>live pages</th><th>crawls</th><th>expires</th><th></th></tr></thead>
          <tbody>{(sessions.data ?? []).map((s) => (
            <tr key={s.id} className="border-t border-line/60">
              <td className="py-1 font-mono">{s.id.slice(0, 12)}{s.id === sid ? <Chip tone="accent" className="ml-1">you</Chip> : null}</td><td>{s.documents}</td><td>{s.live_pages}</td><td>{s.crawls}</td>
              <td className="text-muted">{s.expires_at ? `${Math.max(0, Math.round((s.expires_at * 1000 - Date.now()) / 60000))} min` : "never"}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={async () => { await api.sessionRelease(s.id); refresh(); }}>release pages</Button><Button size="sm" variant="ghost" onClick={async () => { await api.sessionClose(s.id); if (s.id === sid) { await closeSession(); await reconnect(); } refresh(); }}>close</Button></td>
            </tr>))}</tbody>
        </table>
        {sessions.data && sessions.data.length > 1 && <Button size="sm" variant="danger" className="mt-2" onClick={async () => { for (const s of sessions.data!) if (s.id !== sid) await api.sessionClose(s.id); refresh(); }}>Close every other session</Button>}
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

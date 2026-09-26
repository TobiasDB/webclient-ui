import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { cn, FlagChip } from "@webclient/ui";
import { api, type DocHandle } from "../lib/api";
import { useSession } from "../lib/session";

/** A loaded document's present flags -- fetched ONCE and cached (no polling), so the "what is
 * this page" conclusions (with their signal evidence, on click) sit right on its chip. */
function DocFlags({ sessionId, docId }: { sessionId: string; docId: string }) {
  const q = useQuery({ queryKey: ["doc-flags", sessionId, docId], queryFn: () => api.docViews(sessionId, docId, ["flags"]), staleTime: Infinity, retry: false });
  const present = (q.data?.flags ?? []).filter((f) => f.present);
  if (!present.length) return null;
  return <>{present.slice(0, 4).map((f) => <FlagChip key={f.name} flag={f} />)}</>;
}

/** The documents your session holds, along the top of every workspace: what is loaded,
 * whether it is a static capture or a LIVE page (a browser page held open), which tier
 * fetched it. Click one to work on it (Explore for a capture, Interact for a live page),
 * reload it in place, or close it. */
export function DocumentStrip() {
  const sessionId = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ["session-docs", sessionId], queryFn: () => api.docs(sessionId!), enabled: !!sessionId, refetchInterval: 3000 });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const pool = ((health.data?.resources as Record<string, unknown> | undefined)?.pool ?? {}) as Record<string, unknown>;
  const held = docs.data?.filter((d) => d.live).length ?? 0;
  const releaseAll = async () => { if (!sessionId) return; setBusy("all"); try { await api.sessionRelease(sessionId); qc.invalidateQueries({ queryKey: ["session-docs"] }); qc.invalidateQueries({ queryKey: ["health"] }); } finally { setBusy(null); } };
  const [busy, setBusy] = React.useState<string | null>(null);
  const current = new URLSearchParams(loc.search).get("doc");
  const reload = async (d: DocHandle) => { if (!sessionId) return; setBusy(d.id); try { await api.docReload(sessionId, d.id); qc.invalidateQueries({ queryKey: ["session-docs"] }); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, d.id] }); qc.invalidateQueries({ queryKey: ["doc-events", d.id] }); } finally { setBusy(null); } };
  const close = async (d: DocHandle) => { if (!sessionId) return; await api.docClose(sessionId, d.id); qc.invalidateQueries({ queryKey: ["session-docs"] }); };
  if (!sessionId || !docs.data?.length) return null;
  const pagesTotal = Number(pool.pages_total ?? 0), pagesFree = Number(pool.pages_free ?? 0);
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-surface-2 px-3 py-1 text-[12px]">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">loaded</span>
      {pagesTotal > 0 && <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px]", pagesFree === 0 ? "border-bad text-bad" : "border-line text-muted")} title="browser pages: free / total on the API; a live page holds one -- when none are free, a browser fetch waits">pages {pagesFree}/{pagesTotal} free{held ? ` · you hold ${held}` : ""}</span>}
      {held > 0 && <button type="button" className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] hover:bg-surface" onClick={releaseAll} disabled={busy === "all"}>release my pages</button>}
      {docs.data.map((d) => (
        <span key={d.id} className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5", current === d.id ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
          <span className={cn("inline-block size-1.5 rounded-full", d.live ? "bg-ok animate-pulse" : "bg-muted")} title={d.live ? "live: a browser page held open" : "a static capture"} />
          <button type="button" className="max-w-[220px] truncate text-left hover:text-accent" title={d.url} onClick={() => nav(`/author?doc=${encodeURIComponent(d.id)}`)}>{d.title || d.url}</button>
          <span className="font-mono text-[10px] text-muted">{d.live ? "live" : d.tier ?? "static"}{d.ok === false ? " · !" : ""}</span>
          {d.ok !== false && sessionId && <DocFlags sessionId={sessionId} docId={d.id} />}
          <button type="button" className="text-muted hover:text-ink" title="reload" onClick={() => reload(d)} disabled={busy === d.id}><RefreshCw size={11} className={busy === d.id ? "animate-spin" : ""} /></button>
          <button type="button" className="text-muted hover:text-bad" title="close" onClick={() => close(d)}><X size={11} /></button>
        </span>
      ))}
    </div>
  );
}

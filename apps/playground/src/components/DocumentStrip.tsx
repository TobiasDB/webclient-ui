import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { cn } from "@webclient/ui";
import { api, type DocHandle } from "../lib/api";
import { useSession } from "../lib/session";

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
  const [busy, setBusy] = React.useState<string | null>(null);
  const current = new URLSearchParams(loc.search).get("doc");
  const reload = async (d: DocHandle) => { if (!sessionId) return; setBusy(d.id); try { await api.docReload(sessionId, d.id); qc.invalidateQueries({ queryKey: ["session-docs"] }); qc.invalidateQueries({ queryKey: ["doc-views", sessionId, d.id] }); qc.invalidateQueries({ queryKey: ["doc-events", d.id] }); } finally { setBusy(null); } };
  const close = async (d: DocHandle) => { if (!sessionId) return; await api.docClose(sessionId, d.id); qc.invalidateQueries({ queryKey: ["session-docs"] }); };
  if (!sessionId || !docs.data?.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-surface-2 px-3 py-1 text-[12px]">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">loaded</span>
      {docs.data.map((d) => (
        <span key={d.id} className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5", current === d.id ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
          <span className={cn("inline-block size-1.5 rounded-full", d.live ? "bg-ok animate-pulse" : "bg-muted")} title={d.live ? "live: a browser page held open" : "a static capture"} />
          <button type="button" className="max-w-[220px] truncate text-left hover:text-accent" title={d.url} onClick={() => nav(d.live ? `/interact?doc=${encodeURIComponent(d.id)}` : `/explore?doc=${encodeURIComponent(d.id)}`)}>{d.title || d.url}</button>
          <span className="font-mono text-[10px] text-muted">{d.live ? "live" : d.tier ?? "static"}{d.ok === false ? " · !" : ""}</span>
          <button type="button" className="text-muted hover:text-ink" title="reload" onClick={() => reload(d)} disabled={busy === d.id}><RefreshCw size={11} className={busy === d.id ? "animate-spin" : ""} /></button>
          <button type="button" className="text-muted hover:text-bad" title="close" onClick={() => close(d)}><X size={11} /></button>
        </span>
      ))}
    </div>
  );
}

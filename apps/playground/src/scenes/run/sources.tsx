/** Loading a run: paste a plan, or pick a recorded one (open, delete, clear). */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn, type Plan } from "@webclient/ui";
import { api } from "../../lib/api";

export type Spec = { plan: Plan; url?: string; name?: string };
export const encSpec = (s: Spec) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decSpec = (s: string | null): Spec | null => { if (!s) return null; try { const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); return o?.plan?.steps ? o : null; } catch { return null; } };
export const remember = (id: string, spec: Spec) => { try { localStorage.setItem(`wc.run.${id}`, JSON.stringify(spec)); } catch { /* fine */ } };
export const recall = (id: string): Spec | null => { try { const t = localStorage.getItem(`wc.run.${id}`); return t ? JSON.parse(t) : null; } catch { return null; } };

/** Paste a plan: its JSON (the plan, or {plan, url}) or a blob -- validated by the API, then loaded (not run). */
export function PlanLoader({ onLoad, compact }: { onLoad: (s: Spec) => void; compact?: boolean }) {
  const [text, setText] = React.useState(""); const [url, setUrl] = React.useState(""); const [err, setErr] = React.useState<string | null>(null);
  const go = async () => {
    setErr(null); const t = text.trim(); if (!t) return;
    try {
      let body: Record<string, unknown>; let u = url.trim() || undefined;
      try { const o = JSON.parse(t); if (o && o.plan) { body = { plan: o.plan }; u = u ?? o.url; } else body = { plan: o }; } catch { body = { blob: t }; }
      const r = await api.plan(body); onLoad({ plan: r.plan as Plan, url: u });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className={cn("flex flex-col gap-1 text-[11px]", compact ? "w-[420px]" : "w-[560px] max-w-full")}>
      <textarea className="h-28 rounded border border-line bg-surface p-1 font-mono text-[10.5px]" placeholder='a plan: {"root": …, "steps": […]}, {"plan": …, "url": …}, or a blob' value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-1">
        <input className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 text-[10.5px]" placeholder="url (when the plan starts from one)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="rounded bg-accent px-2 py-0.5 text-white disabled:opacity-40" disabled={!text.trim()} onClick={go}>Load</button>
      </div>
      {err && <div className="text-bad">{err}</div>}
    </div>
  );
}
export function LoadMenu({ onLoad }: { onLoad: (s: Spec) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative">
      <button type="button" className="rounded border border-line px-1.5 hover:bg-surface-2" onClick={() => setOpen(!open)} title="load another plan">load plan ▾</button>
      {open && <div className="absolute right-0 top-6 z-30 rounded border border-line bg-surface p-1.5 shadow-lg"><PlanLoader compact onLoad={(s) => { setOpen(false); onLoad(s); }} /></div>}
    </span>
  );
}

/** a size in KB (the unit the person reads traces by) */
const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB`;
/** traces the website replays: "clear all" keeps them */
const SITE_TRACES = ["demo", "onboarding"];

/** the recorded runs: open one to replay it here; delete one, or clear them all (the site's demo traces kept) */
export function TraceList({ onOpen, current, compact }: { onOpen: (id: string) => void; current?: string | null; compact?: boolean }) {
  const qc = useQueryClient();
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.traces });
  const list = [...(traces.data ?? [])].sort((a, b) => Number(b.started ?? 0) - Number(a.started ?? 0));
  const total = list.reduce((a, t) => a + (t.bytes ?? 0), 0);
  return (
    <div className={cn("flex min-h-0 flex-col text-[11px]", compact ? "max-h-[60vh] w-[440px]" : "w-[560px] max-w-full rounded border border-line")}>
      <div className="flex items-center gap-2 border-b border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Recorded runs{list.length ? <span className="font-normal normal-case">{list.length} · {kb(total)}</span> : null}<span className="flex-1" />
        {list.length > 0 && <button type="button" data-act="clear-traces" className="rounded px-1.5 font-normal normal-case text-bad hover:bg-bad-soft" onClick={async () => {
          const keep = list.map((t) => t.id).filter((x) => SITE_TRACES.includes(x));
          if (!window.confirm(`Delete ${list.length - keep.length} trace(s)${keep.length ? ` (keeping ${keep.join(", ")}: the site replays them)` : ""}?`)) return;
          await api.tracesClear(keep); await qc.invalidateQueries({ queryKey: ["traces"] });
        }}>clear all</button>}
      </div>
      {list.length ? <ul className="min-h-0 overflow-auto">{list.map((t) => (
        <li key={t.id} className={cn("group flex items-center gap-2 border-b border-line/60 px-2 py-1 hover:bg-surface-2", current === t.id && "bg-accent-soft")}>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(t.id)} title="replay it here">
            <span className="block truncate font-medium">{t.id}</span>
            <span className="text-[10px] text-muted">{t.events.toLocaleString()} events{t.bytes !== undefined ? ` · ${kb(t.bytes)}` : ""}{t.started ? ` · ${new Date(Number(t.started) * 1000).toLocaleString()}` : ""}</span>
          </button>
          <button type="button" className="shrink-0 rounded px-1 text-muted opacity-0 hover:text-bad group-hover:opacity-100" title="delete this trace" onClick={async () => { if (!window.confirm(`Delete ${t.id}?`)) return; await api.traceDelete(t.id); await qc.invalidateQueries({ queryKey: ["traces"] }); }}>✕</button>
        </li>))}</ul>
        : <div className="p-2 text-muted">{traces.isLoading ? "…" : "No recorded runs yet: every run here is recorded."}</div>}
    </div>
  );
}
export function TracesMenu({ onOpen, current }: { onOpen: (id: string) => void; current?: string | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative">
      <button type="button" className="rounded border border-line px-1.5 hover:bg-surface-2" onClick={() => setOpen(!open)} title="the recorded runs: replay one, or delete them">recorded ▾</button>
      {open && <div className="absolute right-0 top-6 z-30 rounded border border-line bg-surface shadow-lg"><TraceList compact current={current} onOpen={(id) => { setOpen(false); onOpen(id); }} /></div>}
    </span>
  );
}

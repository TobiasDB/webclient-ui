/** TRY a plan where it is being written: run it in the background and follow its events (the same stream Run
 * folds) -- the graph fills in with what each step made, without leaving the page. */
import * as React from "react";
import type { Plan, RunEvent } from "@webclient/ui";
import { api } from "../../lib/api";

export type TryRun = { events: RunEvent[]; status: "idle" | "running" | "done" | "error"; rows: number; error: string | null; planId?: string; start: () => void; clear: () => void };

export function useTryRun(plan: Plan | null, url: string | undefined, sessionId: string | null): TryRun {
  const [id, setId] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [status, setStatus] = React.useState<TryRun["status"]>("idle");
  const [rows, setRows] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [planId, setPlanId] = React.useState<string | undefined>();
  const start = React.useCallback(async () => {
    if (!plan) return;
    setEvents([]); setRows(0); setError(null); setStatus("running");
    try {
      const r = await api.runStart({ plan: { ...plan, session_id: sessionId ?? plan.session_id }, url, name: "author-try", trace: false });
      setPlanId(r.plan_id); setId(r.id);
    } catch (e) { setStatus("error"); setError((e as Error).message); }
  }, [plan, url, sessionId]);
  React.useEffect(() => {
    if (!id) return; let on = true; let timer: ReturnType<typeof setTimeout> | undefined; const held = { rows: 0, events: 0 };
    const pull = async () => {
      try {
        const r = await api.run(id, held.rows, held.events); if (!on) return;
        held.rows += r.rows.length; held.events += r.events.length;
        if (r.events.length) setEvents((xs) => [...xs, ...(r.events as RunEvent[]).filter((e) => e.topic !== "resources")]);
        setRows(held.rows);
        if (r.status === "running") timer = setTimeout(pull, 250);
        else { setStatus(r.status === "error" ? "error" : "done"); if (r.error) setError(`${r.error.code}: ${r.error.message}`); }
      } catch { if (on) timer = setTimeout(pull, 1000); }
    };
    pull(); return () => { on = false; if (timer) clearTimeout(timer); };
  }, [id]);
  return { events, status, rows, error, planId, start, clear: () => { setId(null); setEvents([]); setStatus("idle"); setRows(0); setError(null); } };
}

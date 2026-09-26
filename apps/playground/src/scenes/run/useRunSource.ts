/** WHERE a run comes from -- a plan alone (?p=: loaded, not run), a live run (?id=: followed as it streams),
 * or a recorded one (?trace=) -- as ONE shape: the plan + its events (+ the run's status). The Run view is
 * the same for all three: it is the plan, folded over whatever events there are. */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Plan, RunEvent } from "@webclient/ui";
import { api, type RunState as RunData } from "../../lib/api";
import { useSession } from "../../lib/session";
import { decSpec, encSpec, recall, remember, type Spec } from "./sources";

export type Sample = { ts: number; mem_mb?: number; cpu_pct?: number; pages_total?: number; pages_free?: number; http_free?: number; waiting?: number };

export type RunSource = {
  plan: Plan | null;
  /** the plan's id: a recording's events of other plans are left out */
  planId?: string;
  /** a recording's recorded steps -> their place in the plan */
  stepMap?: Record<string, string>;
  url?: string;
  events: RunEvent[];
  /** the service's resource samples while the run ran (memory, CPU, the pool): beside the events, not in them */
  samples: Sample[];
  status: "loaded" | "starting" | "running" | "done" | "error";
  error: RunData["error"] | null;
  startError: string | null;
  traceId: string | null;
  runId: string | null;
  spec: Spec | null;
  /** run the loaded plan (again) */
  start: () => void;
  load: (s: Spec) => void;
  openTrace: (id: string) => void;
  empty: boolean;
};

export function useRunSource(active: boolean): RunSource {
  const [params, setParams] = useSearchParams();
  const sessionId = useSession();
  const [runId, setRunId] = React.useState<string | null>(params.get("id"));
  const [spec, setSpec] = React.useState<Spec | null>(() => decSpec(params.get("p")) ?? (params.get("id") ? recall(params.get("id")!) : null));
  const [data, setData] = React.useState<RunData | null>(null);
  const [startError, setStartError] = React.useState<string | null>(null);
  const traceParam = params.get("trace");

  const start = React.useCallback(async () => {
    if (!spec) return;
    setStartError(null); setData(null);
    try {
      const r = await api.runStart({ plan: { ...spec.plan, session_id: sessionId ?? spec.plan.session_id }, url: spec.url, name: spec.name });
      remember(r.id, spec); setRunId(r.id);
      setParams((q) => { const n = new URLSearchParams(q); n.set("id", r.id); n.delete("trace"); return n; }, { replace: true });
    } catch (e) { setStartError((e as Error).message); }
  }, [spec, sessionId, setParams]);

  // ?p= a plan LOADED (not run); ?id= a run to follow; ?trace= a recording
  React.useEffect(() => {
    if (!active) return;
    const p = params.get("p"); const id = params.get("id");
    if (p) { const sp = decSpec(p); if (sp && JSON.stringify(sp) !== JSON.stringify(spec)) { setSpec(sp); if (!id) { setRunId(null); setData(null); } } }
    if (id && id !== runId) { setRunId(id); setData(null); setSpec((s) => recall(id) ?? s); }
    if (!id && !p && !traceParam) { setRunId(null); setData(null); }
  }, [active, params]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!active || !traceParam) return; let on = true;
    setRunId(null); setData(null); setSpec(null);
    api.traceEvents(traceParam).then((evs) => {
      if (!on) return;
      const events = (evs as Record<string, unknown>[]).filter((e) => e.topic !== "trace");
      const ts = events.map((e) => Number(e.ts ?? 0)).filter(Boolean);
      const err = events.find((e) => e.topic === "error" && e.raised !== false) as { error?: RunData["error"] } | undefined;
      setData({ id: traceParam, status: err ? "error" : "done", error: err?.error ?? null, started: ts[0] ?? 0, finished: ts[ts.length - 1] ?? 0, describe: "", trace: traceParam, n_rows: 0, n_events: events.length, rows: [], events });
    }).catch((e) => setStartError((e as Error).message));
    return () => { on = false; };
  }, [active, traceParam]);

  // a live run: pull what arrived since the counts held, until it settles
  React.useEffect(() => {
    if (!runId || traceParam) return; let on = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const held = { rows: 0, events: 0 };
    const pull = async () => {
      try {
        const r = await api.run(runId, held.rows, held.events); if (!on) return;
        held.rows += r.rows.length; held.events += r.events.length;
        setData((d) => (d && d.id === r.id ? { ...r, rows: [...d.rows, ...r.rows], events: r.events.length ? [...d.events, ...r.events] : d.events } : r));
        if (r.status === "running") timer = setTimeout(pull, 300);
      } catch { if (on) timer = setTimeout(pull, 1500); }
    };
    pull(); return () => { on = false; if (timer) clearTimeout(timer); };
  }, [runId, traceParam]);

  const traceId = traceParam ?? data?.trace ?? null;
  const tracePlan = useQuery({ queryKey: ["run-plan", traceId], queryFn: async () => { const p = await api.tracePlan(traceId!); const ir = await api.plan({ blob: p.blob }); return { plan: ir.plan as Plan, id: p.plan_id, steps: p.steps }; }, enabled: !!traceId && data?.status !== "running", retry: 0, staleTime: Infinity });
  const events = React.useMemo(() => ((data?.events ?? []) as RunEvent[]).filter((e) => e.topic !== "resources"), [data?.events]);
  // resource samples: the sampler's (topic "resource", what "sample") -- live and in a trace alike
  const samples = React.useMemo(() => ((data?.events ?? []) as Record<string, unknown>[]).flatMap((e) => {
    const d = e.detail as Record<string, unknown> | undefined;
    if (e.topic === "resource" && d?.what === "sample" && e.ts) return [{ ts: Number(e.ts), ...d } as unknown as Sample];
    if (e.topic === "resources" && e.ts) return [e as unknown as Sample];
    return [];
  }), [data?.events]);
  const status: RunSource["status"] = data ? (data.status as RunSource["status"]) : runId ? "starting" : "loaded";
  return {
    plan: spec?.plan ?? tracePlan.data?.plan ?? null, planId: tracePlan.data?.id, stepMap: tracePlan.data?.steps, url: spec?.url, events, samples, status, error: data?.error ?? null, startError, traceId, runId, spec,
    start, load: (s) => setParams(() => { const n = new URLSearchParams(); n.set("p", encSpec(s)); return n; }),
    openTrace: (id) => setParams(() => { const n = new URLSearchParams(); n.set("trace", id); return n; }),
    empty: !runId && !spec && !data && !traceParam,
  };
}

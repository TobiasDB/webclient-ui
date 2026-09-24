/** The Playground's only dependency: the WebClient HTTP API. In dev the Vite proxy maps
 * `/api/*` -> the service; in a build `VITE_API_URL` points at it directly. */
import type { Event, Flag, IndexedElement, PageCard, PatternHint, TraceSummary, WaitingLoop, ToolSpec } from "@webclient/ui";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
export const WS_URL = (() => {
  if (API_URL.startsWith("http")) return API_URL.replace(/^http/, "ws");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${API_URL}`;
})();

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}: ${typeof body === "object" && body && "error" in body ? JSON.stringify((body as { error: unknown }).error) : String(body)}`);
  }
  get remedy(): string | undefined { const e = (this.body as { error?: { remedy?: string } })?.error; return e?.remedy; }
  get hint(): string | undefined { const e = (this.body as { error?: { hint?: string } })?.error; return e?.hint; }
  get code(): string | undefined { const e = (this.body as { error?: { code?: string; type?: string } })?.error; return e?.code ?? e?.type; }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new ApiError(r.status, body);
  return body as T;
}

export const api = {
  health: () => call<{ ok: boolean; resources: Record<string, unknown> }>("/health"),
  tools: () => call<ToolSpec[]>("/tools"),
  tool: <T,>(name: string, args: Record<string, unknown>) => call<{ result: T }>(`/tools/${name}`, { method: "POST", body: JSON.stringify(args) }).then((r) => r.result),
  // the explore bundle
  snapshot: (url: string, browser: unknown = false) => api.tool<{ card: PageCard; content: string; kind: string }>("snapshot", { url, browser }),
  card: (url: string) => api.tool<PageCard>("card", { url }),
  flags: (url: string, browser: unknown = false) => api.tool<Flag[]>("flags", { url, browser }),
  patterns: (url: string, for_?: string) => api.tool<PatternHint[]>("patterns", for_ ? { url, for: for_ } : { url }),
  skeleton: (url: string, browser: unknown = false, opts: Record<string, unknown> = {}) => api.tool<string>("skeleton", { url, browser, ...opts }),
  markdown: (url: string) => api.tool<string>("fetch_markdown", { url }),
  elements: (url: string, kind: "interactive" | "content" | "records", browser: unknown = false) => api.tool<IndexedElement[]>("elements", { url, kind, browser }),
  fields: (url: string, record: string, browser: unknown = false) => api.tool<IndexedElement[]>("fields", { url, record, browser }),
  extract: (url: string, result: string, fields: Record<string, string>, limit?: number) => api.tool<Record<string, unknown>[]>("extract", { url, result, fields, ...(limit ? { limit } : {}) }),
  plan: (body: Record<string, unknown>) => call<{ valid: boolean; describe: string; blob: string; plan: unknown; wireframe?: string; explain?: string; rows?: unknown }>("/plan", { method: "POST", body: JSON.stringify(body) }),
  execute: (body: Record<string, unknown>) => call<{ rows: unknown }>("/execute", { method: "POST", body: JSON.stringify(body) }),
  // traces + loops
  traces: () => call<TraceSummary[]>("/traces"),
  trace: (id: string) => call<Record<string, unknown>>(`/traces/${encodeURIComponent(id)}`),
  traceEvents: (id: string, topic = "") => call<Event[]>(`/traces/${encodeURIComponent(id)}/events${topic ? `?topic=${topic}` : ""}`),
  traceRrweb: (id: string) => call<Record<string, unknown>[]>(`/traces/${encodeURIComponent(id)}/rrweb`),
  traceAssetUrl: (id: string, rel: string) => `${API_URL}/traces/${encodeURIComponent(id)}/asset/${rel}`,
  traceAsset: async (id: string, rel: string) => (await fetch(api.traceAssetUrl(id, rel))).text(),
  loops: () => call<WaitingLoop[]>("/loops"),
  resume: (id: string, answer: unknown) => call<Record<string, unknown>>(`/loops/${encodeURIComponent(id)}/resume`, { method: "POST", body: JSON.stringify({ answer }) }),
};

/** Subscribe to the live event stream (ws /events), resuming from `since`. */
export function subscribe(onEvent: (e: Event) => void, opts: { since?: number; topic?: string; onOpen?: () => void; onClose?: () => void } = {}) {
  const q = new URLSearchParams();
  if (opts.since) q.set("since", String(opts.since));
  if (opts.topic) q.set("topic", opts.topic);
  const ws = new WebSocket(`${WS_URL}/events?${q}`);
  ws.onopen = () => opts.onOpen?.();
  ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* skip */ } };
  ws.onclose = () => opts.onClose?.();
  return () => ws.close();
}

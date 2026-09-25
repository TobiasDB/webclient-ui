/** The Playground's only dependency: the WebClient HTTP API. In dev the Vite proxy maps
 * `/api/*` -> the service; in a build `VITE_API_URL` points at it directly. */
import type { OpSpec } from "@webclient/ui";
import type { Ask, Event, Flag, IndexedElement, PageCard, PatternHint, TraceSummary, WaitingLoop, ToolSpec } from "@webclient/ui";

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
  /** the problem details (code / hint / remedy / message) when the API sent them */
  get detail(): { code?: string; type?: string; hint?: string; remedy?: string; message?: string } | undefined {
    const e = (this.body as { error?: { code?: string; type?: string; hint?: string; remedy?: string; message?: string } })?.error;
    return e ? { ...e, code: e.code ?? e.type } : undefined;
  }
  get remedy(): string | undefined { const e = (this.body as { error?: { remedy?: string } })?.error; return e?.remedy; }
  get hint(): string | undefined { const e = (this.body as { error?: { hint?: string } })?.error; return e?.hint; }
  get code(): string | undefined { const e = (this.body as { error?: { code?: string; type?: string } })?.error; return e?.code ?? e?.type; }
}

/** told when a call finds the session gone (expired, closed, the API restarted) -- the session store listens */
let sessionLost: ((why: string) => void) | null = null;
export const onSessionLost = (f: ((why: string) => void) | null) => { sessionLost = f; };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const err = new ApiError(r.status, body);
    if (err.code === "NoSuchSession") sessionLost?.(err.detail?.message ?? "the session is gone");
    throw err;
  }
  return body as T;
}

export type CrawlState = {
  id: string; session: string; mode: "auto" | "manual"; seeds: string[]; running: boolean; done: boolean; status: string; round: number;
  pages: { url: string; title?: string | null; kind?: string; status_code?: number }[];
  frontier: { url: string; text: string; depth: number; score: number; parent: string }[];
  failures: { url: string; reason: string; status_code?: number | null }[];
  pending: Ask | null; goal: Record<string, unknown> | null;
  result: { reason: string; rounds: number; pages: number; found: string[] } | null; error: string | null;
};
export type SessionInfo = { id: string; status: string; expires_at: number | null; ttl: number | null; documents: number; live_pages: number; crawls: number; recording: boolean; mine?: boolean };
export type DocHandle = { id: string; kind: string; ok: boolean; url?: string; title?: string | null; live?: boolean; tier?: string; tiers?: string[]; status_code?: number };
export type DocViews = { document_id: string; kind: string; url: string; title?: string | null; live: boolean; tiers: string[]; card?: PageCard; content?: string;
  rrweb?: Record<string, unknown>[]; patterns?: PatternHint[]; records?: IndexedElement[]; flags?: Flag[]; skeleton?: string; markdown?: string; controls?: IndexedElement[]; elements?: IndexedElement[]; transport?: Record<string, unknown> };
export type Snapshot = { card: PageCard; kind: string; encoding?: string; content: string; document_id: string;
  rrweb?: Record<string, unknown>[]; patterns?: PatternHint[]; records?: IndexedElement[]; flags?: Flag[] };

export const api = {
  health: () => call<Record<string, unknown>>("/health"),
  tools: () => call<ToolSpec[]>("/tools"),
  /** the op catalogue: what each core exposes (the menu is generated from it) */
  ops: () => call<{ Document: OpSpec[]; Reference: OpSpec[] }>("/ops"),
  tool: async <T,>(name: string, args: Record<string, unknown>) => (await call<{ result: T }>(`/tools/${name}`, { method: "POST", body: JSON.stringify(args) })).result,
  /** ONE round trip for a page: the card, the content, and the player / pattern / record / flag views. */
  snapshot: (url: string, browser: unknown = false, include: string[] = ["rrweb", "patterns", "records", "flags"]) => api.tool<Snapshot>("snapshot", { url, browser, include }),
  card: (url: string, browser: unknown = "auto") => api.tool<PageCard>("card", { url, browser }),
  flags: (url: string) => api.tool<Flag[]>("flags", { url }),
  patterns: (url: string, for_?: string) => api.tool<PatternHint[]>("patterns", { url, ...(for_ ? { for: for_ } : {}) }),
  skeleton: (url: string, collapse = true) => api.tool<string>("skeleton", { url, collapse }),
  markdown: (url: string) => api.tool<string>("fetch_markdown", { url }),
  elements: (url: string, kind: "interactive" | "content" | "records" = "interactive") => api.tool<IndexedElement[]>("elements", { url, kind }),
  fields: (url: string, record: string) => api.tool<IndexedElement[]>("fields", { url, record }),
  extract: (url: string, result: string, fields: Record<string, string>, limit = 200) => api.tool<Record<string, unknown>[]>("extract", { url, result, fields, limit }),
  plan: (body: Record<string, unknown>) => call<{ valid: boolean; describe: string; plan: unknown; blob: string; wireframe?: string; explain?: string; rows?: unknown }>("/plan", { method: "POST", body: JSON.stringify(body) }),
  /** run a plan; `trace: "<name>"` also saves the run as a trace (listed under /traces) */
  execute: (body: Record<string, unknown>) => call<{ rows: unknown; trace?: string }>("/execute", { method: "POST", body: JSON.stringify(body) }),
  /** the doc handle a plan produced (a live page held by the session) */
  executeDoc: async (body: Record<string, unknown>): Promise<DocHandle> => { const out = await api.execute(body); const h = (out.rows as { __doc__?: DocHandle })?.__doc__; if (!h) throw new ApiError(500, { error: { message: "the plan did not yield a document" } }); return h; },
  sessionOpen: (opts: { record?: boolean; ttl?: number } = {}) => call<{ id: string; status: string }>("/sessions", { method: "POST", body: JSON.stringify(opts) }),
  sessions: () => call<SessionInfo[]>("/sessions"),
  sessionRelease: (id: string) => call<{ id: string; released: number }>(`/sessions/${encodeURIComponent(id)}/release`, { method: "POST", body: "{}" }),
  sessionGet: (id: string) => call<{ id: string; status: string }>(`/sessions/${encodeURIComponent(id)}`),
  sessionClose: (id: string) => call<{ id: string; status: string }>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** the bus history over HTTP (a live page's DOM stream when payload is on) */
  history: (q: { since?: number; topic?: string; document_id?: string; payload?: boolean }) => {
    const p = new URLSearchParams(); if (q.since) p.set("since", String(q.since)); if (q.topic) p.set("topic", q.topic); if (q.document_id) p.set("document_id", q.document_id); if (q.payload) p.set("payload", "true");
    return call<(Event & { events?: Record<string, unknown>[] })[]>(`/events?${p}`);
  },
  traces: () => call<TraceSummary[]>("/traces"),
  traceDocument: (id: string, doc: string, upto?: number) => call<{ document_id: string; n: number; ts: number; url: string; final_url?: string; status_code?: number; kind?: string; content: string }>(`/traces/${encodeURIComponent(id)}/documents/${encodeURIComponent(doc)}${upto != null ? `?upto=${upto}` : ""}`),
  traceDelete: (id: string) => call<{ id: string; bytes: number }>(`/traces/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tracesClear: (keep: string[] = []) => call<{ deleted: number; bytes: number }>(`/traces?keep=${encodeURIComponent(keep.join(","))}`, { method: "DELETE" }),
  trace: (id: string) => call<TraceSummary & Record<string, unknown>>(`/traces/${encodeURIComponent(id)}`),
  traceEvents: (id: string, topic = "") => call<Event[]>(`/traces/${encodeURIComponent(id)}/events${topic ? `?topic=${topic}` : ""}`),
  traceEvent: (id: string, n: number) => call<Event & { content?: string; body?: string; events?: unknown[] }>(`/traces/${encodeURIComponent(id)}/events/${n}`),
  traceRrweb: (id: string, documentId?: string) => call<Record<string, unknown>[]>(`/traces/${encodeURIComponent(id)}/rrweb${documentId ? `?document_id=${encodeURIComponent(documentId)}` : ""}`),
  traceHar: (id: string) => call<{ log: { entries: unknown[] } }>(`/traces/${encodeURIComponent(id)}/har`),
  /** runs: a plan executed in the background, followed live (rows / events since the counts held) */
  runStart: (body: Record<string, unknown>) => call<{ id: string; trace: string | null }>("/runs", { method: "POST", body: JSON.stringify(body) }),
  run: (id: string, rows = 0, events = 0) => call<RunState>(`/runs/${encodeURIComponent(id)}?rows=${rows}&events=${events}`),
  runs: () => call<{ id: string; status: string; rows: number; events: number; started: number; finished: number | null; describe: string; trace: string | null }[]>("/runs"),
  tracePlan: (id: string) => call<{ blob: string; describe: string }>(`/traces/${encodeURIComponent(id)}/plan`),
  /** the documents the session holds (the strip at the top): static captures and live pages */
  docs: (sid: string) => call<DocHandle[]>(`/sessions/${encodeURIComponent(sid)}/documents`),
  docOpen: (sid: string, body: { url: string; browser?: unknown; live?: boolean; interactive?: boolean }) => call<DocHandle>(`/sessions/${encodeURIComponent(sid)}/documents`, { method: "POST", body: JSON.stringify(body) }),
  docViews: (sid: string, id: string, include: string[]) => call<DocViews>(`/sessions/${encodeURIComponent(sid)}/documents/${encodeURIComponent(id)}/views?include=${include.join(",")}`),
  docReload: (sid: string, id: string) => call<DocHandle>(`/sessions/${encodeURIComponent(sid)}/documents/${encodeURIComponent(id)}/reload`, { method: "POST", body: "{}" }),
  docClose: (sid: string, id: string) => call<{ id: string }>(`/sessions/${encodeURIComponent(sid)}/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** crawls held by the session */
  crawlStart: (sid: string, body: Record<string, unknown>) => call<CrawlState>(`/sessions/${encodeURIComponent(sid)}/crawls`, { method: "POST", body: JSON.stringify(body) }),
  crawls: (sid: string) => call<CrawlState[]>(`/sessions/${encodeURIComponent(sid)}/crawls`),
  crawl: (id: string) => call<CrawlState>(`/crawls/${id}`),
  crawlStep: (id: string, picks?: string[]) => call<CrawlState>(`/crawls/${id}/step`, { method: "POST", body: JSON.stringify({ picks }) }),
  crawlRun: (id: string) => call<CrawlState>(`/crawls/${id}/run`, { method: "POST", body: "{}" }),
  crawlResume: (id: string, picks: unknown) => call<CrawlState>(`/crawls/${id}/resume`, { method: "POST", body: JSON.stringify({ picks }) }),
  crawlClose: (id: string) => call<{ id: string }>(`/crawls/${id}`, { method: "DELETE" }),
  loops: () => call<WaitingLoop[]>("/loops"),
  resume: (id: string, answer: unknown) => call<Record<string, unknown>>(`/loops/${encodeURIComponent(id)}/resume`, { method: "POST", body: JSON.stringify({ answer }) }),
};

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

export type RunState = { id: string; status: "running" | "done" | "error"; error: { code?: string; message?: string; hint?: string; remedy?: string } | null; started: number; finished: number | null; describe: string; trace: string | null; n_rows: number; n_events: number; rows: { row: unknown; at: number }[]; events: Record<string, unknown>[] };

/** The live demos call the WebClient service directly from the browser (CORS is on for
 * the site's origin). The TARGET of every demo is this site itself. */
import type { ToolSpec } from "@webclient/ui";
import { API_URL_DEFAULT } from "./site";

export const API_URL = API_URL_DEFAULT;
export const siteOrigin = () => (typeof window !== "undefined" ? window.location.origin : "http://localhost:4321");

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) { super(`API ${status}`); }
  get detail(): { code?: string; hint?: string; remedy?: string; message?: string } | undefined {
    return (this.body as { error?: { code?: string; hint?: string; remedy?: string; message?: string } })?.error;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  health: () => call<Record<string, unknown>>("/health"),
  tools: () => call<ToolSpec[]>("/tools"),
  signals: () => call<{ name: string; remedy: string | null; has_value: boolean; detectors: { name: string; stage: string; contra: boolean; needs: string[]; description: string }[] }[]>("/signals"),
  errors: () => call<{ code: string; type: string; title: string; remedy: string; hint: string; retriable: boolean; status_code: number; doc: string }[]>("/errors"),
  tool: async <T,>(name: string, args: Record<string, unknown>) => (await call<{ result: T }>(`/tools/${name}`, { method: "POST", body: JSON.stringify(args) })).result,
  plan: (body: Record<string, unknown>) => call<{ valid: boolean; describe: string; blob: string; wireframe?: string; explain?: string }>("/plan", { method: "POST", body: JSON.stringify(body) }),
  execute: (body: Record<string, unknown>) => call<{ rows: unknown }>("/execute", { method: "POST", body: JSON.stringify(body) }),
  traces: () => call<{ id: string; events: number; started?: number; finished?: number }[]>("/traces"),
  traceEvents: (id: string) => call<import("@webclient/ui").Event[]>(`/traces/${id}/events`),
  traceRrweb: (id: string) => call<Record<string, unknown>[]>(`/traces/${id}/rrweb`),
  traceAsset: async (id: string, p: string) => { const r = await fetch(`${API_URL}/traces/${id}/asset/${p}`); return r.ok ? r.text() : null; },
};

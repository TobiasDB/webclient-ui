/** The Playground's SESSION: everything server-held (live pages, runs) lives in one
 * server-side session object -- opened with the DOM recorder on, remembered per tab, and
 * closed from Settings. Plans carry its id; documents live in its store. */
import * as React from "react";
import { api } from "./api";

const KEY = "wc.session";

export async function ensureSession(): Promise<string> {
  let id: string | null = null;
  try { id = sessionStorage.getItem(KEY); } catch { /* no storage */ }
  if (id) {
    try { const s = await api.sessionGet(id); if (s.status === "running") return id; } catch { /* gone */ }
  }
  const s = await api.sessionOpen({ record: true });
  try { sessionStorage.setItem(KEY, s.id); } catch { /* fine */ }
  return s.id;
}

export async function closeSession(): Promise<void> {
  let id: string | null = null;
  try { id = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { /* fine */ }
  if (id) { try { await api.sessionClose(id); } catch { /* already gone */ } }
}

export function useSession(): string | null {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => { let on = true; ensureSession().then((s) => { if (on) setId(s); }).catch(() => setId(null)); return () => { on = false; }; }, []);
  return id;
}

// -- plan builders (the wire IR: get X, call X(args, kwargs)) ------------------------------
type Step = { kind: "get" | "call"; name: string; args?: { value: unknown }[]; kwargs?: Record<string, { value: unknown }> };
export const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Step[] => [
  { kind: "get", name }, { kind: "call", name, args: args.map((v) => ({ value: v })), kwargs: Object.fromEntries(Object.entries(kwargs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v }])) },
];
export const plan = (root: "Reference" | "Document" | "WebClient", steps: Step[][], sessionId?: string | null) =>
  ({ root, steps: steps.flat(), ...(sessionId ? { session_id: sessionId } : {}) });

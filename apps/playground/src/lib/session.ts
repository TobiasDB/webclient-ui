/** The Playground's SESSION: everything server-held (live pages, runs) lives in one
 * server-side session object -- opened with the DOM recorder on, remembered per tab, and
 * closed from Settings. Plans carry its id; documents live in its store. */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { API_URL, api, onSessionLost } from "./api";

/** Whether this workspace is the one on screen. Workspaces stay mounted when hidden, so
 * anything that READS or WRITES the URL must be gated on this. */
export function useActive(path: string): boolean {
  const loc = useLocation();
  return loc.pathname === path || loc.pathname.startsWith(path + "/");
}

const KEY = "wc.session";

export async function ensureSession(): Promise<string> {
  let id: string | null = null;
  try { id = sessionStorage.getItem(KEY); } catch { /* no storage */ }
  if (id) {
    try { const s = await api.sessionGet(id); if (s.status === "running") return id; } catch { /* gone */ }
  }
  const s = await api.sessionOpen({ record: true, ttl: 1800 });  // idle for 30 min -> reclaimed, pages released
  try { sessionStorage.setItem(KEY, s.id); } catch { /* fine */ }
  return s.id;
}

export function currentSessionId(): string | null { try { return sessionStorage.getItem(KEY); } catch { return null; } }

export async function closeSession(): Promise<void> {
  let id: string | null = null;
  try { id = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { /* fine */ }
  if (id) { try { await api.sessionClose(id); } catch { /* already gone */ } }
}

// -- the SESSION STORE: one session for the whole app, watched ------------------------------
// ok: in use · connecting · gone: expired / closed / the API restarted (reconnect makes a new one)
// · offline: the API is not answering (it comes back to ok -- or gone -- by itself)
export type SessionStatus = "connecting" | "ok" | "gone" | "offline";
export type SessionState = { id: string | null; status: SessionStatus; why?: string; since: number };
let state: SessionState = { id: null, status: "connecting", since: Date.now() };
const subs = new Set<() => void>();
const set = (patch: Partial<SessionState>) => { const next = { ...state, ...patch }; if (patch.status && patch.status !== state.status) next.since = Date.now(); state = next; subs.forEach((f) => f()); };
let started = false;
let beat: ReturnType<typeof setInterval> | undefined;

async function connect(): Promise<void> {
  set({ status: "connecting", why: undefined });
  try { const id = await ensureSession(); set({ id, status: "ok" }); }
  catch (e) { set({ status: (e as { status?: number }).status ? "gone" : "offline", why: (e as Error).message }); }
}
/** is the session still there? (only while the tab is visible: a hidden tab lets it idle out and
 * give its live pages back; coming back finds it gone and offers a new one) */
async function check(): Promise<void> {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (state.status === "connecting") return;
  const id = state.id ?? currentSessionId();
  if (!id) { if (state.status === "offline") await connect(); return; }
  try { const s = await api.sessionGet(id); set(s.status === "running" ? { status: "ok", why: undefined } : { status: "gone", why: `the session is ${s.status}` }); }
  catch (e) { const st = (e as { status?: number }).status; set(st ? { status: "gone", why: (e as Error).message } : { status: "offline", why: "the API is not answering" }); }
}
function start(): void {
  if (started) return; started = true;
  onSessionLost((why) => { if (state.status === "ok") set({ status: "gone", why }); });
  void connect();
  beat = setInterval(() => { void check(); }, 10_000);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  // the tab goes away (closed, reloaded, navigated off): its live browser pages go back to the pool at
  // once -- a page per open tab would otherwise sit held until the session idles out
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => {
    const id = state.id; if (!id || typeof navigator === "undefined" || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(`${API_URL}/sessions/${encodeURIComponent(id)}/release`, new Blob(["{}"], { type: "application/json" })); } catch { /* best effort */ }
  });
}
/** a NEW session (the old one is gone): every workspace gets the new id and reopens what it shows */
export async function reconnect(): Promise<void> {
  try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
  set({ id: null });
  await connect();
}
export function useSessionState(): SessionState {
  React.useEffect(() => { start(); }, []);
  return React.useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
}
/** the session id while the session is usable (null while connecting / gone / offline) */
export function useSession(): string | null {
  const s = useSessionState();
  return s.status === "ok" ? s.id : null;
}
void beat;

// -- plan builders (the wire IR: get X, call X(args, kwargs)) ------------------------------
type Step = { kind: "get" | "call"; name: string; args?: { value: unknown }[]; kwargs?: Record<string, { value: unknown }> };
export const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Step[] => [
  { kind: "get", name }, { kind: "call", name, args: args.map((v) => ({ value: v })), kwargs: Object.fromEntries(Object.entries(kwargs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v }])) },
];
export const plan = (root: "Reference" | "Document" | "WebClient", steps: Step[][], sessionId?: string | null) =>
  ({ root, steps: steps.flat(), ...(sessionId ? { session_id: sessionId } : {}) });

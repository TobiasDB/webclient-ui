/** A page's NETWORK (the package's `doc.network()` / a trace's `network.view` event): its requests, and what each
 * data request put on the page. Pure helpers for the panel. */

export type NetNode = { selector: string; text?: string; field?: string | null; confidence?: number | null };
export type NetRequest = {
  n: number; method?: string; url: string; status?: number | null; type?: string; content_type?: string;
  at?: number | null; elapsed?: number | null; size?: number | null; frame?: string; data?: boolean; phase?: number | null;
  produced?: NetNode[]; body?: string | null; truncated?: boolean; matched?: number;
};
export type NetworkView = { url?: string; document_id?: string; requests: NetRequest[]; by_type?: Record<string, number>; static_nodes?: number; data_nodes?: number; summary?: string };

/** a field's SHAPE: the same field of every record (`jobs[3].title` -> `jobs[*].title`) */
export const shapeOf = (field: string) => field.replace(/\[\d+\]/g, "[*]");

/** what a request filled, grouped by field shape (content-matched), then the timing-only nodes */
export function fieldGroups(r: NetRequest): { shape: string; nodes: NetNode[] }[] {
  const groups = new Map<string, NetNode[]>();
  for (const n of r.produced ?? []) { const k = n.field ? shapeOf(n.field) : "(appeared after it: timing)"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(n); }
  return [...groups.entries()].map(([shape, nodes]) => ({ shape, nodes })).sort((a, b) => b.nodes.length - a.nodes.length);
}

/** the requests that filled a page node (its selector, or an ancestor's / a descendant's) */
export function requestsFor(view: NetworkView, selector: string): NetRequest[] {
  return view.requests.filter((r) => (r.produced ?? []).some((n) => n.selector === selector || selector.startsWith(`${n.selector} >`) || n.selector.startsWith(`${selector} >`)));
}

export const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };
export const pathOfUrl = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };
export const bytes = (n?: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** the body as readable text: JSON pretty-printed (when it parses) */
export function prettyBody(body: string): { text: string; json: boolean } {
  try { return { text: JSON.stringify(JSON.parse(body), null, 2), json: true }; } catch { return { text: body, json: false }; }
}

/** the plan that reads this request directly (an SPA's API instead of its rendered page) */
export function readItCode(r: NetRequest): string {
  const q = JSON.stringify(r.url);
  return `wq.reference(${q}${r.method && r.method !== "GET" ? `, method=${JSON.stringify(r.method.toLowerCase())}` : ""}).resolve()`;
}

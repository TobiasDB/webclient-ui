/** THE POOL AT A MOMENT: how much of the engine's concurrency a run is using -- browser pages and HTTP clients
 * held against their limits, how many are queued for one, and WHICH step (and item) holds each page, and the
 * page it rendered. Folded from the pool's own events (`resource`, source "pool": leased / released / wait /
 * exhausted, each stamped with the running step + item) and the snapshots that name their lease. */

import type { RunEvent } from "../stages";
import { keyOf, type ItemKey } from "./state";

export type Lease = {
  id: string; kind: string;
  /** the step and item that took it */
  step?: string; item: ItemKey;
  /** when it was taken / given back (event index + time), how long it waited in the queue */
  i: number; t: number; waited: number; end?: { i: number; t: number };
  /** the page it rendered (a snapshot names its lease) */
  doc?: string; url?: string;
};
export type KindAt = { kind: string; limit: number; held: number; waiting: number };
export type PoolAt = {
  kinds: Map<string, KindAt>;
  /** the leases held at the moment, oldest first */
  held: Lease[];
  /** every lease up to the moment (held or given back) */
  all: Lease[];
  /** held / waiting over time, per kind (for a strip): one point per pool event */
  history: Map<string, { t: number; held: number; waiting: number }[]>;
  /** the most queued at once, per kind */
  maxWaiting: Map<string, number>;
};

type PoolDetail = { what?: string; kind?: string; lease?: string; waited?: number; held?: number; waiting?: number; limit?: number };

/** the pool as of event `upto` (exclusive) */
export function poolAt(events: RunEvent[], upto: number = events.length): PoolAt {
  const kinds = new Map<string, KindAt>();
  const leases = new Map<string, Lease>();
  const history = new Map<string, { t: number; held: number; waiting: number }[]>();
  const maxWaiting = new Map<string, number>();
  const n = Math.min(upto, events.length);
  for (let i = 0; i < n; i++) {
    const e = events[i]!;
    if (e.topic === "snapshot") {
      const lid = e.lease as string | undefined; const l = lid ? leases.get(lid) : undefined;
      if (l && !l.doc) { l.doc = e.document_id as string | undefined; l.url = (e.final_url ?? e.url) as string | undefined; }
      continue;
    }
    if (e.topic !== "resource" || e.source !== "pool") continue;
    const d = (e.detail ?? {}) as PoolDetail; const kind = d.kind ?? "page"; const t = Number(e.ts ?? 0);
    const k = kinds.get(kind) ?? { kind, limit: 0, held: 0, waiting: 0 };
    if (d.limit != null) k.limit = d.limit;
    if (d.held != null) k.held = d.held;
    if (d.waiting != null) k.waiting = d.waiting;
    if (d.what === "leased" && d.lease) leases.set(d.lease, { id: d.lease, kind, step: e.step as string | undefined, item: keyOf(e.item), i, t, waited: d.waited ?? 0 });
    if (d.what === "released" && d.lease) { const l = leases.get(d.lease); if (l) l.end = { i, t }; }
    kinds.set(kind, k);
    if (d.what === "leased" || d.what === "released" || d.what === "wait") {
      (history.get(kind) ?? history.set(kind, []).get(kind)!).push({ t, held: k.held, waiting: k.waiting });
      maxWaiting.set(kind, Math.max(maxWaiting.get(kind) ?? 0, k.waiting));
    }
  }
  const all = [...leases.values()];
  return { kinds, held: all.filter((l) => !l.end), all, history, maxWaiting };
}

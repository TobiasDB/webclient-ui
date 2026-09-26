/** TELL: every event in plain words -- what the run did, said once, used everywhere (the page's event card,
 * the events list, tooltips). Show first (the graph, the page, the lanes); this is the caption. */

import type { RunEvent } from "../stages";
import { nodeOf, type PlanModel } from "./plan";

export type Told = { kind: "step" | "result" | "page" | "request" | "action" | "dom" | "error" | "row" | "loop" | "run" | "other"; text: string; detail?: string; bad?: boolean };

const VERB: Record<string, string> = {
  resolve: "open", fetch: "open", select: "find", select_all: "find all", attr: "read", text_content: "read the text of",
  extract: "extract", project: "project the rows", merge: "merge", paginate: "page through", links: "collect the links",
  click: "click", write: "type into", scroll: "scroll", wait_for: "wait for", goto: "go to", filter: "filter", limit: "keep the first",
  number: "read a number from", date: "read a date from", split: "split", step: "then",
};
const q = (v: unknown) => (typeof v === "string" ? `"${v.length > 70 ? `${v.slice(0, 67)}…` : v}"` : JSON.stringify(v)?.slice(0, 80) ?? "");
const path = (u?: string) => (u ?? "").replace(/^https?:\/\/[^/]+/, "") || u || "";

export function tell(e: RunEvent, m: PlanModel | null): Told {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const op = String(d.op ?? "");
  const node = m ? nodeOf(m, (e as { step?: string }).step) : undefined;
  const arg = node?.arg ?? (typeof d.selector === "string" ? d.selector : undefined);
  const topic = e.topic ?? "";
  if (topic === "plan") {
    switch (e.phase) {
      case "started": return { kind: "run", text: "the run starts" };
      case "done": return { kind: "run", text: `the run is done · ${d.rows ?? 0} rows` };
      case "step": return { kind: "step", text: `${VERB[op] ?? op}${arg ? ` ${q(arg)}` : ""}` };
      case "result": {
        if (d.ok === false) return { kind: "result", text: `${VERB[op] ?? op} failed: ${d.error}`, detail: String(d.message ?? ""), bad: true };
        const ms = typeof d.ms === "number" && d.ms >= 1 ? ` · ${Math.round(d.ms)} ms` : "";
        switch (d.kind) {
          case "Document": return { kind: "result", text: `${op === "resolve" || op === "fetch" ? "opened" : "on"} ${path(d.url as string) || "the page"}${ms}` };
          case "Collection": return { kind: "result", text: `${op === "paginate" ? "paged through" : "found"} ${d.n} ${op === "paginate" ? "pages" : "matches"}${ms}` };
          case "Element": return { kind: "result", text: `found the element${arg ? ` ${q(arg)}` : ""}${ms}` };
          case "Row": return { kind: "row", text: `row: ${q(d.preview)}` };
          case "Reference": return { kind: "result", text: `read the link ${path(d.url as string) || q(d.preview)}${ms}` };
          default: return { kind: "result", text: `${op === "attr" || op === "text_content" ? "read" : `${op} →`} ${q(d.preview)}${ms}` };
        }
      }
      case "fanout": return { kind: "step", text: `fans out to ${d.n} ${op === "paginate" ? "pages" : "items"}` };
      case "parallel": return { kind: "step", text: `${d.n} items, up to ${d.limit} at once (${d.bound})` };
      case "item": return { kind: "step", text: `item ${(e.item ?? []).join(".")} ${d.status === "ok" ? "is done" : d.status}`, bad: d.status === "failed" };
      case "row": return { kind: "row", text: `row ${Number(d.index ?? 0) + 1}` };
    }
  }
  const x = e as RunEvent & { url?: string; final_url?: string; method?: string; status_code?: number; elapsed?: number; resource_type?: string; action?: string; args?: Record<string, unknown>; error?: { code?: string; message?: string }; loop?: string; round?: number };
  if (topic === "snapshot") return { kind: "page", text: `the page ${e.phase === "action" ? "after the action" : e.phase === "load" ? "loaded in the browser" : "fetched"}: ${path(x.final_url ?? x.url)}${x.status_code ? ` · ${x.status_code}` : ""}` };
  if (topic.startsWith("network")) {
    const nav = topic === "network.navigation" || x.resource_type === "document";
    return { kind: "request", text: `${nav ? "" : `${x.resource_type ?? "request"}: `}${String(x.method ?? "GET").toUpperCase()} ${path(x.url)}${x.status_code ? ` → ${x.status_code}` : ""}${x.elapsed ? ` · ${Math.round(x.elapsed * 1000)} ms` : ""}`, bad: (x.status_code ?? 200) >= 400 };
  }
  if (topic === "action") return { kind: "action", text: `${VERB[x.action ?? ""] ?? x.action} ${x.args?.selector ? q(x.args.selector) : ""}${x.args?.text ? ` ${q(x.args.text)}` : ""}` };
  if (topic === "rrweb") return { kind: "dom", text: "the page changed (DOM)" };
  if (topic === "error") return { kind: "error", text: `${x.error?.code ?? "error"}`, detail: x.error?.message, bad: true };
  if (topic === "loop") return { kind: "loop", text: `${x.loop} · ${e.phase}${x.round ? ` (round ${x.round})` : ""}` };
  if (topic === "script") return { kind: "other", text: `script ${(e as { script?: string }).script} · ${e.phase}` };
  return { kind: "other", text: `${topic}${e.phase ? ` · ${e.phase}` : ""}` };
}

/** the events that are worth a moment on screen (playing step by step stops at these) */
export const MOMENT = (e: RunEvent) => (e.topic === "plan" && (e.phase === "step" || e.phase === "result")) || e.topic === "action" || e.topic === "snapshot" || e.topic === "error" || e.topic === "network.navigation";

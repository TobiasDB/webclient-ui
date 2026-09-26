/** The plan IR as the UI's model: exactly what `/plan` and `/execute` take, so what you see
 * is what runs. Steps are `get`/`call` pairs; a call's args / kwargs are `{value}` or
 * `{plan}` (a sub-plan, e.g. one extract field's chain, rooted at the element). Helpers
 * pair them into CALLS, address a call by a PATH into the nested plans, and evaluate the
 * document ops locally in a rebuilt page (the preview -- no round trips). */

export type Arg = { value?: unknown; plan?: Plan };
export type Step = { kind: "get" | "call" | "op"; name: string; args?: Arg[]; kwargs?: Record<string, Arg> };
export type Plan = { root: "Reference" | "Document"; steps: Step[]; session_id?: string | null; source?: unknown; version?: number };

/** One `.name(args, kwargs)` of a chain, with where it sits (the index of its `get` step). */
export type Call = { name: string; args: Arg[]; kwargs: Record<string, Arg>; index: number };

export function calls(p: Plan): Call[] {
  const out: Call[] = [];
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i]!;
    if (s.kind === "get") {
      const nxt = p.steps[i + 1];
      if (nxt && nxt.kind === "call") { out.push({ name: s.name, args: nxt.args ?? [], kwargs: nxt.kwargs ?? {}, index: i }); i++; }
      else out.push({ name: s.name, args: [], kwargs: {}, index: i }); // a property (e.g. `.count`)
    }
  }
  return out;
}

export const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Step[] => [
  { kind: "get", name },
  { kind: "call", name, args: args.map((v) => ({ value: v })), kwargs: Object.fromEntries(Object.entries(kwargs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v }])) },
];
export const v = (a: Arg | undefined): unknown => a?.value;

/** A PATH into nested plans: [callIndex] at the root, or [callIndex, "kw:<field>", callIndex, …]
 * descending into an extract field's sub-plan (or "arg:<i>" into a positional sub-plan). */
export type Path = (number | string)[];

export function planAt(p: Plan, path: Path): Plan {
  let cur = p;
  for (let i = 0; i < path.length; i += 2) {
    const idx = path[i] as number; const key = path[i + 1] as string | undefined;
    if (key === undefined) break;
    const c = calls(cur)[idx]; if (!c) return cur;
    const arg = key.startsWith("kw:") ? c.kwargs[key.slice(3)] : c.args[Number(key.slice(4))];
    if (!arg?.plan) return cur;
    cur = arg.plan;
  }
  return cur;
}

/** Rebuild `p` with `plan` replaced at `path` (a nested plan address ending in a key). */
export function withPlanAt(p: Plan, path: Path, plan: Plan): Plan {
  if (path.length < 2) return plan;
  const [idx, key, ...rest] = path as [number, string, ...Path];
  const cs = calls(p); const c = cs[idx]; if (!c) return p;
  const steps = p.steps.slice();
  const callStep = steps[c.index + 1]; if (!callStep || callStep.kind !== "call") return p;
  const nc: Step = { ...callStep, args: (callStep.args ?? []).map((a) => ({ ...a })), kwargs: Object.fromEntries(Object.entries(callStep.kwargs ?? {}).map(([k, a]) => [k, { ...a }])) };
  const inner = key.startsWith("kw:") ? nc.kwargs![key.slice(3)] : nc.args![Number(key.slice(4))];
  if (!inner) return p;
  inner.plan = rest.length ? withPlanAt(inner.plan ?? { root: "Document", steps: [] }, rest, plan) : plan;
  steps[c.index + 1] = nc;
  return { ...p, steps };
}

/** Insert `add` steps into the chain at `path` (a plan address) before call `at` (or at the end). */
export function insertCalls(p: Plan, at: Path, add: Step[], before?: number): Plan {
  const target = planAt(p, at);
  const cs = calls(target);
  const pos = before == null || before >= cs.length ? target.steps.length : cs[before]!.index;
  const steps = [...target.steps.slice(0, pos), ...add, ...target.steps.slice(pos)];
  return withPlanAt(p, at, { ...target, steps });
}

export function removeCall(p: Plan, at: Path, idx: number): Plan {
  const target = planAt(p, at); const c = calls(target)[idx]; if (!c) return p;
  const n = target.steps[c.index + 1]?.kind === "call" ? 2 : 1;
  return withPlanAt(p, at, { ...target, steps: [...target.steps.slice(0, c.index), ...target.steps.slice(c.index + n)] });
}

export function updateCall(p: Plan, at: Path, idx: number, fn: (c: Call) => Call): Plan {
  const target = planAt(p, at); const c = calls(target)[idx]; if (!c) return p;
  const nc = fn(c);
  const n = target.steps[c.index + 1]?.kind === "call" ? 2 : 1;
  const steps = [...target.steps.slice(0, c.index), { kind: "get" as const, name: nc.name }, { kind: "call" as const, name: nc.name, args: nc.args, kwargs: nc.kwargs }, ...target.steps.slice(c.index + n)];
  return withPlanAt(p, at, { ...target, steps });
}

export function moveCall(p: Plan, at: Path, idx: number, dir: -1 | 1): Plan {
  const target = planAt(p, at); const cs = calls(target); const j = idx + dir;
  if (!cs[idx] || !cs[j]) return p;
  const order = cs.map((_, i) => i); [order[idx], order[j]] = [order[j]!, order[idx]!];
  const steps = order.flatMap((i) => { const c = cs[i]!; const n = target.steps[c.index + 1]?.kind === "call" ? 2 : 1; return target.steps.slice(c.index, c.index + n); });
  return withPlanAt(p, at, { ...target, steps });
}

/** A readable one-liner (like the service's describe). */
export function describe(p: Plan): string {
  const fmt = (a: Arg): string => a.plan ? describe(a.plan) : JSON.stringify(a.value);
  return `${p.root}.` + calls(p).map((c) => `${c.name}(${[...c.args.map(fmt), ...Object.entries(c.kwargs).map(([k, a]) => `${k}=${fmt(a)}`)].join(", ")})`).join(".");
}

// -- the local evaluator: document ops in a rebuilt page ----------------------------------
export type Local = { rows: Record<string, unknown>[]; count: number; note?: string };

const text = (el: Element) => (el.textContent || "").trim();
/** an element of the page (the page is in an iframe: another realm, so no instanceof) */
const isEl = (x: unknown): x is Element => !!x && typeof x === "object" && (x as Node).nodeType === 1;
/** A Python-style pattern as a JS RegExp (a leading inline `(?i)` becomes the `i` flag). */
export function pyRegex(pattern: string): RegExp { const m = /^\(\?([aiLmsux]+)\)/.exec(pattern); return m ? new RegExp(pattern.slice(m[0].length), m[1]!.includes("i") ? "i" : "") : new RegExp(pattern); }
const WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");
/** Field.number(): the first number in the text, else a number word ("Three" -> 3). */
export function toNumber(v: unknown, dflt: unknown = null): unknown {
  if (typeof v === "number") return v; if (typeof v === "boolean") return Number(v);
  const t = String(v ?? ""); const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(t);
  if (m) { const raw = m[0].replace(/,/g, ""); return Number(raw); }
  for (const w of t.match(/[A-Za-z]+/g) ?? []) { const i = WORDS.indexOf(w.toLowerCase()); if (i >= 0) return i; }
  return dflt;
}
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const pad = (n: number) => String(n).padStart(2, "0");
/** Field.date() / .datetime() (the same readings as the package, for the preview): ISO, written
 * (18 Sep 2026, Sep 18, 2026), numeric (dayfirst), relative (today, 3 days ago); ISO out. */
export function toWhen(v: unknown, opts: { dayfirst?: boolean; time?: boolean } = {}, dflt: unknown = null): unknown {
  const t = String(v ?? "").replace(/\s+/g, " ").trim(); if (!t) return dflt;
  const out = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, tz = "") => { if (m < 1 || m > 12 || d < 1 || d > 31) return dflt; return opts.time ? `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${tz}` : `${y}-${pad(m)}-${pad(d)}`; };
  const clock = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(t);
  const hms = (): [number, number, number] => { if (!clock) return [0, 0, 0]; let h = Number(clock[1]); const ap = (clock[4] ?? "").toLowerCase().replace(/\./g, ""); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; return [h, Number(clock[2]), Number(clock[3] ?? 0)]; };
  let m = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/.exec(t);
  if (m) return out(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7] ? (m[7] === "Z" ? "+00:00" : m[7]) : "");
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  m = new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + mon + ",?\\s+(\\d{4})", "i").exec(t); if (m) return out(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)) + 1, +m[1]!, ...hms());
  m = new RegExp(mon + "\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})", "i").exec(t); if (m) return out(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)) + 1, +m[2]!, ...hms());
  m = /\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/.exec(t); if (m) return out(+m[1]!, +m[2]!, +m[3]!, ...hms());
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(t); if (m) { const a = +m[1]!, b = +m[2]!; let y = +m[3]!; if (y < 100) y += 2000; const [d, mo] = opts.dayfirst || a > 12 ? [a, b] : [b, a]; return out(y, mo, d, ...hms()); }
  const now = new Date(); const low = t.toLowerCase();
  for (const [w, dd] of [["today", 0], ["yesterday", -1], ["tomorrow", 1]] as const) if (new RegExp(`\\b${w}\\b`).test(low)) { const x = new Date(now.getTime() + dd * 86400000); return out(x.getFullYear(), x.getMonth() + 1, x.getDate(), ...hms()); }
  m = /\b(\d+|an?|one)\s+(second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago\b/.exec(low);
  if (m) { const u: Record<string, number> = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 }; const n = /^\d+$/.test(m[1]!) ? +m[1]! : 1; const x = new Date(now.getTime() - n * u[m[2]!]! * 1000); return out(x.getFullYear(), x.getMonth() + 1, x.getDate(), x.getHours(), x.getMinutes(), x.getSeconds()); }
  return dflt;
}
/** Does a read look like a date (so the suggestions offer it as one)? */
export const looksLikeDate = (v: string) => toWhen(v) !== null && !/^\d+(\.\d+)?$/.test(v.trim());
/** Field.map(mapping): the value looked up (case-insensitive for text). */
export function mapValue(v: unknown, mapping: Record<string, unknown>, dflt: unknown = null): unknown {
  const k = String(v ?? ""); if (k in mapping) return mapping[k];
  const low = Object.fromEntries(Object.entries(mapping).map(([a, b]) => [a.toLowerCase(), b])); return k.trim().toLowerCase() in low ? low[k.trim().toLowerCase()] : dflt;
}
function attrOf(el: Element, name: string, pattern?: string): unknown {
  let val: unknown = name === "text" ? text(el) : name === "text:own" ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim()).join(" ").trim()
    : name === "html" ? el.innerHTML : name === "count" ? el.children.length : name === "href" || name === "src" || name === "action" ? el.getAttribute(name) : el.getAttribute(name);
  if (pattern && typeof val === "string") { try { const m = pyRegex(pattern).exec(val); val = m ? (m[1] ?? m[0]) : null; } catch { /* keep */ } }
  return val;
}

/** Evaluate a Document-rooted chain on `el` (the record, or the page's body): returns the
 * value the chain yields (a row dict after extract/project, a scalar after attr, an element
 * list after select_all). IO calls (resolve / follow) yield `followed` for that href -- the
 * caller substitutes a loaded page's rows when it has one. */
export function evalLocal(p: Plan, el: Element, followed: (href: string, sub: Plan) => unknown = (h) => `→ ${h}`): unknown {
  let cur: unknown = el;
  const cs = calls(p);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!; const a0 = v(c.args[0]);
    const optional = !!v(c.kwargs.optional);
    if (c.name === "select") { const base = cur as Element | null; let found: Element | null = null; try { found = base?.querySelector(String(a0)) ?? null; } catch { found = null; } if (!found && !optional) return null; cur = found; }
    else if (c.name === "select_all") { const base = cur as Element | null; let found: Element[] = []; try { found = base ? [...base.querySelectorAll(String(a0))] : []; } catch { found = []; } const lim = v(c.kwargs.limit); cur = typeof lim === "number" ? found.slice(0, lim) : found; }
    else if (c.name === "attr") { if (Array.isArray(cur)) cur = (cur as Element[]).map((e) => attrOf(e, String(a0), v(c.args[1]) as string | undefined)); else if (cur) cur = attrOf(cur as Element, String(a0), v(c.args[1]) as string | undefined); else cur = null;
      // a followed page: attr("href").resolve()… -> the rest of the chain runs there
      const nxt = cs[i + 1]; if (nxt?.name === "resolve" && (a0 === "href" || a0 === "src")) { const rest: Plan = { root: "Document", steps: p.steps.slice(cs[i + 2]?.index ?? p.steps.length) }; return followed(String(cur), rest); } }
    else if (c.name === "limit") { if (Array.isArray(cur)) cur = (cur as unknown[]).slice(0, Number(a0)); }
    else if (c.name === "extract") {
      const one = (e: Element) => {
        // plain named columns first, then the aliased ones (positional or named): an alias can read an
        // earlier column (field("x") -- that column is consumed) or the page
        const row: Record<string, unknown> = {}; const aliased: Plan[] = []; const consumed: string[] = [];
        for (const [k, a] of Object.entries(c.kwargs)) { if (a.plan && calls(a.plan).some((x) => x.name === "alias")) aliased.push(a.plan); else row[k] = a.plan ? evalLocal(a.plan, e, followed) : v(a); }
        for (const a of c.args) if (a.plan) aliased.push(a.plan);
        for (const p0 of aliased) {
          const { value, name } = splitAlias(p0); const ref = name && typeof name === "object" ? fieldRef(name as Plan) : null;
          let key: string;
          if (ref !== null && ref in row) { key = String(row[ref] ?? "").trim() || ref; consumed.push(ref); }
          else key = name && typeof name === "object" ? String(evalLocal(name as Plan, e, followed) ?? "").trim() || "field" : String(name ?? "field");
          row[key] = evalLocal(value, e, followed);
        }
        for (const r of consumed) delete row[r];
        return row;
      };
      cur = Array.isArray(cur) ? (cur as Element[]).map(one) : cur ? one(cur as Element) : null;
    }
    else if (c.name === "project") { /* rows already dicts */ }
    else if (c.name === "alias") { /* the column's name rides on the chain; extract reads it */ }
    else if (c.name === "date" || c.name === "datetime") { const o = { dayfirst: !!v(c.kwargs.dayfirst), time: c.name === "datetime" }; cur = Array.isArray(cur) ? (cur as unknown[]).map((x) => toWhen(x, o)) : toWhen(cur, o); }
    else if (c.name === "number") { cur = Array.isArray(cur) ? (cur as unknown[]).map((x) => toNumber(x, v(c.args[0]) ?? null)) : toNumber(cur, v(c.args[0]) ?? null); }
    else if (c.name === "map") { const mp = (v(c.args[0]) ?? {}) as Record<string, unknown>; cur = Array.isArray(cur) ? (cur as unknown[]).map((x) => mapValue(x, mp, v(c.args[1]) ?? null)) : mapValue(cur, mp, v(c.args[1]) ?? null); }
    else if (c.name === "merge") { cur = Array.isArray(cur) ? Object.assign({}, ...(cur as unknown[]).filter((r) => r && typeof r === "object" && !(isEl(r)))) : cur; }
    else if (c.name === "count") { cur = Array.isArray(cur) ? (cur as unknown[]).length : cur ? (cur as Element).children.length : 0; }
    else if (["resolve", "click", "write", "scroll", "wait_for", "goto", "paginate", "reload"].includes(c.name)) { /* IO: the page is what the server made of it */ }
    else return null;
  }
  return cur;
}

/** A positional extract column split at its `.alias(name)`: the value chain and the name (a
 * literal, or a sub-plan read off the element). */
export function splitAlias(p: Plan): { value: Plan; name: unknown } {
  const cs = calls(p);
  for (let i = cs.length - 1; i >= 0; i--) if (cs[i]!.name === "alias") { const a = cs[i]!.args[0]; return { value: { root: p.root, steps: p.steps.slice(0, cs[i]!.index) }, name: a?.plan ?? a?.value }; }
  return { value: p, name: undefined };
}

/** The column a name plan refers to when it is exactly `field("x")`, else null. */
export function fieldRef(p: Plan): string | null { const cs = calls(p); return cs.length === 1 && cs[0]!.name === "field" && typeof cs[0]!.args[0]?.value === "string" ? (cs[0]!.args[0]!.value as string) : null; }

/** The chain's rows on a page: the root's first `select_all` fans out; without one, the page is one row. */
export function localRows(p: Plan, doc: Document, followed?: (href: string, sub: Plan) => unknown): Local {
  const cs = calls(p);
  const fan = cs.findIndex((c) => c.name === "select_all");
  if (fan < 0) {  // the page is one row: a dict as is, a scalar / list as {value}
    const out = evalLocal({ root: "Document", steps: p.steps }, doc.body, followed);
    if (out == null || isEl(out) || calls(p).length === 0) return { rows: [], count: 1 };
    return { rows: [out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : { value: Array.isArray(out) ? (out as unknown[]).map((x) => (isEl(x) ? text(x) : x)) : out }], count: 1 };
  }
  const out = evalLocal({ root: "Document", steps: p.steps.slice(cs[fan]!.index) }, doc.body, followed);
  const rows = Array.isArray(out) ? (out as unknown[]).map((r) => (r && typeof r === "object" && !(isEl(r)) ? (r as Record<string, unknown>) : { value: isEl(r) ? text(r) : r })) : [];
  let count = 0; try { count = doc.querySelectorAll(String(v(cs[fan]!.args[0]))).length; } catch { /* bad selector */ }
  return { rows, count };
}

/** The record selector (the first select_all) and the extract fields of a chain, for highlights. */
export function shape(p: Plan): { record?: string; fields: { name: string; selector?: string; follow?: boolean; optional?: boolean; dynamic?: boolean }[]; actions: Call[]; paginate?: Call } {
  const cs = calls(p);
  const rec = cs.find((c) => c.name === "select_all");
  const ex = cs.find((c) => c.name === "extract");
  const fieldOf = (name: string, plan: Plan | undefined, dynamic = false) => { const sub = plan ? calls(plan) : []; const sel = sub.find((c) => c.name === "select" || c.name === "select_all"); return { name, selector: sel ? String(v(sel.args[0])) : undefined, follow: sub.some((c) => c.name === "resolve"), optional: !!(sel && v(sel.kwargs.optional)), dynamic }; };
  const fields = ex ? [
    ...ex.args.filter((a) => a.plan).map((a) => { const { value, name } = splitAlias(a.plan!); return fieldOf(typeof name === "string" ? name : name && typeof name === "object" ? `= ${describe(name as Plan).replace(/^Document\./, "")}` : "field", value, typeof name === "object"); }),
    ...Object.entries(ex.kwargs).map(([name, a]) => fieldOf(name, a.plan)),
  ] : [];
  return { record: rec ? String(v(rec.args[0])) : undefined, fields, actions: cs.filter((c) => ["click", "write", "scroll", "wait_for", "goto"].includes(c.name)), paginate: cs.find((c) => c.name === "paginate") };
}

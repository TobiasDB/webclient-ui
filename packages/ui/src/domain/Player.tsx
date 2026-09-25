import "rrweb/dist/style.css";
import * as React from "react";
import { cn } from "../lib/cn";
import { MediaBar } from "./MediaBar";
import { PlayerController } from "./PlayerController";
import { humanMousePath, mouseDurationMs, pathTimingsMs } from "../lib/mouse";
import { topicColorVar } from "./TopicChip";

/** One rrweb event (a DOM event, or one of ours as a custom event tagged with its topic). */
export type RREvent = { type: number; data: any; timestamp: number };

export type Highlight = { selector: string; label?: string; tone?: "accent" | "ok" | "warn" | "field" | "bad"; colour?: string; key?: string; dashed?: boolean; /** query inside this element (the focus root) instead of the page; `selector: ":scope"` outlines the root itself */ root?: Element | null; /** explicit elements instead of a selector */ els?: Element[] };
export type Pick = { path: string; selector: string; tag: string; classes: string[]; id?: string; text: string; attrs: Record<string, string>; href?: string; /** the element itself (in the rebuilt page) */ el?: Element };
type Box = { left: number; top: number; width: number; height: number; label?: string; colour: string; dashed?: boolean };
type Pulse = { id: number; at: number; topic: string; text: string; tone: string };

export type PlayerProps = {
  /** The whole run as rrweb events (`/traces/{id}/rrweb`), or a page as Meta + FullSnapshot
   * (the `snapshot` tool with `include: ["rrweb"]`), or a live page's stream (`live`). */
  events: RREvent[];
  /** Live mode: the stream grows; new events are appended as `events` changes. */
  live?: boolean;
  /** Elements to outline inside the page. */
  highlights?: Highlight[];
  /** Pick mode: hover shows the element under the mouse (tag.class), click reports it. */
  pickable?: boolean;
  /** a click on an element: the pick, and where it was (px inside the player's page area) */
  onPick?: (pick: Pick, at: { x: number; y: number }) => void;
  onHover?: (pick: Pick | null) => void;
  /** pick with SHIFT-click only; a plain click goes through to the page (`onClickThrough`) */
  shiftPick?: boolean;
  onClickThrough?: (pick: Pick, mods: { shift: boolean }) => void;
  /** render only these elements (their ancestors keep their styling; everything else is hidden) */
  focus?: Element | Element[] | null;
  /** Seek to an absolute timestamp (ms since epoch) when it changes. */
  seekTo?: number | null;
  /** The player's clock (absolute ms), as it plays or is scrubbed. */
  onTime?: (ms: number) => void;
  /** One of our events reached during playback. */
  onEvent?: (topic: string, payload: Record<string, unknown>) => void;
  /** The rebuilt page's document (after every full snapshot): the query builder evaluates
   * selectors in it locally -- no round trips while picking. */
  onDocument?: (doc: Document) => void;
  /** The docked media bar (default on). Pass `controls={false}` + a `controller` to put a
   * MediaBar elsewhere (pinned to the window) -- it stays in sync through the controller. */
  controls?: boolean;
  controller?: PlayerController;
  /** Story pace: the minimum gap (ms, at 1x) between consecutive events of the run. A real
   * run fires its events milliseconds apart -- unwatchable; re-timing them onto a beat makes
   * the replay followable. 0 = the recorded timing. Default 900. */
  pace?: number;
  autoPlay?: boolean;
  className?: string;
  /** Max height of the viewport area (the page scales to fit width, then this). */
  maxHeight?: number;
  /** the event cards over the page (a request, an action, a loop round); off where another view shows them */
  pulses?: boolean;
  /** keep this element (in the rebuilt page) in view -- scrolled within the replay, never the page around it */
  scrollTo?: Element | null;
};

export const FIELD_COLOURS = ["#2457e6", "#15803d", "#b45309", "#7c3aed", "#0f766e", "#be185d"];
export const fieldColour = (i: number) => FIELD_COLOURS[i % FIELD_COLOURS.length]!;
const TONE: Record<NonNullable<Highlight["tone"]>, string> = { accent: "#2457e6", ok: "#15803d", warn: "#b45309", field: "#7c3aed", bad: "#b91c1c" };

/** THE player: one component for replay, live pages and the query builder's preview.
 * rrweb's Replayer rebuilds the DOM (mouse cursor + tail, smooth scroll, inputs); every
 * other event of the run is a marker on our own media bar and an animation on the page
 * (network pulses, action flashes); the highlight overlay outlines selectors and, in pick
 * mode, reports the element under the mouse with its classes. The page always renders
 * at the recorded viewport and is scaled to fit -- no reflow between documents. */
const NO_HIGHLIGHTS: Highlight[] = [];

/** where OUR pointer last was, in the page's DOCUMENT coordinates -- kept across remounts (a live
 * page restarts its mirror on every navigation / step), so the pointer always moves on from there */
let lastPointer: { x: number; y: number } | null = null;

/** scroll the REBUILT page's own window to an element -- never `scrollIntoView`: the mirror's frame is
 * same-origin, so that also scrolls every ancestor (the workspace jumped whenever a line was focused) */
function scrollWithin(el: Element, block: "start" | "center"): void {
  const w = el.ownerDocument.defaultView; if (!w) return;
  const r = el.getBoundingClientRect();
  const top = w.scrollY + r.top - (block === "center" ? Math.max(0, (w.innerHeight - r.height) / 2) : 0);
  w.scrollTo({ top: Math.max(0, top), left: w.scrollX });
}

export function Player({ events: rawEvents, live = false, highlights = NO_HIGHLIGHTS, pickable = false, onPick, onHover, shiftPick = false, onClickThrough, focus = null, seekTo, onTime, onEvent, onDocument, controls = true, controller, autoPlay = false, pulses: showPulses = true, scrollTo = null, className, maxHeight = 720, pace: paceProp = 900 }: PlayerProps) {
  const ownCtl = React.useMemo(() => new PlayerController(), []);
  const ctl = controller ?? ownCtl;
  const [pace, setPace] = React.useState(paceProp);
  // the re-timed stream (the story pace) and the map back to the recorded clock
  const { events, toRecorded, toPaced } = React.useMemo(() => paceEvents(rawEvents, live ? 0 : pace), [rawEvents, pace, live]);
  const host = React.useRef<HTMLDivElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const rep = React.useRef<any>(null);
  const appended = React.useRef(0);
  const cbs = React.useRef({ onTime, onEvent, onPick, onHover, onDocument, onClickThrough });
  cbs.current = { onTime, onEvent, onPick, onHover, onDocument, onClickThrough };
  const refreshRef = React.useRef<() => void>(() => {});
  const toRecordedRef = React.useRef<(ms: number) => number>((ms) => ms);
  toRecordedRef.current = toRecorded;
  const [size, setSize] = React.useState({ w: 1280, h: 800 });
  const [scale, setScale] = React.useState(1);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [skip, setSkip] = React.useState(true);
  const [time, setTime] = React.useState(0); // offset ms
  const [meta, setMeta] = React.useState({ startTime: 0, endTime: 0, totalTime: 0 });
  const [boxes, setBoxes] = React.useState<Box[]>([]);
  const [hover, setHover] = React.useState<Box | null>(null);
  const [pulses, setPulses] = React.useState<Pulse[]>([]);
  const [flash, setFlash] = React.useState<Box[]>([]);
  // the pointer lives in DOCUMENT coordinates (it stays on its target as the rebuilt page scrolls);
  // it is drawn at document - scroll
  const [cursor, setCursor] = React.useState<{ x: number; y: number; down: boolean } | null>(lastPointer ? { ...lastPointer, down: false } : null);
  const cursorAnim = React.useRef(0);
  const liveClock = React.useRef<{ baseline: number; t0: number } | null>(null);
  /** add a live event stamped no later than the replay clock's now (it applies at once, order kept) */
  const liveAdd = (r: { addEvent: (e: unknown) => void }, e: { timestamp: number }) => {
    const c = liveClock.current; const now = c ? c.baseline + (performance.now() - c.t0) : e.timestamp;
    try { r.addEvent(e.timestamp > now ? { ...e, timestamp: now } : e); } catch { /* a malformed chunk */ }
  };
  const cursorPos = React.useRef<{ x: number; y: number } | null>(lastPointer);
  const [scrollXY, setScrollXY] = React.useState<[number, number]>([0, 0]);
  const [ready, setReady] = React.useState(false);
  const staticOnly = !live && events.length <= 2;

  // -- build the replayer once per stream --------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    let r: any = null;
    let raf = 0;
    setReady(false);
    (async () => {
      const mod: any = await import("rrweb");
      if (cancelled || !root.current) return;
      root.current.innerHTML = "";
      const Replayer = mod.Replayer;
      if (events.length < 2) return; // live: wait for the Meta + FullSnapshot pair
      // live: rrweb's documented form -- an EMPTY replayer started at the recording's first moment, every
      // event ADDED (a replayer built from the first batch and started "now" drops that batch's updates
      // stamped before now: content a page fetched right after load never showed)
      r = new Replayer(live ? [] : events, {
        root: root.current, speed, skipInactive: skip, showWarning: false, showDebug: false, liveMode: live,
        insertStyleRules: ["html { scroll-behavior: smooth !important; }"],
        mouseTail: false,
        UNSAFE_replayCanvas: false,
      });
      rep.current = r;
      appended.current = live ? 0 : events.length;
      r.on("resize", (d: { width: number; height: number }) => setSize({ w: d.width, h: d.height }));
      r.on("fullsnapshot-rebuilded", () => { setReady(true); refreshRef.current(); const d = r.iframe?.contentDocument; if (d) cbs.current.onDocument?.(d); });
      r.on("custom-event", (e: any) => {
        const tag = String(e?.data?.tag ?? ""); const payload = (e?.data?.payload ?? {}) as Record<string, unknown>;
        cbs.current.onEvent?.(tag, payload);
        if (tag.startsWith("network")) pulse(tag, `${String(payload.method ?? "GET").toUpperCase()} ${short(String(payload.url ?? ""))}${payload.status_code ? ` → ${payload.status_code}` : ""}`);
        if (tag === "action") {
          const args = (payload.args ?? {}) as { selector?: string; from?: number[]; to?: number[] };
          pulse(tag, `${payload.action}${args.selector ? ` ${args.selector}` : ""}`);
          if (args.selector) flashSelector(String(args.selector));
          if (payload.action === "click" || payload.action === "write") { const w = doc()?.defaultView; const target = (args.selector ? centreOf(String(args.selector)) : undefined) ?? (args.to ? [args.to[0]! + (w?.scrollX ?? 0), args.to[1]! + (w?.scrollY ?? 0)] : undefined); moveCursor(undefined, target, true); }
        }
        if (tag === "plan" && payload.phase === "step") {
          const d = (payload.detail ?? {}) as { op?: string; selector?: string };
          if (d.selector && ["select", "select_all", "attr", "text_content", "extract", "click", "write", "wait_for", "scroll"].includes(String(d.op))) {
            flashSelector(d.selector, d.op === "attr" || d.op === "text_content" ? "#7c3aed" : "#2457e6", `${d.op} ${d.selector}`);
            moveCursor(undefined, centreOf(d.selector), false); // the pointer goes wherever the run looked
          }
        }
        if (tag === "error") pulse(tag, String((payload.error as any)?.code ?? "error"));
        if (tag === "loop" || tag === "pipeline") pulse(tag, `${payload.loop ?? payload.pipeline} · ${payload.phase}`);
      });
      r.on("finish", () => setPlaying(false));
      r.on("state-change", (s: any) => { if (s?.player?.value) setPlaying(s.player.value === "playing"); });
      const m = live ? { startTime: events[0]!.timestamp, endTime: events[events.length - 1]!.timestamp, totalTime: 0 } : r.getMetaData(); setMeta(m);
      if (live) {
        // the clock starts at the recording's first moment (earlier stamps would be dropped); it then runs
        // BEHIND the page by however late the mirror opened -- so every event is added stamped no later than
        // the clock's NOW (see liveAdd): it applies the moment it arrives, in order, no lag
        const baseline = events[0]!.timestamp - 500; r.startLive(baseline); setPlaying(true);
        liveClock.current = { baseline, t0: performance.now() };
        for (const e of events) liveAdd(r, e);
        appended.current = events.length;
      }
      else if (autoPlay) { r.play(0); setPlaying(true); }
      else r.pause(0);
      const tick = () => { if (!rep.current) return; const t = rep.current.getCurrentTime(); setTime(t); cbs.current.onTime?.(toRecordedRef.current(m.startTime + t)); refreshRef.current(); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); try { r?.destroy?.(); } catch { /* gone */ } rep.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live ? (events.length >= 2 ? "live" : "waiting") : events]);

  // live: append what arrived since the last render
  React.useEffect(() => {
    if (!live || !rep.current) return;
    for (let i = appended.current; i < events.length; i++) liveAdd(rep.current, events[i]!);
    appended.current = events.length;
  }, [events, live]);

  React.useEffect(() => { rep.current?.setConfig?.({ speed }); }, [speed]);
  React.useEffect(() => { rep.current?.setConfig?.({ skipInactive: skip }); }, [skip]);
  React.useEffect(() => { if (seekTo == null || !rep.current || live) return; const off = Math.max(0, toPaced(seekTo) - meta.startTime); if (Math.abs(off - rep.current.getCurrentTime()) > 30) { rep.current.pause(off); setTime(off); } }, [seekTo, meta.startTime, live, toPaced]);

  // -- scale to fit --------------------------------------------------------------
  React.useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const fit = () => { const w = el.clientWidth || size.w; const s = Math.min(w / size.w, maxHeight / size.h); setScale(s); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [size, maxHeight]);

  // -- overlay: highlights, hover, action flashes --------------------------------
  const doc = () => rep.current?.iframe?.contentDocument as Document | undefined;
  const boxFor = (el: Element, colour: string, label?: string, dashed = false): Box => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), colour, label, dashed }; };
  const refreshBoxes = React.useCallback(() => {
    const d = doc(); if (!d) return;
    const out: Box[] = [];
    for (const h of highlights) {
      let els: Element[] = []; try { els = h.els ? h.els : h.root ? (h.selector === ":scope" ? [h.root] : [...h.root.querySelectorAll(h.selector)]) : [...d.querySelectorAll(h.selector)]; } catch { continue; }
      const colour = h.colour ?? TONE[h.tone ?? "accent"];
      els.forEach((el, i) => out.push(boxFor(el, colour, i === 0 ? (h.label ? `${h.label}${els.length > 1 && !h.label.includes("×") ? ` ×${els.length}` : ""}` : undefined) : undefined, !!h.dashed)));
    }
    setBoxes((prev) => (prev.length === out.length && prev.every((b, i) => b.left === out[i]!.left && b.top === out[i]!.top && b.width === out[i]!.width && b.height === out[i]!.height && b.label === out[i]!.label)) ? prev : out);
  }, [highlights]);
  refreshRef.current = refreshBoxes;
  React.useEffect(() => { refreshBoxes(); }, [refreshBoxes, scale, ready]);
  React.useEffect(() => { const d = doc(); if (!d) return; const h = () => { refreshBoxes(); const w = d.defaultView; if (w) setScrollXY([w.scrollX, w.scrollY]); }; h(); d.addEventListener("scroll", h, true); return () => d.removeEventListener("scroll", h, true); }, [refreshBoxes, ready]);
  const flashSelector = (sel: string, colour = "#b45309", label = "action") => { const d = doc(); if (!d) return; let els: Element[] = []; try { els = [...d.querySelectorAll(sel)].slice(0, 12); } catch { return; } const fb = els.map((el, i) => boxFor(el, colour, i === 0 ? label : undefined)); setFlash(fb); setTimeout(() => setFlash([]), 1100); };
  /** the centre of a selector's first match, in page coordinates (what the driver aimed at) */
  const centreOf = (sel: string): number[] | undefined => {
    const d = doc(); if (!d) return undefined; let el: Element | null = null; try { el = d.querySelector(sel); } catch { return undefined; } if (!el) return undefined;
    if (!live) { try { scrollWithin(el, "center"); } catch { /* fine */ } }  // live: the page's own scroll arrives in the stream
    const r = el.getBoundingClientRect(); const w = d.defaultView;
    return [r.left + r.width / 2 + (w?.scrollX ?? 0), r.top + r.height / 2 + (w?.scrollY ?? 0)];  // DOCUMENT coordinates
  };
  /** OUR pointer: drawn along the same human path the driver took (from/to on the event, or
   * from where it last was to the target) -- nothing is recorded; both sides compute it. */
  const moveCursor = (_from: number[] | undefined, to: number[] | undefined, click: boolean) => {
    if (!to) return;
    // ALWAYS from where our pointer last was (never the event's idea of it: the two drift apart, and a
    // restarted mirror would jump back to a resting spot); the first move starts mid-view
    const w = doc()?.defaultView;
    const start = cursorPos.current ? [cursorPos.current.x, cursorPos.current.y] : [size.w * 0.55 + (w?.scrollX ?? 0), size.h * 0.45 + (w?.scrollY ?? 0)];
    const pts = humanMousePath(start[0]!, start[1]!, to[0]!, to[1]!);
    const dist = Math.hypot(to[0]! - start[0]!, to[1]! - start[1]!);
    const times = pathTimingsMs(pts.length, mouseDurationMs(dist) / Math.max(0.25, speed));
    cancelAnimationFrame(cursorAnim.current);
    const t0 = performance.now();
    const step = () => {
      const el = performance.now() - t0; let i = 0; while (i < times.length - 1 && times[i + 1]! <= el) i++;
      const [x, y] = pts[i]!; setCursor({ x, y, down: false }); cursorPos.current = { x, y }; lastPointer = { x, y };
      if (i < pts.length - 1) cursorAnim.current = requestAnimationFrame(step);
      else if (click) { setCursor({ x, y, down: true }); setTimeout(() => setCursor((c) => (c ? { ...c, down: false } : c)), 260); }
    };
    cursorAnim.current = requestAnimationFrame(step);
  };
  /** the reader scrolls the rebuilt page by hand (rrweb's frame takes no pointer events) */
  // a NATIVE, non-passive wheel listener: the page inside scrolls, and the wheel never
  // reaches the workspace around it (React's synthetic wheel handler is passive, so it
  // could not preventDefault -- the two scrolls were coupled)
  React.useEffect(() => {
    const h = host.current; if (!h) return;
    const onWheel = (e: WheelEvent) => { const d = doc(); if (!d) return; e.preventDefault(); e.stopPropagation(); (d.scrollingElement ?? d.documentElement).scrollBy({ left: e.deltaX, top: e.deltaY }); refreshRef.current(); };
    h.addEventListener("wheel", onWheel, { passive: false });
    return () => h.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pulse = (topic: string, text: string) => { if (!showPulses) return; const id = Date.now() + Math.random(); setPulses((p) => [...p.slice(-5), { id, at: Date.now(), topic, text, tone: topicColorVar(topic) }]); setTimeout(() => setPulses((p) => p.filter((x) => x.id !== id)), 2600); };

  const pickAt = (e: React.MouseEvent): Pick | null => {
    const d = doc(); if (!d) return null;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
    const el = d.elementFromPoint(x, y); if (!el || el === d.documentElement || el === d.body) return null;
    return describe(el);
  };
  const hoverRaf = React.useRef(0);
  const onMove = (e: React.MouseEvent) => { if (!pickable) return; const ev = { clientX: e.clientX, clientY: e.clientY, currentTarget: e.currentTarget } as React.MouseEvent; cancelAnimationFrame(hoverRaf.current); hoverRaf.current = requestAnimationFrame(() => hoverAt(ev)); };
  const hoverAt = (e: React.MouseEvent) => { const p = pickAt(e); const d = doc(); if (!p || !d) { setHover(null); cbs.current.onHover?.(null); return; } const el = d.querySelector(p.path) ?? d.elementFromPoint((e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / scale, (e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top) / scale); if (el) setHover(boxFor(el, "#6b7280", p.selector, true)); cbs.current.onHover?.(p); };
  const onClick = (e: React.MouseEvent) => { if (!pickable) return; e.preventDefault(); const p = pickAt(e); if (!p) return; if (shiftPick) { cbs.current.onClickThrough?.(p, { shift: e.shiftKey }); return; } const r = host.current?.getBoundingClientRect(); cbs.current.onPick?.(p, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }); };
  // focus: render only one element -- hide the siblings along its ancestor chain (styles stay: the ancestors keep their classes)
  React.useEffect(() => {
    const d = doc(); if (!d) return;
    if (!d.getElementById("__wc_focus_css")) { const st = d.createElement("style"); st.id = "__wc_focus_css"; st.textContent = "[data-wc-hide]{display:none!important}"; (d.head ?? d.documentElement).appendChild(st); }
    d.querySelectorAll("[data-wc-hide]").forEach((x) => x.removeAttribute("data-wc-hide"));
    const roots = (Array.isArray(focus) ? focus : focus ? [focus] : []).filter((x) => x.ownerDocument === d);
    if (roots.length) {
      const keep = new Set<Element>(); for (const r of roots) { let n: Element | null = r; while (n) { keep.add(n); n = n.parentElement; } }
      for (const r of roots) { let n: Element | null = r; while (n && n.parentElement) { for (const sib of n.parentElement.children) if (!keep.has(sib) && sib.tagName !== "HEAD" && sib.tagName !== "STYLE" && sib.tagName !== "LINK") sib.setAttribute("data-wc-hide", ""); n = n.parentElement; } }
      scrollWithin(roots[0]!, "start");
    }
    refreshRef.current();
  }, [focus, ready]);

  React.useEffect(() => {
    if (!scrollTo) return; const w = scrollTo.ownerDocument.defaultView; if (!w) return;
    scrollWithin(scrollTo, "center");  // the outlined element, CENTRED
    refreshRef.current();
  }, [scrollTo]);

  // -- transport (the MediaBar drives it through the controller) ----------------------
  const markers = React.useMemo(() => events.filter((e) => e.type === 5).map((e) => ({ t: e.timestamp, tag: String(e.data?.tag ?? "") })), [events]);
  const total = Math.max(1, meta.totalTime);
  const toggle = () => { const r = rep.current; if (!r) return; if (playing) { r.pause(); setPlaying(false); } else { r.play(time >= total - 5 ? 0 : time); setPlaying(true); } };
  const step = (dir: 1 | -1) => { const r = rep.current; if (!r) return; const ts = markers.map((m) => m.t - meta.startTime).filter((t) => t >= 0); const next = dir > 0 ? ts.find((t) => t > time + 5) : [...ts].reverse().find((t) => t < time - 5); const target = next ?? (dir > 0 ? total : 0); r.pause(target); setTime(target); setPlaying(false); refreshRef.current(); };
  const seekFrac = (frac: number) => { const r = rep.current; if (!r) return; const t = Math.max(0, Math.min(total, frac * total)); if (playing) r.play(t); else r.pause(t); setTime(t); refreshRef.current(); };
  ctl.actions = { toggle, step, seekFrac, setSpeed, setSkip, setPace };
  React.useEffect(() => { ctl.set({ playing, live, ready, time, total, startTime: meta.startTime, speed, skip, pace, markers, size, scale }); }, [ctl, playing, live, ready, time, total, meta.startTime, speed, skip, pace, markers, size, scale]);
  // keyboard: space plays / pauses, arrows step (when the pointer is over the player)
  const onKey = (e: React.KeyboardEvent) => { if (e.key === " ") { e.preventDefault(); toggle(); } if (e.key === "ArrowRight") { e.preventDefault(); step(1); } if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } };

  return (
    <div className={cn("wc-player flex flex-col overflow-hidden rounded-lg border border-line bg-surface-2 outline-none", className)} tabIndex={0} onKeyDown={onKey}>
      <div ref={host} className="relative w-full overflow-hidden bg-white" style={{ height: Math.round(size.h * scale) }}>
        <div ref={root} className="absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} />
        {/* the overlay: highlights, hover, flashes -- scaled with the page */}
        <div className={cn("absolute left-0 top-0 origin-top-left", pickable && !shiftPick && "cursor-crosshair")} style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} onMouseMove={onMove} onMouseLeave={() => { setHover(null); cbs.current.onHover?.(null); }} onClick={onClick}>
          {cursor && <div className={cn("wc-cursor", cursor.down && "wc-cursor-down")} style={{ left: cursor.x - scrollXY[0], top: cursor.y - scrollXY[1] }} />}
          {[...boxes, ...flash, ...(hover ? [hover] : [])].map((b, i) => (
            <div key={i} className={cn("wc-hl absolute", b.dashed && "wc-hl-dashed", flash.includes(b) && "wc-hl-flash")} style={{ left: b.left, top: b.top, width: b.width, height: b.height, ["--c" as any]: b.colour }}>
              {b.label && <span className="wc-hl-label">{b.label}</span>}
            </div>
          ))}
        </div>
        {/* network / action / loop pulses: what the run did, as it happens */}
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {pulses.map((p) => <span key={p.id} className="wc-pulse" style={{ ["--c" as any]: p.tone }}><span className="wc-pulse-dot" />{p.text}</span>)}
        </div>
        {!ready && !live && events.length >= 2 && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">rebuilding the page…</div>}
        {events.length < 2 && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">{live ? "waiting for the page's first snapshot…" : "nothing to show yet"}</div>}
      </div>
      {controls && <MediaBar controller={ctl} />}
    </div>
  );
}

function short(url: string): string { try { const u = new URL(url); return (u.pathname + u.search).slice(0, 48) || "/"; } catch { return url.slice(0, 48); } }

/** The element under the mouse, as the query builder needs it: a durable-ish path, a
 * readable selector (tag.class), its classes and attributes. */
export function describe(el: Element): Pick {
  const steps: string[] = []; let n: Element | null = el;
  while (n && n.nodeType === 1 && n.tagName !== "HTML" && n.tagName !== "BODY") {
    const t = n.tagName.toLowerCase(); const p: Element | null = n.parentElement;
    if (!p) { steps.push(t); break; }
    const same = [...p.children].filter((c) => c.tagName === n!.tagName);
    steps.push(same.length > 1 ? `${t}:nth-of-type(${same.indexOf(n) + 1})` : t); n = p;
  }
  const classes = [...el.classList].filter((c) => !/^(data-wc|wc-)/.test(c));
  const tag = el.tagName.toLowerCase();
  const semantic = classes.filter((c) => !/[0-9]|^(flex|grid|block|hidden|relative|absolute|border|rounded|text|font|p|m|px|py|mt|mb|ml|mr|w|h|gap|items|justify)(-|$)/.test(c));
  const selector = el.id ? `${tag}#${el.id}` : semantic[0] ? `${tag}.${semantic[0]}` : tag;
  const attrs: Record<string, string> = {}; for (const a of el.attributes) if (a.name !== "class" && a.name !== "style" && !a.name.startsWith("data-wc")) attrs[a.name] = a.value.slice(0, 120);
  return { path: steps.reverse().join(" > "), selector, tag, classes, id: el.id || undefined, text: (el.textContent || "").trim().slice(0, 120), attrs, href: (el as HTMLAnchorElement).href || undefined, el };
}

/** Re-time a run onto a story beat: consecutive events (ours, and the DOM events between
 * them) are pushed apart to at least `gap` ms, everything after shifting with them. Returns
 * the paced list and the maps between the two clocks (the panes and the seek use the
 * recorded one; the replayer runs on the paced one). */
function paceEvents(events: RREvent[], gap: number): { events: RREvent[]; toRecorded: (ms: number) => number; toPaced: (ms: number) => number } {
  if (!gap || events.length < 3) return { events, toRecorded: (ms) => ms, toPaced: (ms) => ms };
  const out: RREvent[] = []; const pairs: [number, number][] = []; // [recorded, paced]
  let shift = 0; let lastBeat = -Infinity;
  for (const e of events) {
    const isBeat = e.type === 5 || e.type === 3; // our events and the DOM's changes are the beats
    let t = e.timestamp + shift;
    if (isBeat && t - lastBeat < gap) { shift += gap - (t - lastBeat); t = e.timestamp + shift; }
    if (isBeat) lastBeat = t;
    out.push({ ...e, timestamp: t }); pairs.push([e.timestamp, t]);
  }
  const interp = (x: number, from: 0 | 1, to: 0 | 1) => { let lo = pairs[0]!; for (const p of pairs) { if (p[from] <= x) lo = p; else break; } return x - lo[from] + lo[to]; };
  return { events: out, toRecorded: (ms) => interp(ms, 1, 0), toPaced: (ms) => interp(ms, 0, 1) };
}

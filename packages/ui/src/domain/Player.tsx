import * as React from "react";
import { Pause, Play, SkipBack, SkipForward, Radio, Crosshair } from "lucide-react";
import { cn } from "../lib/cn";
import { topicColorVar } from "./TopicChip";

/** One rrweb event (a DOM event, or one of ours as a custom event tagged with its topic). */
export type RREvent = { type: number; data: any; timestamp: number };

export type Highlight = { selector: string; label?: string; tone?: "accent" | "ok" | "warn" | "field" | "bad"; colour?: string; key?: string };
export type Pick = { path: string; selector: string; tag: string; classes: string[]; id?: string; text: string; attrs: Record<string, string>; href?: string };
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
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick | null) => void;
  /** Seek to an absolute timestamp (ms since epoch) when it changes. */
  seekTo?: number | null;
  /** The player's clock (absolute ms), as it plays or is scrubbed. */
  onTime?: (ms: number) => void;
  /** One of our events reached during playback. */
  onEvent?: (topic: string, payload: Record<string, unknown>) => void;
  /** The rebuilt page's document (after every full snapshot): the query builder evaluates
   * selectors in it locally -- no round trips while picking. */
  onDocument?: (doc: Document) => void;
  /** The media bar (default on). */
  controls?: boolean;
  autoPlay?: boolean;
  className?: string;
  /** Max height of the viewport area (the page scales to fit width, then this). */
  maxHeight?: number;
};

export const FIELD_COLOURS = ["#2457e6", "#15803d", "#b45309", "#7c3aed", "#0f766e", "#be185d"];
export const fieldColour = (i: number) => FIELD_COLOURS[i % FIELD_COLOURS.length]!;
const TONE: Record<NonNullable<Highlight["tone"]>, string> = { accent: "#2457e6", ok: "#15803d", warn: "#b45309", field: "#7c3aed", bad: "#b91c1c" };
const SPEEDS = [0.5, 1, 2, 4, 8];

/** THE player: one component for replay, live pages and the query builder's preview.
 * rrweb's Replayer rebuilds the DOM (mouse cursor + tail, smooth scroll, inputs); every
 * other event of the run is a marker on our own media bar and an animation on the page
 * (network pulses, action flashes); the highlight overlay outlines selectors and, in pick
 * mode, reports the element under the mouse with its classes. The page always renders
 * at the recorded viewport and is scaled to fit -- no reflow between documents. */
const NO_HIGHLIGHTS: Highlight[] = [];

export function Player({ events, live = false, highlights = NO_HIGHLIGHTS, pickable = false, onPick, onHover, seekTo, onTime, onEvent, onDocument, controls = true, autoPlay = false, className, maxHeight = 720 }: PlayerProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const rep = React.useRef<any>(null);
  const appended = React.useRef(0);
  const cbs = React.useRef({ onTime, onEvent, onPick, onHover, onDocument });
  cbs.current = { onTime, onEvent, onPick, onHover, onDocument };
  const refreshRef = React.useRef<() => void>(() => {});
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
      await import("rrweb/dist/style.css");
      if (cancelled || !root.current) return;
      root.current.innerHTML = "";
      const Replayer = mod.Replayer;
      if (events.length < 2) return; // live: wait for the Meta + FullSnapshot pair
      r = new Replayer(events, {
        root: root.current, speed, skipInactive: skip, showWarning: false, showDebug: false, liveMode: live,
        mouseTail: { strokeStyle: "#2457e6", lineWidth: 2, duration: 700 },
        insertStyleRules: ["html { scroll-behavior: smooth !important; }", ".replayer-mouse { transition: left .12s linear, top .12s linear; }"],
        UNSAFE_replayCanvas: false,
      });
      rep.current = r;
      appended.current = events.length;
      r.on("resize", (d: { width: number; height: number }) => setSize({ w: d.width, h: d.height }));
      r.on("fullsnapshot-rebuilded", () => { setReady(true); refreshRef.current(); const d = r.iframe?.contentDocument; if (d) cbs.current.onDocument?.(d); });
      r.on("custom-event", (e: any) => {
        const tag = String(e?.data?.tag ?? ""); const payload = (e?.data?.payload ?? {}) as Record<string, unknown>;
        cbs.current.onEvent?.(tag, payload);
        if (tag.startsWith("network")) pulse(tag, `${String(payload.method ?? "GET").toUpperCase()} ${short(String(payload.url ?? ""))}${payload.status_code ? ` → ${payload.status_code}` : ""}`);
        if (tag === "action") { const sel = (payload.args as any)?.selector; pulse(tag, `${payload.action}${sel ? ` ${sel}` : ""}`); if (sel) flashSelector(String(sel)); }
        if (tag === "error") pulse(tag, String((payload.error as any)?.code ?? "error"));
        if (tag === "loop" || tag === "pipeline") pulse(tag, `${payload.loop ?? payload.pipeline} · ${payload.phase}`);
      });
      r.on("finish", () => setPlaying(false));
      r.on("state-change", (s: any) => { if (s?.player?.value) setPlaying(s.player.value === "playing"); });
      const m = live ? { startTime: events[0]!.timestamp, endTime: events[events.length - 1]!.timestamp, totalTime: 0 } : r.getMetaData(); setMeta(m);
      if (live) { r.startLive(); setPlaying(true); }
      else if (autoPlay) { r.play(0); setPlaying(true); }
      else r.pause(0);
      const tick = () => { if (!rep.current) return; const t = rep.current.getCurrentTime(); setTime(t); cbs.current.onTime?.(m.startTime + t); refreshRef.current(); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); try { r?.destroy?.(); } catch { /* gone */ } rep.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live ? (events.length >= 2 ? "live" : "waiting") : events]);

  // live: append what arrived since the last render
  React.useEffect(() => {
    if (!live || !rep.current) return;
    for (let i = appended.current; i < events.length; i++) { try { rep.current.addEvent(events[i]); } catch { /* a malformed chunk */ } }
    appended.current = events.length;
  }, [events, live]);

  React.useEffect(() => { rep.current?.setConfig?.({ speed }); }, [speed]);
  React.useEffect(() => { rep.current?.setConfig?.({ skipInactive: skip }); }, [skip]);
  React.useEffect(() => { if (seekTo == null || !rep.current || live) return; const off = Math.max(0, seekTo - meta.startTime); if (Math.abs(off - rep.current.getCurrentTime()) > 30) { rep.current.pause(off); setTime(off); } }, [seekTo, meta.startTime, live]);

  // -- scale to fit --------------------------------------------------------------
  React.useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const fit = () => { const w = el.clientWidth || size.w; const s = Math.min(w / size.w, maxHeight / size.h); setScale(s); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [size, maxHeight]);

  // -- overlay: highlights, hover, action flashes --------------------------------
  const doc = () => rep.current?.iframe?.contentDocument as Document | undefined;
  const boxFor = (el: Element, colour: string, label?: string, dashed = false): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, colour, label, dashed }; };
  const refreshBoxes = React.useCallback(() => {
    const d = doc(); if (!d) return;
    const out: Box[] = [];
    for (const h of highlights) {
      let els: Element[] = []; try { els = [...d.querySelectorAll(h.selector)]; } catch { continue; }
      const colour = h.colour ?? TONE[h.tone ?? "accent"];
      els.forEach((el, i) => out.push(boxFor(el, colour, i === 0 ? (h.label ? `${h.label}${els.length > 1 && !h.label.includes("×") ? ` ×${els.length}` : ""}` : undefined) : undefined)));
    }
    setBoxes((prev) => (prev.length === out.length && prev.every((b, i) => b.left === out[i]!.left && b.top === out[i]!.top && b.width === out[i]!.width && b.height === out[i]!.height && b.label === out[i]!.label)) ? prev : out);
  }, [highlights]);
  refreshRef.current = refreshBoxes;
  React.useEffect(() => { refreshBoxes(); }, [refreshBoxes, scale, ready]);
  React.useEffect(() => { const d = doc(); if (!d) return; const h = () => refreshBoxes(); d.addEventListener("scroll", h, true); return () => d.removeEventListener("scroll", h, true); }, [refreshBoxes, ready]);
  const flashSelector = (sel: string) => { const d = doc(); if (!d) return; let els: Element[] = []; try { els = [...d.querySelectorAll(sel)].slice(0, 3); } catch { return; } const fb = els.map((el) => boxFor(el, "#b45309", "action")); setFlash(fb); setTimeout(() => setFlash([]), 900); };
  const pulse = (topic: string, text: string) => { const id = Date.now() + Math.random(); setPulses((p) => [...p.slice(-5), { id, at: Date.now(), topic, text, tone: topicColorVar(topic) }]); setTimeout(() => setPulses((p) => p.filter((x) => x.id !== id)), 2600); };

  const pickAt = (e: React.MouseEvent): Pick | null => {
    const d = doc(); if (!d) return null;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
    const el = d.elementFromPoint(x, y); if (!el || el === d.documentElement || el === d.body) return null;
    return describe(el);
  };
  const onMove = (e: React.MouseEvent) => { if (!pickable) return; const p = pickAt(e); const d = doc(); if (!p || !d) { setHover(null); cbs.current.onHover?.(null); return; } const el = d.querySelector(p.path) ?? d.elementFromPoint((e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / scale, (e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top) / scale); if (el) setHover(boxFor(el, "#6b7280", p.selector, true)); cbs.current.onHover?.(p); };
  const onClick = (e: React.MouseEvent) => { if (!pickable) return; e.preventDefault(); const p = pickAt(e); if (p) cbs.current.onPick?.(p); };

  // -- media bar -----------------------------------------------------------------
  const markers = React.useMemo(() => events.filter((e) => e.type === 5).map((e) => ({ t: e.timestamp, tag: String(e.data?.tag ?? "") })), [events]);
  const total = Math.max(1, meta.totalTime);
  const toggle = () => { const r = rep.current; if (!r) return; if (playing) { r.pause(); setPlaying(false); } else { r.play(time >= total - 5 ? 0 : time); setPlaying(true); } };
  const step = (dir: 1 | -1) => { const r = rep.current; if (!r) return; const ts = markers.map((m) => m.t - meta.startTime).filter((t) => t >= 0); const next = dir > 0 ? ts.find((t) => t > time + 5) : [...ts].reverse().find((t) => t < time - 5); const target = next ?? (dir > 0 ? total : 0); r.pause(target); setTime(target); setPlaying(false); refreshBoxes(); };
  const seekFrac = (frac: number) => { const r = rep.current; if (!r) return; const t = Math.max(0, Math.min(total, frac * total)); if (playing) r.play(t); else r.pause(t); setTime(t); refreshBoxes(); };
  const track = React.useRef<HTMLDivElement>(null);
  const onTrack = (e: React.MouseEvent) => { const rct = track.current?.getBoundingClientRect(); if (!rct) return; const f = (clientX: number) => seekFrac((clientX - rct.left) / rct.width); f(e.clientX); const mv = (m: MouseEvent) => f(m.clientX); const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); };

  return (
    <div className={cn("wc-player flex flex-col overflow-hidden rounded-lg border border-line bg-surface-2", className)}>
      <div ref={host} className="relative w-full overflow-hidden bg-white" style={{ height: Math.round(size.h * scale) }}>
        <div ref={root} className="absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} />
        {/* the overlay: highlights, hover, flashes -- scaled with the page */}
        <div className={cn("absolute left-0 top-0 origin-top-left", pickable ? "cursor-crosshair" : "pointer-events-none")} style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} onMouseMove={onMove} onMouseLeave={() => { setHover(null); cbs.current.onHover?.(null); }} onClick={onClick}>
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
        {pickable && <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-surface"><Crosshair size={10} /> click an element to pick it</span>}
      </div>
      {controls && (
        <div className="flex items-center gap-2 border-t border-line bg-surface px-2 py-1.5 text-[12px]">
          {live ? <span className="inline-flex items-center gap-1 text-ok"><Radio size={13} className="animate-pulse" /> live</span> : (
            <>
              <button type="button" className="wc-mb" onClick={() => step(-1)} title="previous event"><SkipBack size={14} /></button>
              <button type="button" className="wc-mb wc-mb-primary" onClick={toggle} title={playing ? "pause" : "play"} disabled={staticOnly}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
              <button type="button" className="wc-mb" onClick={() => step(1)} title="next event"><SkipForward size={14} /></button>
              <span className="w-[86px] font-mono text-[11px] text-muted">{fmt(time)} / {fmt(total)}</span>
            </>
          )}
          <div ref={track} className="relative h-6 flex-1 cursor-pointer" onMouseDown={live ? undefined : onTrack}>
            <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-line" />
            {!live && <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded bg-accent" style={{ width: `${(time / total) * 100}%` }} />}
            {!live && markers.map((m, i) => <span key={i} className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-sm" style={{ left: `${((m.t - meta.startTime) / total) * 100}%`, background: topicColorVar(m.tag), opacity: 0.85 }} title={m.tag} />)}
            {!live && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface" style={{ left: `${(time / total) * 100}%` }} />}
          </div>
          {!live && <>
            <select className="h-6 rounded border border-line bg-surface px-1 text-[11px]" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
            <label className="inline-flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> skip idle</label>
          </>}
          <span className="font-mono text-[10px] text-muted">{size.w}×{size.h} · {Math.round(scale * 100)}%</span>
        </div>
      )}
    </div>
  );
}

function fmt(ms: number): string { const s = Math.max(0, ms) / 1000; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`; }
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
  return { path: steps.reverse().join(" > "), selector, tag, classes, id: el.id || undefined, text: (el.textContent || "").trim().slice(0, 120), attrs, href: (el as HTMLAnchorElement).href || undefined };
}

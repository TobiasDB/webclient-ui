import * as React from "react";
import { cn } from "../lib/cn";

export type Highlight = { selector: string; label?: string; tone?: "accent" | "ok" | "warn" | "field"; key?: string };

export type PreviewProps = {
  /** The captured HTML (a snapshot). Rendered in a sandboxed frame; scripts never run. */
  html: string;
  /** Selectors to outline inside the frame (records, fields, hovered skeleton lines). */
  highlights?: Highlight[];
  /** Fired when the user clicks an element inside the frame: the durable-ish path we can
   *  compute client-side (tag + nth-of-type chain) and the element's text. */
  onPick?: (pick: { path: string; text: string; tag: string }) => void;
  /** Fired on hover (for the reverse link into the skeleton / element table). */
  onHover?: (path: string | null) => void;
  className?: string;
  /** Base URL for relative assets (images/CSS) via a <base> tag. */
  baseUrl?: string;
};

const FIELD_COLOURS = ["#2457e6", "#15803d", "#b45309", "#7c3aed", "#0f766e", "#be185d"];

const OVERLAY = `
<style id="__wc_overlay">
  [data-wc-hl] { outline: 2px solid var(--wc-c, #2457e6) !important; outline-offset: 1px; position: relative; }
  [data-wc-hl]::after { content: attr(data-wc-label); position: absolute; top: -1.2em; left: 0; background: var(--wc-c, #2457e6); color: #fff;
    font: 10px/1.4 ui-sans-serif, system-ui, sans-serif; padding: 0 4px; border-radius: 3px; white-space: nowrap; z-index: 2147483647; pointer-events: none; }
  [data-wc-hover] { outline: 2px dashed #6b7280 !important; }
  * { cursor: crosshair !important; }
</style>`;

const SCRIPT = `
<script>
(() => {
  const path = (el) => { const steps = []; let n = el;
    while (n && n.nodeType === 1 && n.tagName !== 'HTML') { const t = n.tagName.toLowerCase(); const p = n.parentElement;
      if (!p) { steps.push(t); break; } const same = [...p.children].filter(c => c.tagName === n.tagName);
      steps.push(same.length > 1 ? t + ':nth-of-type(' + (same.indexOf(n) + 1) + ')' : t); n = p; }
    return steps.reverse().join(' > '); };
  document.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation();
    parent.postMessage({ type: 'wc:pick', path: path(e.target), text: (e.target.textContent || '').trim().slice(0, 120), tag: e.target.tagName.toLowerCase() }, '*'); }, true);
  let last = null;
  document.addEventListener('mouseover', (e) => { if (last) last.removeAttribute('data-wc-hover'); last = e.target; last.setAttribute('data-wc-hover', '');
    parent.postMessage({ type: 'wc:hover', path: path(e.target) }, '*'); }, true);
  document.addEventListener('mouseleave', () => parent.postMessage({ type: 'wc:hover', path: null }, '*'));
  window.addEventListener('message', (m) => { if (!m.data || m.data.type !== 'wc:highlight') return;
    document.querySelectorAll('[data-wc-hl]').forEach(el => { el.removeAttribute('data-wc-hl'); el.removeAttribute('data-wc-label'); el.style.removeProperty('--wc-c'); });
    for (const h of m.data.highlights) { let els = []; try { els = [...document.querySelectorAll(h.selector)]; } catch (e) { continue; }
      els.forEach((el, i) => { el.setAttribute('data-wc-hl', ''); if (i === 0 && h.label) el.setAttribute('data-wc-label', h.label + (els.length > 1 ? ' ×' + els.length : '')); el.style.setProperty('--wc-c', h.colour); });
      if (els[0] && h.scroll) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
  parent.postMessage({ type: 'wc:ready' }, '*');
})();
</script>`;

const TONE_COLOUR: Record<NonNullable<Highlight["tone"]>, string> = { accent: "#2457e6", ok: "#15803d", warn: "#b45309", field: "#7c3aed" };

/** The captured page in a sandboxed iframe with a highlight overlay: pattern hints, the
 * chosen record, the picked fields; click to pick, hover to link back to the skeleton
 * (stories 1.1, 1.2, 2.1). Scripts in the page never run (srcdoc + sandbox="allow-scripts"
 * only for OUR overlay script, which is injected last). */
export function Preview({ html, highlights = [], onPick, onHover, className, baseUrl }: PreviewProps) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const srcdoc = React.useMemo(() => {
    const cleaned = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");  // the page's own scripts never run
    const base = baseUrl ? `<base href="${baseUrl.replace(/"/g, "")}">` : "";
    return cleaned.includes("</head>") ? cleaned.replace("</head>", `${base}${OVERLAY}</head>`).replace("</body>", `${SCRIPT}</body>`)
      : `<!doctype html><html><head>${base}${OVERLAY}</head><body>${cleaned}${SCRIPT}</body></html>`;
  }, [html, baseUrl]);

  React.useEffect(() => {
    const onMsg = (m: MessageEvent) => {
      if (m.source !== ref.current?.contentWindow || !m.data) return;
      if (m.data.type === "wc:ready") setReady(true);
      if (m.data.type === "wc:pick") onPick?.({ path: m.data.path, text: m.data.text, tag: m.data.tag });
      if (m.data.type === "wc:hover") onHover?.(m.data.path ?? null);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onPick, onHover]);

  React.useEffect(() => {
    if (!ready) return;
    let fieldIdx = 0;
    const payload = highlights.map((h) => ({
      selector: h.selector, label: h.label,
      colour: h.tone === "field" ? FIELD_COLOURS[fieldIdx++ % FIELD_COLOURS.length] : TONE_COLOUR[h.tone ?? "accent"],
      scroll: false,
    }));
    ref.current?.contentWindow?.postMessage({ type: "wc:highlight", highlights: payload }, "*");
  }, [ready, highlights]);

  return (
    <iframe ref={ref} title="preview" srcDoc={srcdoc} sandbox="allow-scripts" onLoad={() => setReady(false)}
      className={cn("h-full w-full rounded-md border border-line bg-white", className)} />
  );
}

/** The colour a field highlight gets by its order (so chips and outlines match). */
export const fieldColour = (i: number) => FIELD_COLOURS[i % FIELD_COLOURS.length] ?? FIELD_COLOURS[0]!;

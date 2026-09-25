import * as React from "react";
import { cn } from "../lib/cn";

/** A structural path: child indices from <html> down (the same element in the frame and in a
 * parsed copy of the same HTML). */
export type ElPath = number[];
export type FrameHighlight = { selector?: string; /** explicit elements (structural paths) instead of a selector */ paths?: ElPath[]; colour: string; label?: string; dashed?: boolean; /** query inside this element (the focus root); `:scope` outlines the root itself */ rootPath?: ElPath | null };
export type FramePick = { path: ElPath; tag: string; id?: string; classes: string[]; text: string; /** the click landed inside this element's SHADOW root (the static copy cannot reach it) */ shadow?: boolean };

export type FrameAction = { op: "click" | "write" | "navigate"; pick: FramePick; href?: string; value?: string; /** SHIFT held: record it */ shift: boolean };
export type PageFrameProps = {
  /** the page's HTML (a capture) */
  html: string;
  /** its URL: relative CSS / JS / images resolve against it */
  base: string;
  /** a browser-tier capture is the page AFTER its scripts ran: do not run them twice */
  stripScripts?: boolean;
  /** render only these elements (siblings along their ancestors hidden; styles kept) */
  focusPaths?: ElPath[] | null;
  highlights?: FrameHighlight[];
  /** keep this element in view (scrolled within the frame, never the page around it) */
  scrollTo?: ElPath | null;
  /** PICK mode: a click picks an element (nothing happens on the page); otherwise the page is interactive */
  picking?: boolean;
  onPick?: (p: FramePick) => void;
  onHover?: (p: FramePick | null) => void;
  /** INTERACT mode: what the person did -- a click on a control, typing into a field, following a
   * link -- with whether SHIFT was held (record it). The page behaves natively; a link waits for
   * the workspace: return "browse" to let the frame follow it (unrecorded, away from the plan's
   * page), anything else keeps the page (the workspace jumped to / recorded it). */
  onAction?: (a: FrameAction) => "browse" | void;
  onCounts?: (counts: number[]) => void;
  width?: number;
  maxHeight?: number;
  className?: string;
};

/** The page, RENDERED FOR REAL: the captured HTML in a sandboxed frame (its own CSS and JS run;
 * it never gets the workspace's origin -- no `allow-same-origin`), plus a small AGENT the frame
 * runs first: hover outlines, the pick (in pick mode), the person's actions reported (in
 * interact mode), highlights drawn inside the page, focus isolation. Frame and workspace talk by
 * postMessage; elements travel as structural paths. */
export function PageFrame({ html, base, stripScripts, focusPaths = null, highlights = [], scrollTo = null, picking = false, onPick, onHover, onAction, onCounts, width = 1280, maxHeight = 760, className }: PageFrameProps) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [ready, setReady] = React.useState(false);
  const [away, setAway] = React.useState(false);  // browsed away (shift-followed link): not the plan's page
  const [key, setKey] = React.useState(0);
  const readyAt = React.useRef(0);
  const cbs = React.useRef({ onPick, onHover, onAction, onCounts }); cbs.current = { onPick, onHover, onAction, onCounts };
  const srcDoc = React.useMemo(() => withAgent(html, base, !!stripScripts), [html, base, stripScripts]);
  React.useEffect(() => { setReady(false); setAway(false); }, [srcDoc, key]);
  // the page renders at least `width` wide (scaled down to fit), and at the full width it is given when wider
  const [boxW, setBoxW] = React.useState(width);
  React.useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => { setBoxW(el.clientWidth); setScale(Math.min(1, el.clientWidth / width)); }); ro.observe(el); return () => ro.disconnect(); }, [width]);
  const frameW = Math.max(width, boxW);
  React.useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || !e.data.__wc) return;
      const m = e.data as { type: string } & Record<string, unknown>;
      if (m.type === "ready") { setReady(true); setAway(false); readyAt.current = Date.now(); }
      else if (m.type === "pick") cbs.current.onPick?.(m.pick as FramePick);
      else if (m.type === "hover") cbs.current.onHover?.((m.pick as FramePick) ?? null);
      else if (m.type === "action") { const a = m.action as FrameAction; if (cbs.current.onAction?.(a) === "browse" && a.op === "navigate" && a.href) post({ type: "go", href: a.href }); }
      else if (m.type === "counts") cbs.current.onCounts?.(m.counts as number[]);
    };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h);
  }, []);
  const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ __wc: 1, ...m }, "*");
  React.useEffect(() => { if (ready) post({ type: "mode", picking }); }, [ready, picking]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (ready) post({ type: "focus", paths: focusPaths }); }, [ready, JSON.stringify(focusPaths)]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (ready) post({ type: "highlight", items: highlights, scroll: scrollTo ?? null }); }, [ready, JSON.stringify(highlights), JSON.stringify(scrollTo)]); // eslint-disable-line react-hooks/exhaustive-deps
  // a load that the agent did not announce is a page browsed to (a shift-followed link)
  const onLoad = () => { const t = Date.now(); post({ type: "ping" }); setTimeout(() => { if (readyAt.current < t) { setAway(true); setReady(false); } }, 800); };
  return (
    <div ref={box} className={cn("relative w-full overflow-hidden rounded-lg border bg-white", picking ? "border-warn ring-2 ring-warn/40" : "border-line", className)} style={{ height: maxHeight }}>
      <iframe key={key} ref={frame} title="page" srcDoc={srcDoc} onLoad={onLoad} sandbox="allow-scripts allow-forms allow-popups" className="absolute left-0 top-0 origin-top-left border-0 bg-white" style={{ width: frameW, height: maxHeight / scale, transform: `scale(${scale})` }} />
      {!ready && !away && <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[12px] text-muted">rendering…</div>}
      {away && <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-ink/85 px-2 py-1 text-[11px] text-surface">browsing away from the plan's page (not recorded) <button type="button" className="rounded bg-surface px-1.5 text-ink" onClick={() => setKey((k) => k + 1)}>back to the page</button></div>}
    </div>
  );
}

/** The HTML with a <base> and the agent first in <head> (so its capture-phase listeners run before the page's). */
/** third-party widgets that cannot work in a sandboxed copy (no origin): captchas, analytics */
const WIDGETS = /(recaptcha|hcaptcha|turnstile|challenges\.cloudflare|googletagmanager|google-analytics|gtag\/js|doubleclick|connect\.facebook|hotjar|segment\.com|intercom)/i;
export function withAgent(html: string, base: string, strip: boolean): string {
  let h = strip ? html.replace(/<script\b[\s\S]*?<\/script>/gi, "") : html;
  h = h.replace(/<script\b[^>]*\bsrc=["']([^"']*)["'][^>]*>\s*<\/script>/gi, (m, src: string) => (WIDGETS.test(src) ? "" : m))
    .replace(/<iframe\b[^>]*\bsrc=["']([^"']*)["'][^>]*>[\s\S]*?<\/iframe>/gi, (m, src: string) => (WIDGETS.test(src) ? "" : m));
  const inject = `<base href="${base.replace(/"/g, "&quot;")}"><script>${AGENT}</script>`;
  if (/<head[^>]*>/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + inject);
  else if (/<html[^>]*>/i.test(h)) h = h.replace(/<html[^>]*>/i, (m) => m + "<head>" + inject + "</head>");
  else h = "<head>" + inject + "</head>" + h;
  return h;
}

/** The agent: runs inside the page (no access to the workspace; talks by postMessage). */
const AGENT = `(function(){
var post=function(m){m.__wc=1;try{parent.postMessage(m,"*")}catch(e){}};
var pathOf=function(el){var p=[];while(el&&el.parentElement){p.unshift(Array.prototype.indexOf.call(el.parentElement.children,el));el=el.parentElement}return p};
var byPath=function(p){var el=document.documentElement;for(var i=0;p&&i<p.length;i++){el=el&&el.children[p[i]]}return el||null};
var info=function(el){return{path:pathOf(el),tag:el.tagName.toLowerCase(),id:el.id||undefined,classes:Array.prototype.slice.call(el.classList),text:(el.textContent||"").trim().slice(0,120)}};
var roots=[],items=[],hover=null,layer=null,raf=0,picking=false;
var inRoots=function(el){if(!roots.length)return true;for(var i=0;i<roots.length;i++)if(roots[i]&&roots[i].contains(el))return true;return false};
function ensure(){if(layer&&layer.isConnected)return;layer=document.createElement("div");layer.setAttribute("data-wc-layer","");layer.style.cssText="position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647";document.documentElement.appendChild(layer);var st=document.createElement("style");st.setAttribute("data-wc-layer","");st.textContent="[data-wc-hide]{display:none!important}";document.documentElement.appendChild(st)}
function mark(r,c,label,dashed,fill){var d=document.createElement("div");d.style.cssText="position:absolute;box-sizing:border-box;left:"+(r.left+scrollX)+"px;top:"+(r.top+scrollY)+"px;width:"+r.width+"px;height:"+r.height+"px;border:2px "+(dashed?"dashed ":"solid ")+c+";border-radius:3px;"+(fill?"background:"+c+"22;":"");layer.appendChild(d);if(label){var t=document.createElement("div");t.textContent=label;t.style.cssText="position:absolute;left:"+(r.left+scrollX)+"px;top:"+Math.max(0,r.top+scrollY-15)+"px;font:600 10px/14px system-ui;color:#fff;background:"+c+";padding:0 4px;border-radius:3px;white-space:nowrap";layer.appendChild(t)}}
function draw(){raf=0;ensure();layer.innerHTML="";var counts=[];for(var k=0;k<items.length;k++){var h=items[k],r0=h.rootPath?byPath(h.rootPath):document,els=[];try{els=h.paths?h.paths.map(byPath).filter(Boolean):h.selector===":scope"?(r0&&r0!==document?[r0]:[]):Array.prototype.slice.call((r0||document).querySelectorAll(h.selector))}catch(e){}counts.push(els.length);for(var i=0;i<els.length&&i<400;i++){mark(els[i].getBoundingClientRect(),h.colour,i===0&&h.label?h.label+(els.length>1?" ×"+els.length:""):null,h.dashed,false)}}if(hover)mark(hover.getBoundingClientRect(),picking?"#d97706":"#94a3b8",picking?hover.tagName.toLowerCase()+(hover.id?"#"+hover.id:"")+(hover.classList.length?"."+Array.prototype.slice.call(hover.classList,0,3).join("."):""):null,true,picking);post({type:"counts",counts:counts})}
var shields=null;
function shield(){if(!shields||!shields.isConnected){shields=document.createElement("div");shields.setAttribute("data-wc-layer","");shields.style.cssText="position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483646";document.documentElement.appendChild(shields)}shields.innerHTML="";if(!picking)return;var fs=document.querySelectorAll("iframe,object,embed");for(var i=0;i<fs.length;i++){var f=fs[i];if(!inRoots(f))continue;var r=f.getBoundingClientRect();if(!r.width||!r.height)continue;var d=document.createElement("div");d.setAttribute("data-wc-layer","");d.style.cssText="position:absolute;cursor:crosshair;left:"+(r.left+scrollX)+"px;top:"+(r.top+scrollY)+"px;width:"+r.width+"px;height:"+r.height+"px;background:rgba(217,119,6,.06)";(function(f){d.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();post({type:"pick",pick:info(f)})});d.addEventListener("mousemove",function(){if(hover!==f){hover=f;post({type:"hover",pick:info(f)});later()}})})(f);shields.appendChild(d)}}
function later(){if(!raf)raf=requestAnimationFrame(function(){draw();shield()})}
function isolate(){var old=document.querySelectorAll("[data-wc-hide]");for(var i=0;i<old.length;i++)old[i].removeAttribute("data-wc-hide");if(!roots.length)return;var keep=new Set();roots.forEach(function(r){var n=r;while(n){keep.add(n);n=n.parentElement}});roots.forEach(function(r){var n=r;while(n&&n.parentElement){var sib=n.parentElement.children;for(var j=0;j<sib.length;j++){var s=sib[j];if(!keep.has(s)&&!/^(HEAD|STYLE|LINK|SCRIPT)$/.test(s.tagName)&&!s.hasAttribute("data-wc-layer"))s.setAttribute("data-wc-hide","")}n=n.parentElement}});if(roots[0]){var rr=roots[0].getBoundingClientRect();scrollTo({top:Math.max(0,scrollY+rr.top-8),left:scrollX})}}
var shiftDown=false,recordField=new Set();var CONTROL="a[href],button,input,select,textarea,label,summary,[role=button],[role=tab],[role=link],[onclick]";
var scrollTarget=null;function keepInView(){if(!scrollTarget)return;var se=byPath(scrollTarget);if(!se)return;var sr=se.getBoundingClientRect();if(sr.top<0||sr.bottom>innerHeight)scrollTo({top:Math.max(0,scrollY+sr.top-innerHeight/3),left:scrollX})}addEventListener("load",keepInView);
addEventListener("message",function(e){var m=e.data;if(!m||!m.__wc)return;if(m.type==="focus"){roots=(m.paths||[]).map(byPath).filter(Boolean);isolate();later()}else if(m.type==="highlight"){items=m.items||[];scrollTarget=m.scroll||null;keepInView();setTimeout(keepInView,400);setTimeout(keepInView,1200);later()}else if(m.type==="mode"){picking=!!m.picking;hover=null;later()}else if(m.type==="ping"){post({type:"ready"})}else if(m.type==="go"&&m.href){location.href=m.href}});
addEventListener("mousemove",function(e){var el=e.target;if(!(el instanceof Element)||el.hasAttribute("data-wc-layer"))return;if(!inRoots(el))el=null;if(!picking&&el)el=el.closest(CONTROL);if(el!==hover){hover=el;post({type:"hover",pick:el?info(el):null});later()}},true);
addEventListener("click",function(e){var el=e.target;if(!(el instanceof Element))return;if(el.hasAttribute("data-wc-layer"))return;shiftDown=e.shiftKey;
 if(picking){e.preventDefault();e.stopPropagation();var p=info(el),real=e.composedPath?e.composedPath()[0]:el;if(real!==el&&real instanceof Node)p.shadow=true;post({type:"pick",pick:p});return}
 var a=el.closest("a[href]");if(a&&!/^(#|javascript:)/.test(a.getAttribute("href")||"")){e.preventDefault();post({type:"action",action:{op:"navigate",pick:info(a),href:a.href,shift:e.shiftKey}});return}
 var c=el.closest(CONTROL);if(!c)return;if(/^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName)){if(e.shiftKey)recordField.add(c);else recordField.delete(c);if(!/^(checkbox|radio)$/.test(c.type||""))return}post({type:"action",action:{op:"click",pick:info(c),shift:e.shiftKey}})},true);
addEventListener("keydown",function(e){shiftDown=e.shiftKey},true);addEventListener("keyup",function(e){shiftDown=e.shiftKey},true);
addEventListener("change",function(e){var el=e.target;if(picking||!(el instanceof Element))return;if(/^(INPUT|TEXTAREA)$/.test(el.tagName)&&!/^(checkbox|radio|submit|button)$/.test(el.type||""))post({type:"action",action:{op:"write",pick:info(el),value:el.value,shift:recordField.has(el)}})},true);
addEventListener("submit",function(e){e.preventDefault()},true);
addEventListener("scroll",later,true);addEventListener("resize",later);
var mo=new MutationObserver(later);
addEventListener("DOMContentLoaded",function(){ensure();mo.observe(document.body,{childList:true,subtree:true});post({type:"ready"})});
})();`;

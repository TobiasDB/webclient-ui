import * as React from "react";
import { cn } from "../lib/cn";

/** A structural path: child indices from <html> down (the same element in the frame and in a
 * parsed copy of the same HTML). */
export type ElPath = number[];
export type FrameHighlight = { selector?: string; /** explicit elements (structural paths) instead of a selector */ paths?: ElPath[]; colour: string; label?: string; dashed?: boolean; /** query inside this element (the focus root); `:scope` outlines the root itself */ rootPath?: ElPath | null };
export type FramePick = { path: ElPath; tag: string; id?: string; classes: string[]; text: string };

export type PageFrameProps = {
  /** the page's HTML (a capture) */
  html: string;
  /** its URL: relative CSS / JS / images resolve against it */
  base: string;
  /** a browser-tier capture is the page AFTER its scripts ran: do not run them twice */
  stripScripts?: boolean;
  /** render only this element (siblings along its ancestors hidden; styles kept) */
  focusPath?: ElPath | null;
  highlights?: FrameHighlight[];
  /** SHIFT-click on an element */
  onPick?: (p: FramePick) => void;
  onHover?: (p: FramePick | null) => void;
  /** a link was followed (navigation stays in the workspace, not the frame) */
  onNavigate?: (href: string, link?: FramePick) => void;
  /** how many each highlight matched in the rendered page */
  onCounts?: (counts: number[]) => void;
  width?: number;
  maxHeight?: number;
  className?: string;
};

/** The page, RENDERED FOR REAL: the captured HTML in a sandboxed frame (its own CSS and JS run;
 * it never gets the workspace's origin -- no `allow-same-origin`), plus a small AGENT the frame
 * runs first: hover outlines, SHIFT-click to pick (a plain click is the page's own), highlights
 * drawn inside the page, focus isolation, link / form navigation reported instead of followed.
 * Frame and workspace talk by postMessage; elements travel as structural paths. */
export function PageFrame({ html, base, stripScripts, focusPath = null, highlights = [], onPick, onHover, onNavigate, onCounts, width = 1280, maxHeight = 760, className }: PageFrameProps) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [ready, setReady] = React.useState(false);
  const cbs = React.useRef({ onPick, onHover, onNavigate, onCounts }); cbs.current = { onPick, onHover, onNavigate, onCounts };
  const srcDoc = React.useMemo(() => withAgent(html, base, !!stripScripts), [html, base, stripScripts]);
  React.useEffect(() => { setReady(false); }, [srcDoc]);
  React.useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width))); ro.observe(el); return () => ro.disconnect(); }, [width]);
  React.useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || !e.data.__wc) return;
      const m = e.data as { type: string } & Record<string, unknown>;
      if (m.type === "ready") setReady(true);
      else if (m.type === "pick") cbs.current.onPick?.(m.pick as FramePick);
      else if (m.type === "hover") cbs.current.onHover?.((m.pick as FramePick) ?? null);
      else if (m.type === "navigate") cbs.current.onNavigate?.(String(m.href), m.pick as FramePick | undefined);
      else if (m.type === "counts") cbs.current.onCounts?.(m.counts as number[]);
    };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h);
  }, []);
  const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ __wc: 1, ...m }, "*");
  React.useEffect(() => { if (ready) post({ type: "focus", path: focusPath }); }, [ready, JSON.stringify(focusPath)]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (ready) post({ type: "highlight", items: highlights }); }, [ready, JSON.stringify(highlights)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={cn("relative w-full overflow-hidden rounded-lg border border-line bg-white", className)} style={{ height: maxHeight }}>
      <iframe ref={frame} title="page" srcDoc={srcDoc} sandbox="allow-scripts allow-forms allow-popups" className="absolute left-0 top-0 origin-top-left border-0 bg-white" style={{ width, height: maxHeight / scale, transform: `scale(${scale})` }} />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">rendering…</div>}
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-surface">shift-click to pick · the page is live-rendered</span>
    </div>
  );
}

/** The HTML with a <base> and the agent first in <head> (so its capture-phase listeners run before the page's). */
export function withAgent(html: string, base: string, strip: boolean): string {
  let h = strip ? html.replace(/<script\b[\s\S]*?<\/script>/gi, "") : html;
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
var root=null,items=[],hover=null,layer=null,raf=0;
function ensure(){if(layer&&layer.isConnected)return;layer=document.createElement("div");layer.setAttribute("data-wc-layer","");layer.style.cssText="position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647";document.documentElement.appendChild(layer);var st=document.createElement("style");st.textContent="[data-wc-hide]{display:none!important}";document.documentElement.appendChild(st)}
function mark(r,c,label,dashed,fill){var d=document.createElement("div");d.style.cssText="position:absolute;box-sizing:border-box;left:"+(r.left+scrollX)+"px;top:"+(r.top+scrollY)+"px;width:"+r.width+"px;height:"+r.height+"px;border:2px "+(dashed?"dashed ":"solid ")+c+";border-radius:3px;"+(fill?"background:"+c+"22;":"");layer.appendChild(d);if(label){var t=document.createElement("div");t.textContent=label;t.style.cssText="position:absolute;left:"+(r.left+scrollX)+"px;top:"+Math.max(0,r.top+scrollY-15)+"px;font:600 10px/14px system-ui;color:#fff;background:"+c+";padding:0 4px;border-radius:3px;white-space:nowrap";layer.appendChild(t)}}
function draw(){raf=0;ensure();layer.innerHTML="";var counts=[];for(var k=0;k<items.length;k++){var h=items[k],r0=h.rootPath?byPath(h.rootPath):document,els=[];try{els=h.paths?h.paths.map(byPath).filter(Boolean):h.selector===":scope"?(r0&&r0!==document?[r0]:[]):Array.prototype.slice.call((r0||document).querySelectorAll(h.selector))}catch(e){}counts.push(els.length);for(var i=0;i<els.length&&i<400;i++){mark(els[i].getBoundingClientRect(),h.colour,i===0&&h.label?h.label+(els.length>1?" ×"+els.length:""):null,h.dashed,false)}}if(hover)mark(hover.getBoundingClientRect(),"#f59e0b",hover.tagName.toLowerCase()+(hover.id?"#"+hover.id:"")+(hover.classList.length?"."+Array.prototype.slice.call(hover.classList,0,3).join("."):""),true,true);post({type:"counts",counts:counts})}
function later(){if(!raf)raf=requestAnimationFrame(draw)}
function isolate(){var old=document.querySelectorAll("[data-wc-hide]");for(var i=0;i<old.length;i++)old[i].removeAttribute("data-wc-hide");if(!root)return;var n=root;while(n&&n.parentElement){var sib=n.parentElement.children;for(var j=0;j<sib.length;j++){var s=sib[j];if(s!==n&&!/^(HEAD|STYLE|LINK|SCRIPT)$/.test(s.tagName)&&!s.hasAttribute("data-wc-layer"))s.setAttribute("data-wc-hide","")}n=n.parentElement}root.scrollIntoView({block:"start"})}
addEventListener("message",function(e){var m=e.data;if(!m||!m.__wc)return;if(m.type==="focus"){root=m.path?byPath(m.path):null;isolate();later()}else if(m.type==="highlight"){items=m.items||[];later()}});
addEventListener("mousemove",function(e){var el=e.target;if(!(el instanceof Element)||el.hasAttribute("data-wc-layer"))return;if(root&&!root.contains(el))el=null;if(el!==hover){hover=el;post({type:"hover",pick:el?info(el):null});later()}},true);
addEventListener("click",function(e){var el=e.target;if(!(el instanceof Element))return;if(e.shiftKey){e.preventDefault();e.stopPropagation();post({type:"pick",pick:info(el)});return}var a=el.closest("a[href]");if(a&&!/^(#|javascript:)/.test(a.getAttribute("href")||"")){e.preventDefault();post({type:"navigate",href:a.href,pick:info(a)})}},true);
addEventListener("submit",function(e){e.preventDefault();post({type:"navigate",href:(e.target&&e.target.action)||location.href})},true);
addEventListener("scroll",later,true);addEventListener("resize",later);
var mo=new MutationObserver(later);
addEventListener("DOMContentLoaded",function(){ensure();mo.observe(document.body,{childList:true,subtree:true});post({type:"ready"})});
})();`;

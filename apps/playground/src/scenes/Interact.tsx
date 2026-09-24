import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, DataFrame, ElementTable, EmptyState, Input, Player, Select, TabPanel, Tabs, Toolbar, ToolbarGroup, ToolbarSpacer, type IndexedElement, type Pick, type RREvent } from "@webclient/ui";
import { api, ApiError, type DocHandle } from "../lib/api";
import { call, plan, useSession } from "../lib/session";

/** Interact (stories 4.1-4.3): a LIVE page held by the server-side session. Open it (a
 * plan: resolve(browser, keep_alive)), watch its DOM stream in the Player, act on it by
 * pointing (click / write / scroll / wait / goto -- each a plan on that document), and
 * read what the model would see (controls). Nothing here runs outside the session. */
export function Interact() {
  const [params] = useSearchParams();
  const sessionId = useSession();
  const [draft, setDraft] = React.useState(params.get("url") ?? "");
  const [doc, setDoc] = React.useState<DocHandle | null>(null);
  const [stream, setStream] = React.useState<RREvent[]>([]);
  const since = React.useRef(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [selector, setSelector] = React.useState("");
  const [text, setText] = React.useState("");
  const [action, setAction] = React.useState<"click" | "write" | "scroll" | "wait_for" | "goto">("click");
  const [log, setLog] = React.useState<{ at: number; text: string; ok: boolean }[]>([]);
  const [tab, setTab] = React.useState("controls");
  const [pickOn, setPickOn] = React.useState(true);
  const [hover, setHover] = React.useState<Pick | null>(null);

  // the DOM stream: the session's recorder chunks for this document, polled from the bus history
  React.useEffect(() => {
    if (!doc) return;
    let on = true;
    const pull = async () => {
      try {
        const chunks = await api.history({ since: since.current, topic: "rrweb", document_id: doc.id, payload: true });
        if (!on || !chunks.length) return;
        since.current = Math.max(since.current, ...chunks.map((c) => c.n ?? 0));
        setStream((s) => [...s, ...chunks.flatMap((c) => (c.events ?? []) as RREvent[])]);
      } catch { /* the API blinked; next tick */ }
    };
    pull();
    const t = setInterval(pull, 700);
    return () => { on = false; clearInterval(t); };
  }, [doc]);

  const open = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!sessionId || !draft) return;
    setBusy("opening"); setError(null); setStream([]); since.current = 0;
    try { const h = await api.executeDoc({ plan: plan("Reference", [call("resolve", [], { browser: true, keep_alive: true })], sessionId), url: draft }); setDoc(h); note(`opened ${h.title ?? h.url}`, true); }
    catch (err) { setError(err as ApiError); }
    finally { setBusy(null); }
  };
  const note = (t: string, ok: boolean) => setLog((l) => [...l.slice(-30), { at: Date.now(), text: t, ok }]);
  const act = async (kind = action, sel = selector, val = text) => {
    if (!doc || !sessionId) return;
    const steps = kind === "click" ? call("click", [sel]) : kind === "write" ? call("write", [sel, val]) : kind === "scroll" ? call("scroll", sel ? [sel] : []) : kind === "wait_for" ? call("wait_for", [sel]) : call("goto", [val || sel]);
    setBusy(kind); setError(null);
    try { const h = await api.executeDoc({ plan: plan("Document", [steps], sessionId), document_id: doc.id }); setDoc((d) => d ? { ...d, url: h.url, title: h.title } : h); note(`${kind}${sel ? ` ${sel}` : ""}${val && kind === "write" ? ` "${val}"` : ""}`, true); controls.refetch(); }
    catch (err) { setError(err as ApiError); note(`${kind} ${sel} failed: ${(err as ApiError).detail?.code ?? ""}`, false); }
    finally { setBusy(null); }
  };
  const controls = useQuery({ queryKey: ["controls", doc?.id], enabled: !!doc && !!sessionId,
    queryFn: async () => { const out = await api.execute({ plan: plan("Document", [call("controls")], sessionId), document_id: doc!.id }); return ((out.rows as { __model__?: string; data?: IndexedElement }[]) ?? []).map((m) => (m as any).data ?? m) as IndexedElement[]; } });
  const rowsQ = useQuery({ queryKey: ["live-rows", doc?.id, selector], enabled: false,
    queryFn: async () => { const out = await api.execute({ plan: plan("Document", [call("select_all", [selector]), call("extract", [], {}), call("project")], sessionId), document_id: doc!.id }); return (out.rows as Record<string, unknown>[]) ?? []; } });
  const onPick = (p: Pick) => { setSelector(p.selector === p.tag ? p.path : p.selector); };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar className="flex-wrap">
        <form onSubmit={open} className="flex min-w-[280px] flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="open a page live in your session" className="w-full" /></ToolbarGroup>
          <Button variant="primary" type="submit" size="sm" disabled={!sessionId || busy === "opening"}>{busy === "opening" ? "opening…" : doc ? "Open another" : "Open live"}</Button>
        </form>
        <ToolbarSpacer />
        <Chip tone={sessionId ? "ok" : "warn"} dot>{sessionId ? `session ${sessionId.slice(0, 8)}` : "no session"}</Chip>
        {doc && <Chip tone="accent">{doc.title ?? doc.url}</Chip>}
      </Toolbar>
      {!doc ? <EmptyState title="Open a page live" hint="The page is held by the server inside your session; you see its DOM as it changes, and every action you take is a plan on that document." /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <Chip tone={pickOn ? "accent" : "neutral"} interactive onClick={() => setPickOn(!pickOn)}>{pickOn ? "picking: click an element to target it" : "pick off"}</Chip>
            {hover && <span className="truncate font-mono text-[11px] text-muted">{hover.selector}{hover.classes.length > 1 ? ` · ${hover.classes.join(" ")}` : ""}</span>}
            <span className="flex-1" />
            <span className="font-mono text-[11px] text-muted">{stream.length} DOM events</span>
          </div>
          <Player events={stream} live highlights={selector ? [{ selector, label: "target", tone: "warn" }] : []} pickable={pickOn} onPick={onPick} onHover={setHover} maxHeight={720} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-line p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Act on the page</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className="h-8"><option value="click">click</option><option value="write">write</option><option value="scroll">scroll</option><option value="wait_for">wait for</option><option value="goto">goto</option></Select>
              <Input mono value={selector} onChange={(e) => setSelector(e.target.value)} placeholder={action === "goto" ? "url" : "selector (or pick in the page)"} className="h-8 min-w-[160px] flex-1" />
              {action === "write" && <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="text" className="h-8 w-36" />}
              <Button variant="primary" size="sm" onClick={() => act()} disabled={!!busy || (!selector && action !== "scroll" && action !== "goto")}>{busy && busy !== "opening" ? `${busy}…` : "Do it"}</Button>
            </div>
            {error && <div className="mt-2 text-[12px]"><Chip tone="bad">{error.detail?.code ?? error.status}</Chip> {error.detail?.hint ?? error.message}{error.detail?.remedy && <> — remedy: <b>{error.detail.remedy}</b></>}</div>}
            <ul className="mt-2 max-h-28 overflow-auto font-mono text-[11px]">{log.slice().reverse().map((l) => <li key={l.at} className={l.ok ? "text-muted" : "text-bad"}>{new Date(l.at).toLocaleTimeString()} · {l.text}</li>)}</ul>
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "controls", label: "Controls", count: controls.data?.length }, { value: "rows", label: "Rows here" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="controls" className="max-h-[520px] overflow-auto">{controls.data ? <ElementTable elements={controls.data} onSelect={(el) => setSelector(el.selector)} /> : <span className="p-3 text-[12px] text-muted">reading the controls…</span>}</TabPanel>
              <TabPanel value="rows" className="p-2">
                <div className="mb-2 flex items-center gap-2 text-[12px]"><span className="text-muted">select_all(target) on the live page:</span><Button size="sm" onClick={() => rowsQ.refetch()} disabled={!selector}>run</Button></div>
                {rowsQ.data ? <DataFrame rows={rowsQ.data} className="max-h-[420px]" /> : <span className="text-[12px] text-muted">pick a target, then run.</span>}
              </TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
    </div>
  );
}

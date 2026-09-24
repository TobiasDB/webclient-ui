import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, EmptyState, ElementTable, FlagRow, Input, Player, Select, SkeletonPane, TabPanel, Tabs, TierLadder,
  Toolbar, ToolbarGroup, ToolbarSpacer, toolAsCode, type Highlight, type Pick,
} from "@webclient/ui";
import { API_URL, api, ApiError } from "../lib/api";
import { useActive, useSession } from "../lib/session";

/** Explore (stories 1.1-1.3): the page (the Player, most of the screen), a compact strip
 * of what it is (card · tier · flags with evidence), the next actions, and the views a
 * model reads (skeleton / elements / markdown). ONE request fetches it all. */
export function Explore() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const sessionId = useSession();
  const active = useActive("/explore");
  // the URL is read only while this workspace is on screen (hidden ones keep their last)
  const [own, setOwn] = React.useState(() => new URLSearchParams(params));
  React.useEffect(() => { if (active) setOwn(new URLSearchParams(params)); }, [active, params]);
  const docId = own.get("doc") ?? "";
  const wantUrl = own.get("url") ?? "";
  const tier = own.get("tier") ?? "false";
  const [draft, setDraft] = React.useState(wantUrl);
  const browser = tier === "auto" ? "auto" : tier === "always" ? "always" : false;
  const [openError, setOpenError] = React.useState<ApiError | null>(null);
  // a ?url= is OPENED into the session (a static capture, or a live page under a browser tier)
  // and the workspace then works on that document by id -- listed at the top, reloadable
  React.useEffect(() => {
    if (!active || !sessionId || !wantUrl || docId) return;
    let on = true;
    api.docOpen(sessionId, { url: wantUrl, browser }).then((h) => { if (on) setParams({ doc: h.id, tier }, { replace: true }); }).catch((e) => { if (on) setOpenError(e as ApiError); });
    return () => { on = false; };
  }, [active, sessionId, wantUrl, docId, browser, tier, setParams]);
  const snap = useQuery({ queryKey: ["doc-views", sessionId, docId, "explore"], queryFn: () => api.docViews(sessionId!, docId, ["card", "rrweb", "patterns", "records", "flags", "content"]), enabled: !!sessionId && !!docId, staleTime: Infinity });
  const url = snap.data?.url ?? wantUrl;
  React.useEffect(() => { if (url) setDraft(url); }, [url]);
  const more = useQuery({ queryKey: ["doc-views", sessionId, docId, "more"], queryFn: () => api.docViews(sessionId!, docId, ["skeleton", "controls", "markdown"]), enabled: !!sessionId && !!docId && snap.isSuccess, staleTime: Infinity });
  const skeleton = { data: more.data?.skeleton }; const controls = { data: more.data?.controls }; const markdown = { data: more.data?.markdown };
  const [tab, setTab] = React.useState("skeleton");
  const [hover, setHover] = React.useState<Pick | null>(null);
  const [showRecords, setShowRecords] = React.useState(true);

  const go = (e: React.FormEvent) => { e.preventDefault(); if (draft) { setOpenError(null); setParams({ url: draft, tier }); } };
  const card = snap.data?.card;
  const flags = snap.data?.flags ?? [];
  const recordHint = snap.data?.patterns?.find((p) => p.name === "record_list");
  const highlights: Highlight[] = [
    ...(showRecords && recordHint ? [{ selector: recordHint.subject, label: `record list ×${recordHint.count}`, tone: "accent" as const }] : []),
  ];
  const err = (snap.error as ApiError | null) ?? openError;
  const present = (name: string) => flags.some((f) => f.present && f.name === name);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar className="flex-wrap">
        <form onSubmit={go} className="flex min-w-[280px] flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://…" className="w-full" /></ToolbarGroup>
          <Select value={tier} onChange={(e) => setParams({ url: url || draft, tier: e.target.value })}><option value="false">static</option><option value="auto">auto</option><option value="always">browser</option></Select>
          {snap.data?.live && <Chip tone="ok" dot>live page</Chip>}
          <Button variant="primary" type="submit" size="sm" disabled={snap.isFetching}>{snap.isFetching ? "Exploring…" : "Explore"}</Button>
        </form>
        <ToolbarSpacer />
        {card && <>
          <Chip tone="neutral">{card.kind} · {card.status_code}</Chip>
          <TierLadder escalation={card.escalation} />
        </>}
      </Toolbar>
      {!url && !docId ? <EmptyState title="Paste a URL to explore" hint="You'll see the page, what's notable (with evidence), and where the data is. The page is opened into your session and stays listed at the top." /> :
       err ? <EmptyState title={`The fetch failed · ${err.code ?? err.status}`} hint={<>{err.hint ?? err.message}{err.remedy && <> — remedy: <b>{err.remedy}</b></>}</>}
              action={err.remedy === "browser" ? <Button variant="primary" onClick={() => setParams({ url, tier: "always" })}>Re-explore with a browser</Button> : undefined} /> :
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <b className="truncate text-[13px]">{card?.title ?? "…"}</b>
            <span className="truncate font-mono text-[11px] text-muted">{card?.final_url ?? url}</span>
            <span className="flex-1" />
            {recordHint && <Chip tone="accent" interactive onClick={() => setShowRecords(!showRecords)}>{showRecords ? "hide" : "show"} record list ×{recordHint.count}</Chip>}
            {hover && <span className="font-mono text-[11px] text-muted">{hover.selector}{hover.classes.length > 1 ? ` · ${hover.classes.join(" ")}` : ""}</span>}
          </div>
          {snap.data?.rrweb ? <Player events={snap.data.rrweb as any} highlights={highlights} pickable onHover={setHover} onPick={(p) => nav(`/query?doc=${encodeURIComponent(docId)}&tier=${tier}&record=${encodeURIComponent(p.selector)}`)} controls={false} maxHeight={760} />
            : snap.data ? <pre className="max-h-[600px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px]">{(snap.data.content ?? "").slice(0, 20000)}</pre> : <EmptyState title="Fetching…" />}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-line p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Flags — click for evidence</div>
            {snap.data ? <FlagRow flags={flags} empty="nothing notable — a plain page" /> : <span className="text-[12px] text-muted">detecting…</span>}
            {card?.description && <p className="mt-2 text-[12px] text-muted">{card.description}</p>}
          </section>
          <section className="rounded-lg border border-line p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Next</div>
            <div className="flex flex-wrap gap-1.5">
              {recordHint && <Button variant="primary" size="sm" onClick={() => nav(`/query?doc=${encodeURIComponent(docId)}&tier=${tier}&record=${encodeURIComponent(recordHint.subject)}`)}>Extract {recordHint.subject} ×{recordHint.count}</Button>}
              {!recordHint && <Button size="sm" onClick={() => nav(`/query?doc=${encodeURIComponent(docId)}&tier=${tier}`)}>Build a query by pointing</Button>}
              {present("spa") && tier !== "always" && <Button size="sm" onClick={() => setParams({ url, tier: "always" })}>Needs a browser — re-explore rendered</Button>}
              {present("pagination") && <Button size="sm" onClick={() => nav(`/query?doc=${encodeURIComponent(docId)}&tier=${tier}&paginate=link`)}>Follow the pagination</Button>}
              {present("login_required") && <Button size="sm" onClick={() => nav(snap.data?.live ? `/interact?doc=${encodeURIComponent(docId)}` : `/interact?url=${encodeURIComponent(url)}`)}>Needs a login — open it live</Button>}
              <Button size="sm" variant="ghost" onClick={() => nav(snap.data?.live ? `/interact?doc=${encodeURIComponent(docId)}` : `/interact?url=${encodeURIComponent(url)}`)}>{snap.data?.live ? "Drive it" : "Open live"}</Button>
              <Button size="sm" variant="ghost" onClick={() => nav(`/loops?seed=${encodeURIComponent(url)}`)}>Crawl from here</Button>
            </div>
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line">
            <Tabs items={[{ value: "skeleton", label: "Skeleton" }, { value: "elements", label: "Elements", count: controls.data?.length }, { value: "markdown", label: "Markdown" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <TabPanel value="skeleton" className="max-h-[520px] overflow-auto p-2">{skeleton.data ? <SkeletonPane skeleton={skeleton.data} active={hover ? "<" + hover.tag : null} /> : <span className="text-muted">…</span>}</TabPanel>
              <TabPanel value="elements" className="max-h-[520px] overflow-auto">{controls.data && <ElementTable elements={controls.data} />}</TabPanel>
              <TabPanel value="markdown" className="max-h-[520px] overflow-auto p-3"><pre className="whitespace-pre-wrap font-sans text-[13px]">{markdown.data ?? "…"}</pre></TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("card", { url }, API_URL)} /></TabPanel>
            </Tabs>
          </section>
        </div>
      </div>}
    </div>
  );
}

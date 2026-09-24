import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, EmptyState, ElementTable, FlagRow, Input, KeyValue, Panel, Preview, Select, SkeletonPane, TabPanel, Tabs,
  TierLadder, Toolbar, ToolbarGroup, ToolbarSpacer, toolAsCode, type Highlight, type PatternHint,
} from "@webclient/ui";
import { api, ApiError } from "../lib/api";

/** Explore (stories 1.1-1.3): URL -> preview with hints · card · tier ladder · flags with
 * evidence · next actions · skeleton / elements / markdown / as code. */
export function Explore() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const url = params.get("url") ?? "";
  const tier = params.get("tier") ?? "false";
  const [draft, setDraft] = React.useState(url);
  const browser = tier === "auto" ? "auto" : tier === "always" ? "always" : false;
  const snap = useQuery({ queryKey: ["snapshot", url, tier], queryFn: () => api.snapshot(url, browser), enabled: !!url });
  const flags = useQuery({ queryKey: ["flags", url, tier], queryFn: () => api.flags(url, browser), enabled: !!url });
  const patterns = useQuery({ queryKey: ["patterns", url], queryFn: () => api.patterns(url), enabled: !!url && snap.isSuccess });
  const skeleton = useQuery({ queryKey: ["skeleton", url, tier], queryFn: () => api.skeleton(url, browser), enabled: !!url && snap.isSuccess });
  const controls = useQuery({ queryKey: ["elements", url, "interactive"], queryFn: () => api.elements(url, "interactive", browser), enabled: !!url && snap.isSuccess });
  const markdown = useQuery({ queryKey: ["markdown", url], queryFn: () => api.markdown(url), enabled: !!url && snap.isSuccess });
  const [tab, setTab] = React.useState("skeleton");
  const [hover, setHover] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<PatternHint | null>(null);

  const go = (e: React.FormEvent) => { e.preventDefault(); if (draft) setParams({ url: draft, tier }); };
  const card = snap.data?.card;
  const recordHint = patterns.data?.find((p) => p.name === "record_list");
  const highlights: Highlight[] = [
    ...(hint ? [{ selector: hint.subject, label: hint.name.replace("_", " "), tone: "accent" as const }] : []),
    ...(hover ? [{ selector: hover, tone: "ok" as const }] : []),
  ];
  const err = snap.error as ApiError | null;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <form onSubmit={go} className="flex flex-1 items-center gap-2">
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://…" className="w-full" /></ToolbarGroup>
          <Select value={tier} onChange={(e) => setParams({ url: url || draft, tier: e.target.value })}><option value="false">static</option><option value="auto">auto</option><option value="always">always (browser)</option></Select>
          <Button variant="primary" type="submit" size="sm" disabled={snap.isFetching}>{snap.isFetching ? "Exploring…" : "Explore"}</Button>
        </form>
        <ToolbarSpacer />
        {card && <Chip tone="neutral">{card.kind} · {card.status_code}</Chip>}
      </Toolbar>
      {!url ? <EmptyState title="Paste a URL to explore" hint="You'll see the page, what's notable (with evidence), and where the data is." /> :
       err ? <EmptyState title={`The fetch failed · ${err.code ?? err.status}`} hint={<>{err.hint ?? err.message}{err.remedy && <> — remedy: <b>{err.remedy}</b></>}</>}
              action={err.remedy === "browser" ? <Button variant="primary" onClick={() => setParams({ url, tier: "always" })}>Re-explore with a browser</Button> : undefined} /> :
      <div className="grid min-h-0 flex-1 grid-cols-[1.2fr_1fr_0.9fr] gap-3 p-3">
        <Panel title="Preview" flush actions={recordHint && <Chip tone="accent" interactive onClick={() => setHint(hint ? null : recordHint)}>{hint ? "hide" : "show"} record list ×{recordHint.count}</Chip>}>
          {snap.data ? <Preview html={snap.data.kind === "html" ? snap.data.content : `<pre>${snap.data.content.replace(/</g, "&lt;")}</pre>`} highlights={highlights} className="h-full rounded-none border-0" baseUrl={card?.final_url}
            onPick={(p) => nav(`/query?url=${encodeURIComponent(url)}&pick=${encodeURIComponent(p.path)}`)} /> : <EmptyState title="Fetching…" />}
        </Panel>
        <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-3">
          <Panel title="Card">{card && <KeyValue rows={[["title", card.title ?? "—"], ["url", card.final_url ?? card.url], ["kind", card.kind], ["description", card.description ?? "—"]]} />}</Panel>
          <Panel title="Transport">{card && <TierLadder escalation={card.escalation} />}</Panel>
          <Panel title="Flags — click for evidence">{flags.data ? <FlagRow flags={flags.data} empty="nothing notable — a plain page" /> : <span className="text-[12px] text-muted">detecting…</span>}</Panel>
        </div>
        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3">
          <Panel title="Next actions">
            <div className="flex flex-col gap-1.5">
              {recordHint && <Button variant="primary" size="sm" onClick={() => nav(`/query?url=${encodeURIComponent(url)}&record=${encodeURIComponent(recordHint.subject)}`)}>Extract this list — {recordHint.subject} ×{recordHint.count}</Button>}
              {flags.data?.some((f) => f.present && f.name === "spa") && tier !== "always" && <Button size="sm" onClick={() => setParams({ url, tier: "always" })}>Needs a browser — re-explore rendered</Button>}
              {flags.data?.some((f) => f.present && f.name === "pagination") && <Button size="sm" onClick={() => nav(`/query?url=${encodeURIComponent(url)}&paginate=link`)}>Follow the pagination</Button>}
              {flags.data?.some((f) => f.present && f.name === "login_required") && <Chip tone="bad">needs a login — use a session (Interact, later)</Chip>}
              <Button size="sm" variant="ghost" onClick={() => nav(`/loops?seed=${encodeURIComponent(url)}`)}>Crawl from here</Button>
            </div>
          </Panel>
          <Panel flush className="min-h-0">
            <Tabs items={[{ value: "skeleton", label: "Skeleton" }, { value: "elements", label: "Elements", count: controls.data?.length }, { value: "markdown", label: "Markdown" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="h-full">
              <TabPanel value="skeleton" className="p-2">{skeleton.data ? <SkeletonPane skeleton={skeleton.data} active={hover ? "<" + (hover.split(" > ").pop()?.split(":")[0] ?? "") : null} /> : <span className="text-muted">…</span>}</TabPanel>
              <TabPanel value="elements">{controls.data && <ElementTable elements={controls.data} onHover={(e) => setHover(e?.selector ?? null)} />}</TabPanel>
              <TabPanel value="markdown" className="p-3"><pre className="whitespace-pre-wrap font-sans text-[13px]">{markdown.data ?? "…"}</pre></TabPanel>
              <TabPanel value="code"><AsCode {...toolAsCode("card", { url })} /></TabPanel>
            </Tabs>
          </Panel>
        </div>
      </div>}
    </div>
  );
}

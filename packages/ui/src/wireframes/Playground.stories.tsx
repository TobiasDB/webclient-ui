import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Frame, Box, Row, Col, Lines, Pill } from "./Wire";

/** LOW-FI WIREFRAMES for the Playground's key screens, in the design order from
 * docs/product/playground-user-stories.md §6. Each story is the agreed layout + hierarchy +
 * flow for one screen; the real components replace the boxes one by one. */
const meta: Meta = { title: "Wireframes/Playground", parameters: { layout: "fullscreen" } };
export default meta;

const Shell = ({ title, workspace, children }: { title: string; workspace: string; children: React.ReactNode }) => (
  <Frame title={title}>
    <Col rows="36px 1fr 120px">
      <Row cols="180px 1fr 260px">
        <Box tone="nav" label="WebClient · Playground" />
        <Box tone="nav" label={`workspace tabs: Home · Explore · Query · Crawl · Interact · Onboard · Runs · Traces · Tools · Settings   [${workspace}]`} />
        <Box tone="nav" label="⌘K · theme · model badge (stub)" />
      </Row>
      {children}
      <Box tone="muted" label="RUN BAR (10.2): the live event stream for this session — topic filter · pause · start trace · click → Traces" note="one line per event: #n topic doc brief · the same colours as the timeline" />
    </Col>
  </Frame>
);

export const Explore: StoryObj = {
  name: "1 · Explore (1.1–1.3)",
  render: () => (
    <Shell title="Explore" workspace="Explore">
      <Col rows="44px 1fr">
        <Row cols="1fr 160px 120px">
          <Box tone="box" label="URL input (mono) — paste any page" />
          <Box tone="box" label="tier: static · auto · always" />
          <Box tone="primary" label="Explore" />
        </Row>
        <Row cols="1.2fr 1fr 0.9fr">
          <Box label="PREVIEW" note="the captured page (snapshot) rendered in a sandboxed frame; pattern hints outlined on hover; click a region → 'Extract this list' (hands off to Query)">
            <Lines n={8} />
            <Pill>record list ×24</Pill><Pill>repeated control ×24</Pill>
          </Box>
          <Col rows="auto auto 1fr">
            <Box label="CARD" note="title · kind · status · final url · description"><Lines n={2} /></Box>
            <Box label="TIER LADDER" note="static → proxy → browser, the hops taken lit, timing + the deciding flag; an Ask offers the next rung" />
            <Box label="FLAGS (evidence on click)" note="chips most-actionable first; each opens its signals · stage · confidence · remedy">
              <Pill>spa 84% → browser</Pill><Pill>pagination 70%</Pill><Pill>forms</Pill>
            </Box>
          </Col>
          <Col rows="auto 1fr">
            <Box tone="primary" label="NEXT ACTIONS" note="Extract this list · Needs a browser (re-explore with always) · Needs a login (open Interact) · Follow pagination · Crawl from here" />
            <Box label="TABS: skeleton · element table · markdown · text · network (XHR→DOM) · events · as code" note="skeleton/element table hover-link to the preview (1.2); network shows 'this region came from request #3' (1.5)"><Lines n={10} /></Box>
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const QueryBuilder: StoryObj = {
  name: "2 · Query builder (2.1–2.3)",
  render: () => (
    <Shell title="Query builder" workspace="Query">
      <Col rows="44px 1fr">
        <Row cols="1fr auto auto auto">
          <Box label="source: the explored page (url) · re-fetch" />
          <Box label="pagination: none · rel=next · ?page= · cursor  · max pages" />
          <Box label="author with model (stub) ▸" />
          <Box tone="primary" label="Run" />
        </Row>
        <Row cols="1.2fr 1fr">
          <Box label="PREVIEW — PICK BY POINTING" note="1) click a repeating region (or accept the top hint) → outlined with ×N badge; 2) click fields inside ONE record → coloured chips name the columns; hover highlights every instance">
            <Lines n={6} /><Pill>record: div.card ×24</Pill><Pill>title</Pill><Pill>price (data-price)</Pill><Pill>link (href)</Pill>
          </Box>
          <Col rows="1fr auto auto">
            <Box label="ROWS (live)" note="the table updates on every change; page N of M when paginating; a 0-row state explains why (the ledger hint) and offers the nearest selector"><Lines n={8} /></Box>
            <Box label="COLUMNS" note="name · source (text / attr / regex) · sample · required · type (P3)" />
            <Box label="PLAN: wireframe · explain · blob  |  as code (python / http / mcp)  |  save · download · schedule (P2)" />
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const TraceTimeline: StoryObj = {
  name: "3 · Trace timeline (7.1–7.3)",
  render: () => (
    <Shell title="Trace timeline" workspace="Traces">
      <Col rows="44px 1fr">
        <Row cols="220px 1fr auto auto">
          <Box label="trace: demo · 68 events · 2.3 s" />
          <Box label="filter: topics [chips] · document · search" />
          <Box label="replay: inspect offline · re-run from HAR · re-run live (with drift compare)" />
          <Box label="share · export zip" />
        </Row>
        <Row cols="1fr 1fr">
          <Col rows="auto 1fr">
            <Box label="TIME AXIS + SCRUBBER" note="one axis; lanes: network · dom · action · loop/pipeline · error · resource · snapshot markers; drag the scrubber → everything on the right follows"><Lines n={5} /></Box>
            <Box label="EVENT LIST (grouped by document / loop round, collapsible)" note="#n · topic (coloured) · brief · click → detail; the row at the scrubber is highlighted"><Lines n={10} /></Box>
          </Col>
          <Col rows="1fr 1fr">
            <Box label="AT THE SCRUBBER: snapshot · DOM replay (rrweb) · network request/response · event JSON" note="tabs; the snapshot pane shows the document as captured at that moment; rrweb seeks to the same time"><Lines n={6} /></Box>
            <Box label="LEDGER" note="every error: code · remedy · op · subject · 'jump to moment'; resources lane summary (waits, quota, RSS)"><Lines n={4} /></Box>
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const ConfirmGate: StoryObj = {
  name: "4 · Confirm gate (5.2, non-technical)",
  render: () => (
    <Frame title="Confirm gate — shareable, jargon-free">
      <Col rows="48px 1fr 64px">
        <Box tone="nav" label="WebClient · Review a source   ·   brief: 'the company's case studies with dates'   ·   requested by Dana, 2 min ago" />
        <Row cols="1fr 1fr">
          <Box label="THE PAGE" note="a large preview of the chosen page with the record list outlined; 'open the real page' link"><Lines n={12} /></Box>
          <Col rows="auto auto 1fr">
            <Box label="WHAT WE FOUND" note="plain-language assessment: 'This page lists 24 case studies. It has all the fields you asked for. It is paginated (3 pages). It does not need a login.'" />
            <Box label="SAMPLE ROWS (5)" note="the columns you asked for, as they would be extracted"><Lines n={5} /></Box>
            <Box label="OTHER CANDIDATES" note="2 alternatives with one-line reasons; 'pick this one instead'" />
          </Col>
        </Row>
        <Row cols="1fr auto auto auto">
          <Box tone="muted" label="comment (optional)" />
          <Box label="pick another" />
          <Box label="No, stop" />
          <Box tone="primary" label="Yes, use this source" />
        </Row>
      </Col>
    </Frame>
  ),
};

export const CrawlMap: StoryObj = {
  name: "5 · Crawl map (3.1–3.2)",
  render: () => (
    <Shell title="Crawl" workspace="Crawl">
      <Col rows="44px 1fr">
        <Row cols="1fr auto auto auto auto">
          <Box label="seeds (urls / sitemap) · scope: same origin ✓ · limits: 20 pages · depth 3 · width 5" />
          <Box label="mode: auto (best-first) · manual · locate until… " />
          <Box label="driver: heuristic · model (stub)" />
          <Box label="step ▸ · run ▶ · pause ⏸" />
          <Box tone="primary" label="Start" />
        </Row>
        <Row cols="1.3fr 1fr">
          <Box label="FRONTIER MAP" note="pages as nodes (card on hover, click → Explore), edges scored (thickness), fetched / queued / robots-blocked / failed states; resources dropped; round-by-round animation"><Lines n={10} /></Box>
          <Col rows="auto 1fr auto">
            <Box tone="primary" label="DECISION CARD (when the driver asks)" note="'which edges next?' · ranked frontier with scores + reasons · pick some · resume" />
            <Box label="FRONTIER TABLE" note="sortable: score · url · text · depth · region; multi-select for manual picks"><Lines n={8} /></Box>
            <Box label="ROUNDS" note="stepper: round n · fetched k/m · frontier size · failures; LoopEvents" />
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const Interact: StoryObj = {
  name: "6 · Interact (4.1–4.2)",
  render: () => (
    <Shell title="Interact" workspace="Interact">
      <Col rows="44px 1fr">
        <Row cols="1fr auto auto auto">
          <Box label="url · open a live page (browser=always)" />
          <Box label="● record → plan" />
          <Box label="scripts: rrweb ✓ · custom probes" />
          <Box label="model policy ▸ (4.3)" />
        </Row>
        <Row cols="1.3fr 1fr">
          <Box label="LIVE MIRROR" note="the page as it is now (rrweb live mirror or screenshot stream); click an element → action menu (click / type / wait / scroll); hover-linked to the element table"><Lines n={12} /></Box>
          <Col rows="1fr 1fr auto">
            <Box label="ELEMENT TABLE (numbered, class-free)" note="N · role · name · repeats; click → act on it; the model sees exactly this"><Lines n={8} /></Box>
            <Box label="STEPS (the recording)" note="resolve → write #qty '2' → click #add → wait #cart li … · each step re-playable · 'hand the reached page to Query'"><Lines n={4} /></Box>
            <Box label="console · network (streams)" />
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const Onboard: StoryObj = {
  name: "7 · Onboard (5.1, configurable)",
  render: () => (
    <Shell title="Onboard" workspace="Onboard">
      <Col rows="auto 88px 1fr">
        <Box label="BRIEF + OPTIONS (collapsible form)" note="brief: description · fields · search terms (templates ▸) | seeds: search · paste URLs | model: stub (badged) / configured key · budget $ | tier · max pages · rounds · review ✓ | Run" />
        <Box label="STAGE RAIL" note="search → crawl → select → evaluate → confirm → source → query; status / gate / review per node; PipelineEvents drive it; click a node to expand" />
        <Row cols="1fr 1fr">
          <Box label="SELECTED STAGE: artefacts" note="seeds list · crawl map · candidates ranked · evaluation (queryable? complete? paginated?) · flags · the authored query + sample rows"><Lines n={10} /></Box>
          <Col rows="auto 1fr">
            <Box tone="primary" label="GATE / ASK" note="the confirm gate inline (or 'open the review screen' — shareable)" />
            <Box label="RESULT" note="the tested blob · rows · cost · 'open in Query' · 'schedule' (P2) · the trace link"><Lines n={6} /></Box>
          </Col>
        </Row>
      </Col>
    </Shell>
  ),
};

export const ToolsAndSettings: StoryObj = {
  name: "8 · Tools · Settings (8.1, 9.x)",
  render: () => (
    <Shell title="Tools / Settings" workspace="Tools">
      <Row cols="1fr 1fr">
        <Col rows="auto 1fr">
          <Box label="TOOLS: list (name · story · description) — search" />
          <Row cols="1fr 1fr">
            <Box label="FORM from the input schema" note="fields typed from JSON Schema; defaults; required; Run"><Lines n={6} /></Box>
            <Box label="RESULT rendered by type" note="rows → table · markdown → rendered · card → chips · list → list  |  as code: python · http · mcp"><Lines n={6} /></Box>
          </Row>
        </Col>
        <Col rows="auto auto auto 1fr">
          <Box label="SETTINGS · Model" note="Anthropic key (server-side, never echoed) · model · budget · [stub is the default, badged everywhere]" />
          <Box label="SETTINGS · Scripts" note="list with enable/disable · policy allow/deny · runs" />
          <Box label="SETTINGS · Drivers & policies" note="resolve driver · crawl driver · retry / rate / proxy / antibot / browser forms" />
          <Box label="SETTINGS · Sessions & limits" note="sessions: id · ttl · pages held · quota · close  |  limits read-only with env names" />
        </Col>
      </Row>
    </Shell>
  ),
};

export const HomeAndRuns: StoryObj = {
  name: "9 · Home · Runs",
  render: () => (
    <Shell title="Home" workspace="Home">
      <Row cols="1fr 1fr 1fr">
        <Box tone="primary" label="START WITH A URL" note="one input → Explore; or drop a blob → Query; or a brief → Onboard" />
        <Box label="RECENT RUNS" note="status · rows · duration · cost · trace"><Lines n={6} /></Box>
        <Box label="SAVED (P2)" note="queries · briefs · views"><Lines n={4} /></Box>
      </Row>
    </Shell>
  ),
};

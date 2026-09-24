import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Frame, Box, Row, Col, Lines, Pill } from "./Wire";

const meta: Meta = { title: "Wireframes/Author", parameters: { layout: "fullscreen" } };
export default meta;

/** The frame every Author story shares (see docs/product/author-workspace.md): the loaded
 * strip, ONE address bar, the mode row, the page on the left, the stages / this stage /
 * rows column on the right, the media bar when something plays. */
function Shell({ mode, record, page, bar, stage2 }: { mode: "look" | "pick" | "drive"; record?: string; page: React.ReactNode; bar?: boolean; stage2?: boolean }) {
  const on = (m: string) => (m === mode ? "▣ " : "▢ ");
  return (
    <Frame title="Author — one page, one plan (built without modes: the click menu is the object's ops; see the Menu story)">
      <Col rows="auto auto auto minmax(0,1fr) auto" className="h-full">
        <Box label="loaded (the session's documents)" tone="nav" note="pages 3/4 free · release"><Pill>● case-studies · static</Pill><Pill>● cost · live</Pill><Pill>○ product/1 · static</Pill></Box>
        <Box label="address bar" tone="nav" note="the tier is always here; changing it re-opens the page"><Pill>http://…/case-studies</Pill><Pill>auto ▾</Pill><Pill>Open</Pill><Pill>⟳ reload</Pill><Pill>● session</Pill></Box>
        <Box label="mode + what is selected" tone="muted" note="one line, fixed height: nothing here may move the page"><Pill>{on("look")}look</Pill><Pill>{on("pick")}pick</Pill><Pill>{on("drive")}drive</Pill>{record && <Pill>record: {record} ×4 · <b>.row</b> ·rounded-lg ·border ·p-4</Pill>}</Box>
        <Row cols="minmax(0,1.4fr) minmax(0,1fr)">
          <Box label="THE PAGE (Player)" grow note={mode === "look" ? "flags · record list outlined · controls dotted" : mode === "pick" ? "record (accent) · fields (colours) · hover box dashed" : "the LIVE page · the pointer on its human path · the DOM stream"}>{page}</Box>
          <Col rows="auto auto minmax(0,1fr)">
            <Box label="STAGES (the plan's pages)" note="+ follow a link · + paginate · + drive step"><Pill>① listing · case-studies · ✓ 4 rows</Pill>{stage2 && <Pill>② detail · ↳ a.name (each) · 2 fields</Pill>}</Box>
            <Box label="THIS STAGE" note="record · fields (used class lit) · recorded steps"><Pill>record article.row ×4 · detected 100%</Pill><Pill>a<b>.name</b> ✓</Pill><Pill>time ✓</Pill><Pill>span<b>.sector</b></Pill><Pill>span<b>.outcome</b></Pill><Pill>steps: click #load · wait .row</Pill></Box>
            <Box label="ROWS · local 4 · server 4 ✓" grow note="Run ▶ · drawers: Plan · As code · Flags · Skeleton · Events"><Lines n={4} /></Box>
          </Col>
        </Row>
        {bar ? <Box label="media bar (drive / replay only)" tone="nav"><Pill>▶</Pill><Pill>⏮</Pill><Pill>⏭</Pill><Pill>0:02.3 / 0:14.0</Pill><Pill>──●──────────</Pill><Pill>beat 0.9 s</Pill><Pill>1×</Pill></Box> : <Box label="(no media bar in look / pick)" tone="muted" />}
      </Col>
    </Frame>
  );
}

export const Look: StoryObj = { name: "A1-A2 · look: the page, its flags, the record list, the controls",
  render: () => <Shell mode="look" page={<><Pill>spa 90%</Pill><Pill>pagination</Pill><Pill>forms</Pill><Lines n={5} /></>} /> };

export const Pick: StoryObj = { name: "A3-A4 · pick: the record and the fields, the used class lit",
  render: () => <Shell mode="pick" record="article.row" page={<><Pill>hover: a<b>.name</b> ·text-accent “Price monitor across 40 retailers”</Pill><Lines n={5} /></>} /> };

export const Follow: StoryObj = { name: "A5 · follow a link field into each record: a second stage, nested rows",
  render: () => <Shell mode="pick" record="article.row" stage2 page={<><Pill>◀ stage ①</Pill><Pill>▣ stage ② the first record's detail page (a capture)</Pill><Lines n={5} /></>} /> };

export const Drive: StoryObj = { name: "A6 · drive: click / write / scroll on the live page, recorded as steps",
  render: () => <Shell mode="drive" record="article.row" bar page={<><Pill>click ▾</Pill><Pill>#load</Pill><Pill>Do it</Pill><Pill>add to plan ✓</Pill><Lines n={5} /></>} /> };

export const Run: StoryObj = { name: "A7-A8 · paginate and run: the server rows beside the local ones, the run replayed",
  render: () => <Shell mode="pick" record="article.row" bar page={<><Pill>follow rel=next · 3 pages</Pill><Pill>Run ▶</Pill><Pill>local 4 vs server 12 ✓</Pill><Lines n={5} /></>} /> };

export const Resume: StoryObj = { name: "A10 · resume: the plan rides in the URL; pages re-open as fresh captures",
  render: () => <Shell mode="look" stage2 page={<><Pill>/author?plan=&lt;blob&gt;&stage=2</Pill><Pill>each stage's page re-opened into the session · picks restored</Pill><Lines n={5} /></>} /> };

/** What was built (docs/product/author-workspace.md §8): no modes. A click opens the
 * ElementMenu -- the selector builder (toggles + live count in scope) over the object's ops
 * generated from GET /ops; the scope is the last object until Esc / a plan click. */
export const Menu: StoryObj = { name: "A13 · superseded by the graph builder (A14): the click menu = selector builder + the object's ops",
  render: () => (
    <Frame title="Author — click an element">
      <Col rows="auto auto minmax(0,1fr)" className="h-full">
        <Box label="address bar" tone="nav"><Pill>http://…/case-studies</Pill><Pill>auto ▾</Pill><Pill>Open</Pill><Pill>go live</Pill><Pill>Save</Pill><Pill>Export</Pill><Pill>Import</Pill><Pill>Run ▶</Pill></Box>
        <Box label="scope (one fixed line)" tone="muted" note="Esc / the chip / the plan root → the page; any plan node → that object"><Pill>scope: each article.row</Pill><Pill>a.name .text-[15px] “Price monitor…”</Pill><Pill>6 groups</Pill></Box>
        <Row cols="minmax(0,1.4fr) minmax(0,1fr)">
          <Box label="THE PAGE (Player) + the menu at the click" grow note="selector builder: ↳ main · ↳ div.flex · article.row · a.name (toggles) · [a.name] ×1 in each article.row · 4 on the page  |  ops from /ops: select_all ×1 · select · click · scroll · wait_for · ☑ record  |  read [name] text href count attr  |  open the link ▸ · pages: rel=next  |  ▸ more (32 ops)"><Lines n={8} /></Box>
          <Col rows="auto auto minmax(0,1fr)">
            <Box label="THE PLAN — live, editable" note="root (scope when nothing else) · open the page · pages · each article.row ×4 · fields: name → the a.name → read text · when → the time → read text · rows"><Lines n={5} /></Box>
            <Box label="THE PAGE — card · signals · pattern groups" note="html · 200 · static → browser · timing | pagination 98% | record list article.row ×4 · page template · 6 items a.rounded"><Lines n={2} /></Box>
            <Box label="Rows · Server run · Skeleton · Markdown · Elements · As code" grow><Lines n={4} /></Box>
          </Col>
        </Row>
      </Col>
    </Frame>
  ) };

/** What stands (docs/product/author-workspace.md §10): the builder is a GRAPH of the package's
 * objects; the view shows the selected node; the inspector adds nodes; outputs compile to the plan. */
export const Graph: StoryObj = { name: "A14 · built: the graph builder — objects as nodes, ops as edges, outputs projected",
  render: () => (
    <Frame title="Author — the graph builder">
      <Row cols="340px minmax(0,1fr) 400px">
        <Box label="THE GRAPH" grow note="REF url → DOC open auto (pages: next link ×2) → EACH select_all li.col-xs-6 ×20 → EL select h3 a → REF attr href → DOC open (the book) → EL select #product_description ~ p → VAL attr text → description · EACH select_all table tr → info → EL td → VAL text (name from th)"><Lines n={12} /></Box>
        <Box label="THE SELECTED NODE'S VIEW" grow note="REF: the URL + open it (static / auto / browser / live) · DOC / EL / EACH / VAL: its page (static or live) with the node's matches and the outputs outlined; click anything → the inspector"><Lines n={10} /></Box>
        <Col rows="auto minmax(0,1fr)">
          <Box label="ELEMENT INSPECTOR (on a click) / THE NODE" note="parents with class toggles (↑ re-target) · candidates per group (each li.col-xs-6 ×20 · ↑1 table tr ×7) · one (#product_description ~ p) · ops: select_all / select / click / scroll / wait for / type / open the link / pages · read off it: text, own text, count, label, href, src, data-*, aria-*, class — tick, name, or name from the page"><Lines n={6} /></Box>
          <Box label="Rows · Server run · Plan · Page · Skeleton · Markdown · Elements · As code" grow><Lines n={5} /></Box>
        </Col>
      </Row>
    </Frame>
  ) };


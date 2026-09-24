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
    <Frame title="Author — one page, one plan, three modes">
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

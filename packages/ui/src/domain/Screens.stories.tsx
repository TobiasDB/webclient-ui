import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Preview, fieldColour, type Highlight } from "./Preview";
import { SkeletonPane } from "./SkeletonPane";
import { ElementTable } from "./ElementTable";
import { RowsTable } from "./RowsTable";
import { AsCode, toolAsCode } from "./AsCode";
import { Timeline } from "./Timeline";
import { EventList } from "./EventList";
import { RunBar } from "./RunBar";
import { ErrorCard } from "./ErrorCard";
import { Panel } from "../primitives/Panel";
import { Button } from "../primitives/Button";
import { SHOP_HTML, SHOP_SKELETON, SHOP_CONTROLS, SHOP_FIELDS, SHOP_ROWS, TRACE_EVENTS } from "../fixtures/lab";
import type { ErrorEvent } from "../types";

const meta: Meta = { title: "Domain/Screens", parameters: { layout: "fullscreen" } };
export default meta;

export const PreviewWithHighlights: StoryObj = {
  name: "Preview · highlights + pick",
  render: function Story() {
    const [picked, setPicked] = React.useState<string>("");
    const [hover, setHover] = React.useState<string | null>(null);
    const highlights: Highlight[] = [
      { selector: "div.card", label: "record", tone: "accent" },
      { selector: "div.card h2.title", label: "title", tone: "field" },
      { selector: "div.card span.price", label: "price", tone: "field" },
    ];
    return (
      <div className="grid h-[560px] grid-cols-[1.2fr_1fr] gap-3 p-3">
        <Panel title="Preview — click to pick, hover to link" flush><Preview html={SHOP_HTML} highlights={highlights} onPick={(p) => setPicked(`${p.tag} · ${p.path} · "${p.text}"`)} onHover={setHover} className="h-full rounded-none border-0" /></Panel>
        <Panel title="Skeleton (hover-linked)">
          <div className="mb-2 text-[12px] text-muted">picked: {picked || "—"} · hover: {hover ?? "—"}</div>
          <SkeletonPane skeleton={SHOP_SKELETON} active={hover ? "<" + hover.split(" > ").pop()?.split(":")[0] : null} />
        </Panel>
      </div>
    );
  },
};

export const TablesAndCode: StoryObj = {
  name: "Element table · rows · as code",
  render: function Story() {
    const [sel, setSel] = React.useState<number | null>(3);
    return (
      <div className="grid h-[520px] grid-cols-3 gap-3 p-3">
        <Panel title="Controls (what the model sees)" flush><ElementTable elements={SHOP_CONTROLS} selected={sel} onSelect={(e) => setSel(e.index)} /></Panel>
        <Panel title="Rows (live)" flush><RowsTable rows={SHOP_ROWS} columns={["title", "price", "link"]} colours={[fieldColour(0), fieldColour(1), fieldColour(2)]} /></Panel>
        <Panel title="As code" flush><AsCode {...toolAsCode("extract", { url: "http://lab/lab/shop", result: "div.card", fields: { title: ".title", price: ".price" } })} blob='{"root":"Reference","steps":[…]}' className="h-full" /></Panel>
        <Panel title="Fields inside one record" flush><ElementTable elements={SHOP_FIELDS} /></Panel>
        <Panel title="0 rows (a designed state)" flush><RowsTable rows={[]} emptyHint={<>The selector <code className="font-mono">.nope</code> matched nothing — the ledger says <b>fix_selector</b>. The nearest record list is <code className="font-mono">div.card</code>.</>} emptyAction={<Button variant="primary" size="sm">Use div.card</Button>} /></Panel>
      </div>
    );
  },
};

export const TraceTimeline: StoryObj = {
  name: "Timeline + event list + ledger (one scrubber)",
  render: function Story() {
    const [cursor, setCursor] = React.useState(2);
    const errors = TRACE_EVENTS.filter((e) => e.topic === "error") as ErrorEvent[];
    return (
      <div className="grid h-[640px] grid-rows-[auto_1fr] gap-3 p-3">
        <Timeline events={TRACE_EVENTS} cursor={cursor} onCursor={setCursor} height={140} />
        <div className="grid min-h-0 grid-cols-2 gap-3">
          <Panel title="Events (grouped by document)" flush><EventList events={TRACE_EVENTS} cursor={cursor} onCursor={setCursor} groupByDocument className="h-full" /></Panel>
          <Panel title="At the scrubber / ledger">
            <pre className="mb-3 max-h-48 overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(TRACE_EVENTS[cursor], null, 2)}</pre>
            {errors.map((e, i) => <ErrorCard key={i} error={e.error} raised={e.raised} onJump={() => setCursor(TRACE_EVENTS.indexOf(e))} />)}
          </Panel>
        </div>
      </div>
    );
  },
};

export const RunBarLive: StoryObj = {
  name: "Run bar (live stream)",
  render: function Story() {
    const [events, setEvents] = React.useState(TRACE_EVENTS.slice(0, 4));
    const [paused, setPaused] = React.useState(false);
    React.useEffect(() => {
      const id = setInterval(() => { if (!paused) setEvents((ev) => ev.length < TRACE_EVENTS.length ? [...ev, TRACE_EVENTS[ev.length]!] : ev); }, 700);
      return () => clearInterval(id);
    }, [paused]);
    return <div className="flex h-[360px] flex-col justify-end"><RunBar events={events} connected paused={paused} onPause={setPaused} tracing={false} onTrace={() => {}} /></div>;
  },
};

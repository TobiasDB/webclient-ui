import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import fixture from "../../lib/run/fixtures/paged-run.json";
import type { Plan } from "../../lib/plan";
import type { RunEvent } from "../../lib/stages";
import { planModel } from "../../lib/run/plan";
import { stateAt, followItem } from "../../lib/run/state";
import { RunGraph } from "./RunGraph";
import { RunTimeline } from "./RunTimeline";
import { ItemStrip } from "./ItemStrip";

const meta: Meta = { title: "Run/A plan, played" };
export default meta;

// a real run (the package, recorded): 2 pages x 3 records, each record's detail page with a 2-row table
const plan = fixture.plan as unknown as Plan;
const events = fixture.events as unknown as RunEvent[];
const model = planModel(plan);

function At({ frac }: { frac: number }) {
  const [t, setT] = React.useState(Math.round(events.length * frac));
  const state = React.useMemo(() => stateAt(events, model, t), [t]);
  const full = React.useMemo(() => stateAt(events, model), []);
  const [item, setItem] = React.useState<string | null>(null);
  return (
    <div className="flex h-[720px] flex-col gap-1 p-1 text-[11px]">
      <div className="min-h-0 flex-1 rounded border border-line"><RunGraph model={model} state={state} item={item ?? followItem(state, model)} onPick={setItem} rootUrl="http://lab/" /></div>
      <div className="rounded border border-line"><RunTimeline events={events} model={model} full={full} at={t} onSeek={setT} /></div>
    </div>
  );
}

/** the plan, before it runs: what each step will make, and which run once per item */
export const ThePlan: StoryObj = { render: () => <At frac={0} /> };
/** mid-run: fan-outs filling, columns reading the item on screen's values, a detail page per record */
export const Running: StoryObj = { render: () => <At frac={0.45} /> };
/** done: every item, every page, the table */
export const Done: StoryObj = { render: () => <At frac={1} /> };

export const Items: StoryObj = {
  render: () => {
    const s = stateAt(events, model);
    const nr = s.nodes.get("6/kw:info/8/kw:v/0");
    return <div className="flex w-72 flex-col gap-2 p-2"><ItemStrip insts={nr?.insts} selected="4.1" /><ItemStrip insts={s.nodes.get("6/kw:n/2")?.insts} expected={6} selected="3" /><ItemStrip insts={new Map()} expected={2400} /></div>;
  },
};

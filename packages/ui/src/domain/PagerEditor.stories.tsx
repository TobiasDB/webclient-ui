import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PagerEditor } from "./PagerEditor";
import type { Pager, PaginationHint } from "../lib/pager";

const meta: Meta = { title: "Domain/Pager editor" };
export default meta;

/** what `doc.pagination()` hinted on a listing: each way it could be paged, with its evidence */
const HINTS: PaginationHint = {
  total_items: 348, page_size: 20,
  modes: [
    { mode: "next", code: ".paginate(next=wq.doc.next_link())", evidence: "a rel=next link", confidence: 0.9, selector: 'a[rel="next"]' },
    { mode: "pages", code: '.paginate(pages="page", start=1, step=1, stop=18)', evidence: "links carry ?page= (this page 1, the next 2)", confidence: 0.75, param: "page", start: 1, step: 1, stop: 18 },
    { mode: "click", code: '.paginate(click="button.more")', evidence: "a load-more control (needs the page in a browser)", confidence: 0.55, selector: "button.more", browser: true },
  ],
};

function Live({ start, hints }: { start: Pager | null; hints?: PaginationHint }) {
  const [p, setP] = React.useState<Pager | null>(start);
  return <div className="w-[520px] rounded border border-line bg-surface p-2"><PagerEditor value={p} hints={hints} onChange={setP} /></div>;
}

export const FromHints: StoryObj = { name: "a page's hints, nothing chosen yet", render: () => <Live start={null} hints={HINTS} /> };
export const NewestOnly: StoryObj = {
  name: "follow the next link until the dates pass a cutoff",
  render: () => <Live hints={HINTS} start={{ mode: "next", next: "", max_pages: 20, until: { selector: "article:last-child time", attr: "datetime", cmp: "lt", value: "2026-09-01" } }} />,
};
export const Offsets: StoryObj = { name: "an offset walked by its page size", render: () => <Live start={{ mode: "pages", param: "offset", start: 0, step: 20, stop: 340, max_pages: 20 }} /> };
export const ReadOnly: StoryObj = { render: () => <PagerEditor readOnly value={{ mode: "click", click: "button.more", records: "li.item", max_pages: 10 }} /> };

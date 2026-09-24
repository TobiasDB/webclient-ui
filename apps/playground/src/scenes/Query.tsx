import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AsCode, Button, Chip, CodeBlock, ElementTable, EmptyState, Input, Panel, Preview, RowsTable, Select, TabPanel, Tabs,
  Toolbar, ToolbarGroup, ToolbarSpacer, fieldColour, toolAsCode, type Highlight, type IndexedElement,
} from "@webclient/ui";
import { api, ApiError } from "../lib/api";

type Column = { name: string; selector: string; source: "text" | "href" | "attr"; attr?: string };

/** A column name from the selector, not the sample text: `h2.title` -> title, `a.link` -> link,
 * `span[data-price]` -> price, `td:nth-child(2)` -> td_2; the role is the last resort. */
function columnName(selector: string, role: string): string {
  const leaf = selector.split(/\s*[> ]\s*/).filter(Boolean).pop() ?? selector;
  const cls = /\.([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const attr = /\[(?:data-)?([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const id = /#([a-zA-Z0-9_-]+)/.exec(leaf)?.[1];
  const nth = /^([a-z0-9]+):nth-child\((\d+)\)/.exec(leaf);
  const raw = cls ?? id ?? attr ?? (nth ? `${nth[1]}_${nth[2]}` : /^[a-z0-9]+/.exec(leaf)?.[0] ?? role);
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
}

/** The query builder (stories 2.1-2.3): pick the record (a hint, the element table, or a
 * click in the preview), pick fields inside ONE record, rows fill live; the plan is data. */
export function Query() {
  const [params, setParams] = useSearchParams();
  const url = params.get("url") ?? "";
  const [draft, setDraft] = React.useState(url);
  const [record, setRecord] = React.useState<string>(params.get("record") ?? "");
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [paginate, setPaginate] = React.useState(params.get("paginate") ?? "none");
  const [maxPages, setMaxPages] = React.useState(5);
  const [tab, setTab] = React.useState("rows");

  const snap = useQuery({ queryKey: ["snapshot", url, "false"], queryFn: () => api.snapshot(url, false), enabled: !!url });
  const records = useQuery({ queryKey: ["elements", url, "records"], queryFn: () => api.elements(url, "records"), enabled: !!url && snap.isSuccess });
  const fields = useQuery({ queryKey: ["fields", url, record], queryFn: () => api.fields(url, record), enabled: !!url && !!record });
  React.useEffect(() => { if (!record && records.data?.[0]) setRecord(records.data[0].selector); }, [records.data, record]);

  const fieldMap = Object.fromEntries(columns.filter((c) => c.source === "text").map((c) => [c.name, c.selector]));
  const rows = useQuery({
    queryKey: ["extract", url, record, JSON.stringify(columns), paginate, maxPages],
    queryFn: async () => {
      if (paginate === "none" || paginate === "") return api.extract(url, record, fieldMap, 200);
      // pagination runs as a plan: reference(url).resolve().paginate(by=..).select_all(record).extract(...).project()
      const plan = {
        root: "Reference", steps: [
          { kind: "get", name: "resolve" }, { kind: "call", name: "resolve", args: [], kwargs: {} },
          { kind: "get", name: "paginate" }, { kind: "call", name: "paginate", args: [], kwargs: { by: { value: paginate }, max_pages: { value: maxPages } } },
          { kind: "get", name: "select_all" }, { kind: "call", name: "select_all", args: [{ value: record }], kwargs: {} },
          { kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: Object.fromEntries(columns.map((c) => [c.name, { plan: { root: "Document", steps: [
            { kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: c.selector }], kwargs: {} },
            { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: c.source === "text" ? "text" : c.source === "href" ? "href" : c.attr }], kwargs: {} },
          ] } }])) },
          { kind: "get", name: "project" }, { kind: "call", name: "project", args: [], kwargs: {} },
        ],
      };
      const out = await api.execute({ plan, url });
      return (Array.isArray(out.rows) ? out.rows : []) as Record<string, unknown>[];
    },
    enabled: !!url && !!record && columns.length > 0,
  });

  // the plan (for the blob / wireframe / explain), built from the same pieces
  const planBody = React.useMemo(() => {
    if (!record) return null;
    const extractKw = Object.fromEntries(columns.map((c) => [c.name, { plan: { root: "Document", steps: [
      { kind: "get", name: "select" }, { kind: "call", name: "select", args: [{ value: c.selector }], kwargs: {} },
      { kind: "get", name: "attr" }, { kind: "call", name: "attr", args: [{ value: c.source === "text" ? "text" : c.source === "href" ? "href" : c.attr }], kwargs: {} },
    ] } }]));
    return { root: "Reference", steps: [
      { kind: "get", name: "resolve" }, { kind: "call", name: "resolve", args: [], kwargs: {} },
      ...(paginate !== "none" ? [{ kind: "get", name: "paginate" }, { kind: "call", name: "paginate", args: [], kwargs: { by: { value: paginate }, max_pages: { value: maxPages } } }] : []),
      { kind: "get", name: "select_all" }, { kind: "call", name: "select_all", args: [{ value: record }], kwargs: {} },
      ...(columns.length ? [{ kind: "get", name: "extract" }, { kind: "call", name: "extract", args: [], kwargs: extractKw }] : []),
      { kind: "get", name: "project" }, { kind: "call", name: "project", args: [], kwargs: {} },
    ] };
  }, [record, columns, paginate, maxPages]);
  const plan = useQuery({ queryKey: ["plan", JSON.stringify(planBody)], queryFn: () => api.plan({ plan: planBody, wireframe: true }), enabled: !!planBody });

  const addField = (f: IndexedElement) => {
    if (columns.some((c) => c.selector === f.selector)) return;
    const base = columnName(f.selector, f.role) || `field_${columns.length + 1}`;
    const name = columns.some((c) => c.name === base) ? `${base}_${columns.length + 1}` : base;
    setColumns((cs) => [...cs, { name, selector: f.selector, source: f.role === "link" ? "href" : "text" }]);
  };
  const highlights: Highlight[] = [
    ...(record ? [{ selector: record, label: "record", tone: "accent" as const }] : []),
    ...columns.map((c) => ({ selector: `${record} ${c.selector}`, label: c.name, tone: "field" as const })),
  ];
  const err = rows.error as ApiError | null;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); setColumns([]); setRecord(""); setParams({ url: draft }); }}>
          <ToolbarGroup className="flex-1"><Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="the page with the records" className="w-full" /></ToolbarGroup>
          <Button type="submit" size="sm">Load</Button>
        </form>
        <ToolbarGroup>
          <span className="text-[12px] text-muted">pagination</span>
          <Select value={paginate} onChange={(e) => setPaginate(e.target.value)}><option value="none">none</option><option value="link">rel=next</option><option value="param">?page=</option></Select>
          {paginate !== "none" && <Input type="number" min={1} max={50} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="w-16" />}
        </ToolbarGroup>
        <ToolbarSpacer />
        {rows.data && <Chip tone="ok">{rows.data.length} rows</Chip>}
      </Toolbar>
      {!url ? <EmptyState title="Load a page to build a query" hint="Pick the repeating record, then the fields inside one of them. Rows fill as you go." /> :
      <div className="grid min-h-0 flex-1 grid-cols-[1.2fr_1fr] gap-3 p-3">
        <Panel title="Pick by pointing" flush actions={<span className="text-[11px] text-muted">{record ? `record: ${record}` : "1) pick a record"}</span>}>
          {snap.data ? <Preview html={snap.data.content} highlights={highlights} baseUrl={snap.data.card.final_url} className="h-full rounded-none border-0"
            onPick={(p) => { if (!record) setRecord(p.path); else addField({ index: 0, role: p.tag === "a" ? "link" : "text", name: p.text, kind: "content", selector: p.path.split(" > ").slice(-1)[0] ?? p.path, repeats: 1 }); }} /> : <EmptyState title="Fetching…" />}
        </Panel>
        <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-3">
          <Panel title="Records (repeating regions)" flush>
            {records.data?.length ? <ElementTable elements={records.data} selected={records.data.find((r) => r.selector === record)?.index ?? null} onSelect={(r) => { setRecord(r.selector); setColumns([]); }} /> : <div className="p-3 text-[12px] text-muted">No repeating region detected — click one in the preview.</div>}
          </Panel>
          <Panel title="Fields inside one record — click to add a column" flush>
            {fields.data ? <ElementTable elements={fields.data} onSelect={addField} emptyHint="No text leaves inside the record." /> : <div className="p-3 text-[12px] text-muted">pick a record first</div>}
          </Panel>
          <Panel flush className="min-h-0">
            <Tabs items={[{ value: "rows", label: "Rows", count: rows.data?.length }, { value: "columns", label: "Columns", count: columns.length }, { value: "plan", label: "Plan" }, { value: "code", label: "As code" }]} value={tab} onValueChange={setTab} className="h-full">
              <TabPanel value="rows">
                {!columns.length ? <EmptyState title="Add a column" hint="Click a field in the record (or in the preview)." /> :
                 err ? <RowsTable rows={[]} emptyHint={<>{err.hint ?? err.message}{err.remedy && <> — remedy: <b>{err.remedy}</b></>}</>} /> :
                 <RowsTable rows={rows.data ?? []} columns={columns.map((c) => c.name)} colours={columns.map((_, i) => fieldColour(i))} emptyHint="The record selector matched nothing. Pick another record, or check the page needs a browser (Explore → tier)." />}
              </TabPanel>
              <TabPanel value="columns" className="p-2">
                <ul className="flex flex-col gap-1 text-[12px]">
                  {columns.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2 rounded border border-line p-1.5">
                      <span className="inline-block size-2.5 rounded-sm" style={{ background: fieldColour(i) }} />
                      <Input value={c.name} onChange={(e) => setColumns((cs) => cs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="h-7 w-32" />
                      <code className="flex-1 truncate font-mono text-muted">{c.selector}</code>
                      <Select value={c.source} onChange={(e) => setColumns((cs) => cs.map((x, j) => j === i ? { ...x, source: e.target.value as Column["source"] } : x))} className="h-7"><option value="text">text</option><option value="href">href</option><option value="attr">attribute…</option></Select>
                      {c.source === "attr" && <Input value={c.attr ?? ""} placeholder="data-price" onChange={(e) => setColumns((cs) => cs.map((x, j) => j === i ? { ...x, attr: e.target.value } : x))} className="h-7 w-28" mono />}
                      <Button size="sm" variant="ghost" onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}>✕</Button>
                    </li>
                  ))}
                  {!columns.length && <li className="text-muted">No columns yet.</li>}
                </ul>
              </TabPanel>
              <TabPanel value="plan" className="p-2">
                {plan.data ? <div className="flex flex-col gap-2"><CodeBlock lang="explain" code={plan.data.explain ?? plan.data.describe} /><iframe title="wireframe" sandbox="" srcDoc={plan.data.wireframe ?? ""} className="h-72 w-full rounded-md border border-line bg-white" /></div> : <span className="text-muted">pick a record to see the plan</span>}
              </TabPanel>
              <TabPanel value="code">
                <AsCode {...toolAsCode("extract", { url, result: record, fields: fieldMap })} blob={plan.data?.blob} python={`from webclient import WebClient, from_blob\n\nwith WebClient() as wc:\n    rows = from_blob(${JSON.stringify(plan.data?.blob ?? "<blob>")}, wc).collect()`} />
              </TabPanel>
            </Tabs>
          </Panel>
        </div>
      </div>}
    </div>
  );
}

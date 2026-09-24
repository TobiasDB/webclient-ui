import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AsCode, Button, Chip, CodeBlock, EmptyState, Input, Panel, RowsTable, Select, toolAsCode, type JsonSchema, type ToolSpec } from "@webclient/ui";
import { api, ApiError } from "../lib/api";

/** Tools (story 8.1): every registered tool as a form built from its schema; the result
 * rendered by type; the same call as Python / HTTP / MCP. */
export function Tools() {
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.tools });
  const [name, setName] = React.useState<string>("");
  const [args, setArgs] = React.useState<Record<string, unknown>>({});
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tool = tools.data?.find((t) => t.name === name) ?? tools.data?.[0];
  React.useEffect(() => { if (tool) { setName(tool.name); setArgs(defaults(tool)); setResult(undefined); setError(null); } }, [tool?.name]);
  const run = async () => {
    if (!tool) return;
    setBusy(true); setError(null);
    try { setResult(await api.tool(tool.name, clean(args))); } catch (e) { setError(e as ApiError); setResult(undefined); } finally { setBusy(false); }
  };
  return (
    <div className="grid h-full grid-cols-[260px_1fr_1fr] gap-3 p-3">
      <Panel title="Tools" flush>
        {tools.data ? <ul>{tools.data.map((t) => <li key={t.name} onClick={() => setName(t.name)} className={`cursor-pointer border-b border-line px-3 py-2 text-[12px] hover:bg-surface-2 ${t.name === tool?.name ? "bg-accent-soft" : ""}`}><b className="font-mono">{t.name}</b> <Chip>{t.story}</Chip><div className="text-muted">{t.description.slice(0, 80)}{t.description.length > 80 ? "…" : ""}</div></li>)}</ul> : <EmptyState title="No API" />}
      </Panel>
      <Panel title={tool ? `${tool.name} — ${tool.returns ?? ""}` : "Tool"}>
        {tool && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <p className="text-[12px] text-muted">{tool.description}</p>
            {Object.entries(tool.input_schema.properties ?? {}).map(([k, s]) => <Field key={k} name={k} schema={s} required={tool.input_schema.required?.includes(k)} value={args[k]} onChange={(v) => setArgs((a) => ({ ...a, [k]: v }))} />)}
            <div><Button variant="primary" type="submit" disabled={busy}>{busy ? "Running…" : "Run"}</Button></div>
          </form>
        )}
      </Panel>
      <Panel title="Result" flush>
        {error ? <div className="p-3 text-[12px]"><Chip tone="bad">{error.code ?? error.status}</Chip> <span>{error.hint ?? error.message}</span>{error.remedy && <div className="mt-1">remedy: <b>{error.remedy}</b></div>}</div> :
         result === undefined ? <div className="p-3"><AsCode {...toolAsCode(tool?.name ?? "", clean(args))} /></div> : <Result value={result} />}
      </Panel>
    </div>
  );
}

function defaults(t: ToolSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(t.input_schema.properties ?? {}).filter(([, s]) => s.default !== undefined && s.default !== null).map(([k, s]) => [k, s.default]));
}
function clean(a: Record<string, unknown>) { return Object.fromEntries(Object.entries(a).filter(([, v]) => v !== "" && v !== undefined && v !== null)); }

function Field({ name, schema, required, value, onChange }: { name: string; schema: JsonSchema; required?: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const type = schema.type ?? schema.anyOf?.find((s) => s.type && s.type !== "null")?.type ?? "string";
  const label = <label className="flex items-baseline gap-2 text-[12px]"><span className="w-28 shrink-0 font-mono text-ink">{name}{required && <span className="text-bad">*</span>}</span><span className="text-muted">{schema.description}</span></label>;
  if (type === "boolean") return <div>{label}<input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /></div>;
  if (type === "integer" || type === "number") return <div>{label}<Input type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="w-40" /></div>;
  if (schema.enum) return <div>{label}<Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{schema.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</Select></div>;
  if (type === "object" || type === "array") return <div>{label}<Input mono value={typeof value === "string" ? value : value ? JSON.stringify(value) : ""} placeholder='JSON, e.g. {"title": ".title"}' onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); } }} /></div>;
  return <div>{label}<Input mono value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Result({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.length && typeof value[0] === "object" && value[0] && !Array.isArray(value[0])) return <RowsTable rows={value as Record<string, unknown>[]} />;
  if (typeof value === "string") return <div className="p-3"><CodeBlock code={value} wrap /></div>;
  return <div className="p-3"><CodeBlock lang="json" code={JSON.stringify(value, null, 2)} /></div>;
}

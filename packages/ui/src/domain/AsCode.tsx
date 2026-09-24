import * as React from "react";
import { Tabs, TabPanel } from "../primitives/Tabs";
import { CodeBlock } from "../primitives/CodeBlock";

export type AsCodeProps = { python?: string; http?: string; mcp?: string; blob?: string; className?: string };

/** "As code" -- every screen is a code generator (story 8.2, UX principle 5): the Python,
 * the HTTP call, the MCP tool call and the plan blob that reproduce what the screen did. */
export function AsCode({ python, http, mcp, blob, className }: AsCodeProps) {
  const items = [
    python != null && { value: "python", label: "Python" },
    http != null && { value: "http", label: "HTTP" },
    mcp != null && { value: "mcp", label: "MCP" },
    blob != null && { value: "blob", label: "Plan blob" },
  ].filter(Boolean) as { value: string; label: string }[];
  const [tab, setTab] = React.useState(items[0]?.value ?? "python");
  if (!items.length) return null;
  return (
    <Tabs items={items} value={tab} onValueChange={setTab} className={className}>
      {python != null && <TabPanel value="python" className="p-2"><CodeBlock lang="python" code={python} /></TabPanel>}
      {http != null && <TabPanel value="http" className="p-2"><CodeBlock lang="http" code={http} wrap /></TabPanel>}
      {mcp != null && <TabPanel value="mcp" className="p-2"><CodeBlock lang="json" code={mcp} wrap /></TabPanel>}
      {blob != null && <TabPanel value="blob" className="p-2"><CodeBlock lang="blob" code={blob} wrap /></TabPanel>}
    </Tabs>
  );
}

/** Build the three reproductions of one tool call. */
export function toolAsCode(name: string, args: Record<string, unknown>, apiUrl = "http://localhost:8000"): AsCodeProps {
  const kw = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
  return {
    python: `from webclient.tools import dispatch\n\nresult = dispatch("${name}", ${JSON.stringify(args)})\n# or the verb:  from webclient.llm.tools import ${name}  (${kw})`,
    http: `POST ${apiUrl}/tools/${name}\ncontent-type: application/json\n\n${JSON.stringify(args, null, 2)}`,
    mcp: JSON.stringify({ name, arguments: args }, null, 2),
  };
}

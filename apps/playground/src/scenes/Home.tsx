import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Panel, EmptyState, KeyValue } from "@webclient/ui";
import { api } from "../lib/api";

export function Home() {
  const nav = useNavigate();
  const [url, setUrl] = React.useState("");
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.traces });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  return (
    <div className="grid h-full grid-cols-3 gap-3 p-3">
      <Panel title="Start with a URL">
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (url) nav(`/author?url=${encodeURIComponent(url)}`); }}>
          <Input mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (or a lab page, e.g. http://localhost:8765/lab/shop)" autoFocus />
          <div className="flex gap-2"><Button variant="primary" type="submit">Author a scrape</Button><Button onClick={() => nav("/loops")}>Crawl a site</Button><Button onClick={() => nav("/tools")}>Try a tool</Button></div>
          <p className="text-[12px] text-muted">You'll see what the page is, what's notable (with evidence), where the data is — then build an extraction by pointing.</p>
        </form>
      </Panel>
      <Panel title="Recent traces" flush>
        {traces.data?.length ? (
          <ul>{traces.data.map((t) => <li key={t.id} className="cursor-pointer border-b border-line px-3 py-2 text-[13px] hover:bg-surface-2" onClick={() => nav(`/traces/${t.id}`)}><b>{t.id}</b> <span className="text-muted">· {t.events} events</span></li>)}</ul>
        ) : <EmptyState title="No traces yet" hint="Record one with `with wc.trace('traces/<name>')` in the API's working directory, or run demo.py." />}
      </Panel>
      <Panel title="The API">
        {health.data ? <KeyValue rows={[["status", "ok"], ["mode", String((health.data.resources as { mode?: string }).mode)], ["events", String((health.data.resources as { events?: number }).events)], ["rss", `${String((health.data.resources as { rss_mb?: number }).rss_mb)} MB`]]} /> : <EmptyState title="No API" hint="Start it with `make serve` in the webclient repository (port 8000)." />}
      </Panel>
    </div>
  );
}

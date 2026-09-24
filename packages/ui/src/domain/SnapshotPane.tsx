import * as React from "react";
import { KeyValue } from "../primitives/KeyValue";
import { Chip } from "../primitives/Chip";
import type { SnapshotEvent } from "../types";

/** The document as captured at a moment of the trace: its meta + the raw page (a sandboxed
 * frame, scripts off). The Player is the live view; this is the "what exactly was captured"
 * view (story 7.1). */
export function SnapshotPane({ snapshot, html, className }: { snapshot: SnapshotEvent; html: string | null; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
        <Chip tone="ok">{snapshot.phase}</Chip><Chip>{snapshot.kind}</Chip><Chip tone={snapshot.status_code >= 400 ? "bad" : "neutral"}>{snapshot.status_code}</Chip>
        {(snapshot.tiers ?? []).map((t) => <Chip key={t} tone="accent">{t}</Chip>)}
        <span className="truncate text-muted" title={snapshot.final_url || snapshot.url}>{snapshot.final_url || snapshot.url}</span>
      </div>
      {html == null ? <KeyValue rows={[["content", "not loaded"]]} /> : snapshot.kind === "html"
        ? <iframe title="snapshot" sandbox="" srcDoc={html} className="h-[420px] w-full rounded-md border border-line bg-white" />
        : <pre className="max-h-[420px] overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11px]">{html}</pre>}
    </div>
  );
}

import * as React from "react";
import { Chip, FlagRow, TierLadder, type Flag, type PageCard } from "@webclient/ui";
import { api, siteOrigin } from "../lib/api";

/** Home story A3: the tier chosen for three of this site's pages -- static, auto-escalated,
 * an API -- with the flags that decided it. "Cheapest tier that works", demonstrated. */
export function TransportProof({ pages }: { pages: { path: string; label: string; expect: string }[] }) {
  const [cards, setCards] = React.useState<Record<string, { card?: PageCard; flags?: Flag[]; error?: string }>>({});
  React.useEffect(() => {
    for (const p of pages) {
      (async () => {
        try {
          const card = await api.tool<PageCard>("card", { url: siteOrigin() + p.path, browser: "auto" });
          const flags = await api.tool<Flag[]>("flags", { url: siteOrigin() + p.path });
          setCards((c) => ({ ...c, [p.path]: { card, flags } }));
        } catch (e) { setCards((c) => ({ ...c, [p.path]: { error: String((e as Error).message) } })); }
      })();
    }
  }, [pages]);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {pages.map((p) => { const s = cards[p.path]; return (
        <div key={p.path} className="rounded-lg border border-line p-3">
          <div className="mb-1 flex items-center gap-2 text-[13px]"><b>{p.label}</b><code className="font-mono text-[11px] text-muted">{p.path}</code></div>
          <div className="mb-2 text-[12px] text-muted">{p.expect}</div>
          {s?.card ? <><TierLadder escalation={(s.card.escalation?.length ? s.card.escalation : [s.card.final_tier]) as ("static" | "proxy" | "browser")[]} /><div className="mt-2"><FlagRow flags={s.flags ?? []} /></div></>
           : s?.error ? <Chip tone="bad">{s.error}</Chip> : <span className="text-[12px] text-muted">asking the service…</span>}
        </div>); })}
    </div>
  );
}

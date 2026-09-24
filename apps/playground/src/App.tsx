import * as React from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Chip, RunBar, cn, type Event } from "@webclient/ui";
import { subscribe } from "./lib/api";
import { Home } from "./scenes/Home";
import { Explore } from "./scenes/Explore";
import { Query } from "./scenes/Query";
import { Traces } from "./scenes/Traces";
import { Tools } from "./scenes/Tools";
import { Settings } from "./scenes/Settings";
import { Loops } from "./scenes/Loops";

const WORKSPACES = [
  ["/", "Home"], ["/explore", "Explore"], ["/query", "Query"], ["/loops", "Crawl · Loops"], ["/traces", "Traces"], ["/tools", "Tools"], ["/settings", "Settings"],
] as const;

/** The live stream shared by every workspace (the run bar) -- one socket, resumed by cursor. */
export function useLiveEvents(max = 2000) {
  const [events, setEvents] = React.useState<Event[]>([]);
  const [connected, setConnected] = React.useState(false);
  const cursor = React.useRef(0);
  React.useEffect(() => {
    let stop = () => {};
    let timer: number | undefined;
    const connect = () => {
      stop = subscribe((e) => { if (e.n) cursor.current = Math.max(cursor.current, e.n); setEvents((ev) => ev.length >= max ? [...ev.slice(-Math.floor(max * 0.8)), e] : [...ev, e]); },
        { since: cursor.current, onOpen: () => setConnected(true), onClose: () => { setConnected(false); timer = window.setTimeout(connect, 2000); } });
    };
    connect();
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [max]);
  return { events, connected };
}

export function App() {
  const { events, connected } = useLiveEvents();
  const [paused, setPaused] = React.useState(false);
  const [frozen, setFrozen] = React.useState<Event[] | null>(null);
  const nav = useNavigate();
  const shown = paused && frozen ? frozen : events;
  const waiting = events.filter((e) => e.topic === "loop" && (e as { phase?: string }).phase === "waiting").length;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-3">
        <span className="text-[14px] font-semibold tracking-tight">WebClient <span className="font-normal text-muted">Playground</span></span>
        <nav className="flex items-center gap-1">
          {WORKSPACES.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cn("rounded-md px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2", isActive && "bg-surface-3 text-ink")}>
              {label}{to === "/loops" && waiting > 0 && <span className="ml-1 rounded-full bg-warn px-1.5 text-[10px] text-white">{waiting}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <Chip tone="neutral" title="the model used by Onboard / the index author; configure a key in Settings">model: stub</Chip>
        <Chip tone={connected ? "ok" : "bad"} dot>{connected ? "connected" : "no API"}</Chip>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/query" element={<Query />} />
          <Route path="/loops" element={<Loops liveEvents={events} />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="/traces/:id" element={<Traces />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <RunBar events={shown} connected={connected} paused={paused} onPause={(p) => { setPaused(p); setFrozen(p ? events : null); }} onOpen={() => nav("/traces")} />
    </div>
  );
}

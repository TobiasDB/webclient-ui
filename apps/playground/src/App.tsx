import * as React from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Chip, RunBar, cn, type Event } from "@webclient/ui";
import { subscribe } from "./lib/api";
import { Home } from "./scenes/Home";
import { Author } from "./scenes/Author";
import { Traces } from "./scenes/Traces";
import { Tools } from "./scenes/Tools";
import { Settings } from "./scenes/Settings";
import { Loops } from "./scenes/Loops";
import { DocumentStrip } from "./components/DocumentStrip";

const WORKSPACES = [
  ["/", "Home"], ["/author", "Author"], ["/loops", "Crawl · Loops"], ["/traces", "Traces"], ["/tools", "Tools"], ["/settings", "Settings"],
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
  const [showEvents, setShowEventsRaw] = React.useState<boolean>(() => { try { return localStorage.getItem("wc.events") === "1"; } catch { return false; } });
  const setShowEvents = (v: boolean) => { setShowEventsRaw(v); try { localStorage.setItem("wc.events", v ? "1" : "0"); } catch { /* fine */ } };
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
        <Chip tone={showEvents ? "accent" : "neutral"} interactive onClick={() => setShowEvents(!showEvents)} title="the live event feed (debugging); off by default">events</Chip>
        <Chip tone={connected ? "ok" : "bad"} dot>{connected ? "connected" : "no API"}</Chip>
      </header>
      <DocumentStrip />
      <main className="min-h-0 flex-1 overflow-hidden"><Boundary>
        {/* every workspace stays MOUNTED (hidden when not active): switching tabs, or going
            back and forward, never loses what you were doing; the URL carries the essentials */}
        <Keep path="/" exact><Home /></Keep>
        <Keep path="/author"><Author /></Keep>
        {/* the three former workspaces live on as redirects into Author */}
        <Routes>
          <Route path="/explore" element={<Redirect />} /><Route path="/query" element={<Redirect />} /><Route path="/interact" element={<Redirect />} />
          <Route path="*" element={null} />
        </Routes>
        <Keep path="/loops"><Loops liveEvents={events} /></Keep>
        <Keep path="/traces"><Routes><Route path="/traces" element={<Traces />} /><Route path="/traces/:id" element={<Traces />} /></Routes></Keep>
        <Keep path="/tools"><Tools /></Keep>
        <Keep path="/settings"><Settings /></Keep>
      </Boundary></main>
      {showEvents && <RunBar events={shown} connected={connected} paused={paused} onPause={(p) => { setPaused(p); setFrozen(p ? events : null); }} onOpen={() => nav("/traces")} />}
    </div>
  );
}

/** A render error in a workspace shows what broke -- never a white screen. */
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-3 rounded-lg border border-bad/40 bg-bad-soft p-3 text-[13px]">
        <div className="font-semibold text-bad">The workspace hit an error</div>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button type="button" className="mt-2 rounded border border-line bg-surface px-2 py-1" onClick={() => { this.setState({ error: null }); window.location.href = window.location.pathname; }}>reset this workspace</button>
      </div>
    );
  }
}

/** A workspace that mounts once and stays: shown when the location matches, hidden otherwise. */
function Keep({ path, exact, children }: { path: string; exact?: boolean; children: React.ReactNode }) {
  const loc = useLocation();
  const active = exact ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(path + "/");
  const [mounted, setMounted] = React.useState(active);
  React.useEffect(() => { if (active) setMounted(true); }, [active]);
  if (!mounted) return null;
  return <div className={cn("h-full min-h-0", !active && "hidden")}>{children}</div>;
}

/** /explore, /query and /interact used to be separate workspaces: keep their links working. */
function Redirect() {
  const loc = useLocation();
  const p = new URLSearchParams(loc.search);
  const n = new URLSearchParams();
  for (const k of ["url", "doc", "tier"]) { const v = p.get(k); if (v) n.set(k, v); }
  return <Navigate to={`/author?${n}`} replace />;
}

/** Releases -- the `spa` fixture: the page ships an empty shell and a script renders these
 * (embedded as JSON), so the static tier sees nothing and `auto` escalates to a browser. */
export const RELEASES = [
  { version: "0.9.0", date: "2026-09-24", notes: "Events v2, traces with replay, the tool registry, the lab as a website." },
  { version: "0.8.0", date: "2026-09-10", notes: "Bounded loops with drivers and Ask/resume; the resolve ladder; crawl pending/resume." },
  { version: "0.7.0", date: "2026-08-28", notes: "Plan IR: blob, wireframe, explain; sync / async / remote dispatch from one plan." },
];

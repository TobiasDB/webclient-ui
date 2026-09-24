/** Site-wide constants -- the nav and footer are DATA so the lab contract (the links the
 * home page must expose) is generated from the same source the page renders from. */
export const SITE = {
  name: "WebClient",
  tagline: "A declarative web client: fetch, select, extract -- one plan, run anywhere.",
  nav: [
    ["/why", "Why"], ["/features", "Features"], ["/docs", "Docs"], ["/cost", "Cost"], ["/playground", "Playground"], ["/lab", "Lab"],
  ] as [string, string][],
  footer: [
    ["/about", "About"], ["/changelog", "Changelog"], ["/news", "News"], ["/case-studies", "Case studies"], ["/benchmarks", "Benchmarks"],
    ["/whitepaper", "Whitepaper"], ["/events", "Events"], ["/status", "Status"], ["/feed.xml", "RSS"], ["/login", "Sign in"],
  ] as [string, string][],
};
export const PLAYGROUND_URL = import.meta.env.PUBLIC_PLAYGROUND_URL ?? "http://localhost:5173";
export const API_URL_DEFAULT = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8000";

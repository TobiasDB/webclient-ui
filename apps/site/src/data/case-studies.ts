/** Case studies -- the `paginated` fixture (rel=next + ?page=, 3 pages of 4), the `cursor`
 * fixture (a keyset JSON API over the first 10), the detail pages (a list -> detail crawl),
 * and the `scroll` fixture (the archive, infinite scroll). One dataset, four behaviours. */
export type CaseStudy = { n: number; slug: string; title: string; sector: string; date: string; outcome: string; summary: string };
const RAW: [string, string, string, string, string][] = [
  ["price-monitor", "Price monitor across 40 retailers", "retail", "2026-09-20", "one plan, 40 sites, re-run nightly at $0"],
  ["job-board-etl", "A job board into a warehouse", "hr-tech", "2026-09-18", "pagination followed to the end, 3.1k rows"],
  ["tender-watch", "Public tenders behind a search form", "gov", "2026-09-15", "form filled, results paginated, flagged for review"],
  ["docs-to-rag", "Product docs into a RAG index", "devtools", "2026-09-12", "skeleton views cut tokens 9x"],
  ["spa-catalogue", "A React catalogue with no API", "e-commerce", "2026-09-09", "auto-escalation picked the browser once"],
  ["earnings-feed", "Earnings releases from an XHR feed", "finance", "2026-09-05", "the XHR endpoint found, the browser dropped"],
  ["realty-listings", "Listings with a cursor API", "real-estate", "2026-09-01", "keyset pagination, deterministic replay"],
  ["review-mining", "Reviews behind 'load more'", "cx", "2026-08-28", "scroll driver, 2k reviews, one HAR for tests"],
  ["press-archive", "A press archive redirected three times", "media", "2026-08-25", "redirect chain recorded, final URL kept"],
  ["login-portal", "A supplier portal behind a login", "supply-chain", "2026-08-20", "session held server-side, no credentials in the plan"],
  ["event-tabs", "Events split across tabs", "events", "2026-08-15", "tabbed content read without clicking"],
  ["large-index", "A 6000-row index page", "data", "2026-08-10", "large_document flagged, collapse=True, 12x fewer tokens"],
];
export const CASE_STUDIES: CaseStudy[] = RAW.map(([slug, title, sector, date, outcome], i) => ({
  n: i + 1, slug, title, sector, date, outcome,
  summary: `${title}. The brief was one sentence; the onboarding pipeline crawled, selected and evaluated; the confirm gate was passed once. Outcome: ${outcome}.`,
}));
export const PER_PAGE = 4;
export const PAGES = Math.ceil(CASE_STUDIES.length / PER_PAGE);
export const page = (n: number) => CASE_STUDIES.slice((n - 1) * PER_PAGE, n * PER_PAGE);
/** the keyset API: ?after=<n> -> the next 4 of the first 10 */
export const CURSOR_TOTAL = 10;
export const CURSOR_PAGE = 4;
export const cursorPage = (after: number) => {
  const items = CASE_STUDIES.filter((c) => c.n > after && c.n <= CURSOR_TOTAL).slice(0, CURSOR_PAGE).map((c) => ({ id: c.n, name: c.title }));
  const end = items.length ? items[items.length - 1]!.id : null;
  const more = end !== null && end < CURSOR_TOTAL;
  return { items, pageInfo: { endCursor: more ? end : null, hasNext: more } };
};
export const SCROLL_INITIAL = 5;
export const SCROLL_AFTER = 10;

/** Measured on this site's pages (see scripts/measure-cost in the package repo): the
 * characters -- and the ~tokens at 4 chars/token -- of the raw HTML vs the views the
 * client hands a model. Re-measured by CI; the date says when. Prices are INPUTS the
 * reader sets (a model's list price changes; the ratio is the argument). */
export const COST = {
  measured: "2026-09-24",
  model: "stub (deterministic demo model)",
  tokensPerChar: 0.25,
  pages: [
    { page: "/", label: "Home (product grid)", html: 9800, skeleton: 1900, markdown: 1400, card: 260 },
    { page: "/changelog", label: "Changelog (SPA, rendered)", html: 7400, skeleton: 1100, markdown: 800, card: 240 },
    { page: "/case-studies", label: "Case studies p1", html: 8600, skeleton: 1500, markdown: 1300, card: 250 },
    { page: "/benchmarks", label: "Benchmarks (6000 rows)", html: 612000, skeleton: 2200, markdown: 96000, card: 270 },
  ],
  /** what one authored query cost in the CI run: the onboarding pipeline's model calls */
  authoring: { calls: 4, inputTokens: 6100, outputTokens: 900 },
  presets: [
    { name: "Nightly price monitor", pagesPerDay: 40, rerunsPerDay: 1 },
    { name: "Hourly job board", pagesPerDay: 120, rerunsPerDay: 24 },
    { name: "One-off dataset", pagesPerDay: 3000, rerunsPerDay: 1 },
  ],
};

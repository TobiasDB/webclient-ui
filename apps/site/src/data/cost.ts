/** The cost page's numbers are MEASURED, never typed: `scripts/measure_cost.py` in the
 * package repo fetches this site's pages through the client and writes cost.json (the
 * views' sizes, the authoring run's model traffic, the date). Tokens ≈ chars / 4 -- the
 * page says so. The presets are the calculator's example scenarios (the `app` fixture). */
import measured from "./cost.json";

export const COST = {
  ...measured,
  tokens: (chars: number) => Math.round(chars / measured.chars_per_token),
  presets: [
    { name: "Nightly price monitor", pagesPerDay: 40, rerunsPerDay: 1 },
    { name: "Hourly job board", pagesPerDay: 120, rerunsPerDay: 24 },
    { name: "One-off dataset", pagesPerDay: 3000, rerunsPerDay: 1 },
  ],
};

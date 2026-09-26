/** A LIVE run, watched: the nested pages show as they are opened -- not only after the run ends. (A trace that
 * lagged the run left a just-opened page unreadable, and the view kept that miss.) */
import { expect, test } from "@playwright/test";
import fixture from "../../../packages/ui/src/lib/run/fixtures/jobs-run.json" with { type: "json" };

const API = "http://localhost:8010";
const LAB = "http://localhost:8011";

test("a nested browser resolve's pages show while the run is going", async ({ page }) => {
  const plan = JSON.parse(JSON.stringify(fixture.plan).replaceAll("127.0.0.1", "localhost").replaceAll("8012", "8011"));
  await page.goto("/run");
  await page.getByPlaceholder(/a plan:/).fill(JSON.stringify({ plan, url: `${LAB}/lab/jobs` }));
  await page.getByRole("button", { name: "Load" }).click();
  await page.locator("[data-act=run]").click();
  // while it runs: the item's detail page is in the chain -- still opening (its URL named), or rendered
  const seen = await expect.poll(async () => {
    const running = /running|starting/.test(await page.locator("[data-act=run]").locator("xpath=following-sibling::*[1]").innerText().catch(() => ""));
    const opening = await page.getByTestId("opening").filter({ hasText: "lab/jobs/detail" }).count();
    const loaded = await Promise.all(page.frames().map((f) => f.locator("h1").first().innerText({ timeout: 200 }).catch(() => "")));
    return running && (opening > 0 || loaded.some((t) => /Analyst|Engineer/.test(t)));
  }, { timeout: 30_000, intervals: [100] }).toBe(true);
  void seen;
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // the run finishes with every row; its trace is removed (the e2e traces are the committed ones)
  await expect(page.getByText(/^done$/).first()).toBeVisible({ timeout: 30_000 });
  const runs = (await (await page.request.get(`${API}/runs`)).json()) as { trace: string | null; started: number }[];
  const last = runs.sort((a, b) => b.started - a.started)[0];
  if (last?.trace) await page.request.delete(`${API}/traces/${last.trace}`);
});

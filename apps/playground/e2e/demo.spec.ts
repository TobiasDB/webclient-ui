/** The demo: a 3-card shop plan run inside a script that did other things. */
import { expect, test } from "@playwright/test";
import { layers, openTrace, planEvents, seek } from "./run.helpers";

const ID = "e2e-demo";

test("only the plan's events are its run", async ({ page }) => {
  const n = await openTrace(page, ID);
  expect(n).toBe((await planEvents(page, ID)).length);
  await expect(page.getByText(/3 rows · 1 pages · 1 requests/)).toBeVisible();
});

test("select_all outlines every match; each item spotlights its own card in the list", async ({ page }) => {
  await openTrace(page, ID);
  const evs = await planEvents(page, ID);
  const at = (pred: (e: Record<string, any>) => boolean) => evs.findIndex(pred) + 1;
  await seek(page, at((e) => e.phase === "result" && e.detail?.op === "select_all"));
  await expect.poll(async () => (await layers(page))[0]?.labels.join("|") ?? "").toContain('select_all("div.card") ×3');
  for (const k of [0, 1, 2]) {
    await seek(page, at((e) => e.phase === "result" && e.detail?.op === "attr" && e.item?.[0] === k));
    await expect.poll(async () => (await layers(page))[0]?.labels.join("|") ?? "").toContain(`item ${k + 1} of 3`);
    expect((await layers(page))[0]!.spot).toBe(true);
  }
});

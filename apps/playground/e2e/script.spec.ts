/** A script recorded (wc.record): its reads compiled to a plan -- it replays as that plan. */
import { expect, test } from "@playwright/test";
import { card, layers, openTrace, seek } from "./run.helpers";

test("a recorded script plays as its plan: each read placed on its step, its item spotlit in the list", async ({ page }) => {
  const n = await openTrace(page, "e2e-script");
  await expect(card(page, 'select_all("article.product_pod")')).toHaveCount(1);
  await seek(page, Math.round(n * 0.55));
  await expect.poll(async () => (await layers(page)).flatMap((l) => l.labels).some((x) => /^item \d+ of 20$/.test(x))).toBe(true);
  expect((await layers(page)).some((l) => l.spot)).toBe(true);
});

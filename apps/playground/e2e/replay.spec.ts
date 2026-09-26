/** A browser recording (the lab's events page, a tab clicked): the DOM replay plays what happened. */
import { expect, test } from "@playwright/test";
import { openTrace, pageFrames, seek } from "./run.helpers";

test("playing, the click's target is spotlit and the tab switches on screen", async ({ page }) => {
  await openTrace(page, "e2e-tabs");
  await seek(page, 0);
  await page.locator("[data-act=play]").click();
  const selected = async () => {
    for (const f of pageFrames(page)) {
      const v = await f.evaluate(() => document.querySelector('[data-tab="Past"]')?.getAttribute("aria-selected") ?? null).catch(() => null);
      if (v !== null) return v;
    }
    return null;
  };
  // the click step: the button spotlit on the recording, the tab not yet switched
  await expect(page.locator(".wc-evcard")).toContainText('click "button[data-tab="Past"]"', { timeout: 20_000 });
  await expect(page.locator(".wc-player .wc-spot")).toBeVisible();
  expect(await selected()).toBe("false");
  // then, as the recording plays on, the tab switches
  await expect.poll(selected, { timeout: 20_000 }).toBe("true");
});

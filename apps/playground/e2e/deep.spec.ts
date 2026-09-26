/** A 3-deep crawl: listing -> each book's page -> its category page, over select_all(...).limit(6). */
import { expect, test } from "@playwright/test";
import { card, layers, openTrace, planEvents, seek } from "./run.helpers";

const ID = "e2e-deep";

test("a nested crawl shows as its chain of pages: earlier pages folded, the followed link drawn to the page it opened", async ({ page }) => {
  await openTrace(page, ID);
  const evs = await planEvents(page, ID);
  let last = -1; evs.forEach((e, i) => { if (e.step === "6/kw:category/12" && e.phase === "result") last = i; });
  await seek(page, last + 1);
  await expect(page.getByText("page 1", { exact: true })).toBeVisible();       // the listing, folded to a chip
  await expect(page.getByText(/^page 2 · the link it followed/i)).toBeVisible();
  await expect(page.getByText(/^page 3$/i)).toBeVisible();
  await expect(page.locator(".wc-chain-arrow")).toHaveCount(1);
});

test("a limit shows the selection it limits: the first n taken, the rest faint", async ({ page }) => {
  await openTrace(page, ID);
  await card(page, "limit(6)").first().click();
  await expect.poll(async () => (await layers(page)).find((l) => l.labels.some((x) => x.startsWith("limit(6)")))?.solid ?? 0).toBe(6);
  const l = (await layers(page)).find((x) => x.labels.some((y) => y.startsWith("limit(6)")))!;
  expect(l.labels).toContain("limit(6) ×6");
  expect(l.dashed).toBe(14);
});

test("a cell goes to that step for that item, at the moment it ran", async ({ page }) => {
  await openTrace(page, ID);
  await card(page, 'attr("title")').first().locator('button[title^="item 3 "]').click();
  await expect(page.locator("[data-act=follow]")).toContainText("watching item 3");
  await expect(page.locator(".wc-evcard")).toContainText("Sharp Objects");
});

test("a row opens the pages it came from, each value outlined, the links drawn", async ({ page }) => {
  await openTrace(page, ID);
  await page.getByRole("button", { name: /▸ rows/ }).click();
  await page.locator("table tbody tr", { hasText: "Sapiens" }).click();
  await expect(page.getByText("title ← page 1")).toBeVisible();
  await expect(page.getByText("category ← page 3")).toBeVisible();
  await expect(page.locator(".wc-chain-arrow")).toHaveCount(2);
  await expect.poll(async () => (await layers(page)).flatMap((l) => l.labels)).toEqual(expect.arrayContaining(["→ title", "→ category"]));
});

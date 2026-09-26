/** Books: 2 pages paginated, each record's detail page read (a description, a table of rows). */
import { expect, test } from "@playwright/test";
import { card, layers, openTrace, seek } from "./run.helpers";

const ID = "e2e-books";

test("each card counts its own items; the same select is one node; outputs are on their cards", async ({ page }) => {
  await openTrace(page, ID);
  await expect(card(page, "paginate(").first().locator('button[title^="item"]')).toHaveCount(2);
  const h3 = card(page, 'select("h3 a")');
  await expect(h3).toHaveCount(1);
  await expect(h3.first().locator('button[title^="item"].bg-ok')).toHaveCount(40);
  for (const out of ["→ title", "→ price", "→ detail", "→ info"]) await expect(page.getByText(out, { exact: true }).first()).toBeVisible();
  await expect(page.locator(".wc-step", { hasText: "project()" })).toHaveCount(0);   // shaping is not a phase
});

test("steps in flight stay outlined until done; the moment is spotlit", async ({ page }) => {
  const n = await openTrace(page, ID);
  await seek(page, Math.round(n * 0.3));
  await expect.poll(async () => (await layers(page)).flatMap((l) => l.labels).some((x) => /^resolve… · item \d+/.test(x))).toBe(true);
  expect((await layers(page)).some((l) => l.spot)).toBe(true);
});

test("a card clicked opens its details", async ({ page }) => {
  await openTrace(page, ID);
  await card(page, 'attr("title")').first().click();
  await expect(page.getByText(/once for each item of/)).toBeVisible();
  await expect(page.getByText("40 of 40")).toBeVisible();
});

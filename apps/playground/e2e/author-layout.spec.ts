/** Author's layout: the rows bar (Open in Run, the rows toggle) stays on screen, collapsed or not, with a live page held. */
import { expect, test } from "@playwright/test";

const LAB = "http://localhost:8011/lab/paginated?page=1";

for (const rows of ["1", "0"]) test(`the rows bar stays on screen (rows ${rows === "1" ? "open" : "collapsed"})`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.addInitScript((r) => { localStorage.setItem("wc.author.rows", r); }, rows);
  await page.goto(`/author?url=${encodeURIComponent(LAB)}&tier=false`);
  const open = page.getByRole("button", { name: /Open in Run/ });
  await expect(open).toBeVisible();
  await expect.poll(async () => { const b = await open.boundingBox(); return !!b && b.y + b.height <= 800; }).toBe(true);
  // and the toggle brings the rows back
  if (rows === "0") { await page.getByTitle("show the rows").click(); await expect(page.getByTitle("hide the rows")).toBeVisible(); }
});

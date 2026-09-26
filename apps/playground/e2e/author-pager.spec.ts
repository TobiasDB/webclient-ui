/** Author: a page's pager -- `.paginate(…)` on the page opens the pager editor, seeded from the page's hint. */
import { expect, test } from "@playwright/test";

const LAB = "http://localhost:8011/lab/paginated?page=1";

test(".paginate(…) on the page opens the pager editor with the detected options", async ({ page }) => {
  await page.goto(`/author?url=${encodeURIComponent(LAB)}&tier=false`);
  await page.getByRole("button", { name: ".paginate(…)" }).click();
  const panel = page.getByTestId("pager-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("pager-hints")).toBeVisible();          // what the page's detection offered
  await expect(panel.getByTestId("pager-code")).toContainText(".paginate(");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // the toolbar button says what it walks; the editor changes it
  await panel.locator("select").first().selectOption("scroll");
  await expect(page.getByTestId("pager-open")).toContainText("infinite scroll");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // clicking a part of the plan opens what configures it: the pager -> the pager panel, the op -> its params
  await page.getByTestId("graph-pager").click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("pager-open")).toContainText("infinite scroll");
  await page.getByText(".resolve(", { exact: false }).first().click();
  await expect(panel).toBeHidden();
  await expect(page.getByText(".resolve() parameters")).toBeVisible();
});


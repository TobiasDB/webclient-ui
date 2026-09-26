/** A job board (the lab's): the listing rendered from a JSON API, each detail page in a browser, its posting in a
 * cross-origin embed. Run shows the pool the run held (which step held which page) and each page's network: the
 * API that filled the listing, by field, its body; Author shows the same on a live page. */
import { expect, test } from "@playwright/test";
import { layers, openTrace, planEvents, seek } from "./run.helpers";

const ID = "e2e-jobs";

test("concurrency: the pages held against the limit, and which step holds each", async ({ page }) => {
  await openTrace(page, ID);
  const pool = page.getByTestId("pool");
  await expect(pool.getByTestId("pool-page")).toContainText("browser pages");
  await expect(pool.getByTestId("pool-page-held")).toContainText("0/4 held");       // the end: all given back
  // mid-run, while the detail pages are open: the slots name the step (the detail column) and the item
  const evs = await planEvents(page, ID);
  const i = evs.findIndex((e) => e.topic === "resource" && e.detail?.what === "leased" && e.detail?.kind === "page" && String(e.step).includes("kw:detail"));
  await seek(page, i + 4);
  await expect(pool.getByTestId("pool-slot").first()).toContainText("resolve · detail");
  await expect(pool.getByTestId("pool-slot").first()).toContainText("#");
});

test("a page's network: the API that filled the listing, by field, its body, outlined on the page", async ({ page }) => {
  const n = await openTrace(page, ID);
  const evs = await planEvents(page, ID);
  // the listing's page: just after its snapshot
  const snap = evs.findIndex((e) => e.topic === "network.view" && String(e.detail?.url).endsWith("/lab/jobs"));
  await seek(page, Math.min(n, snap + 1));
  await page.getByTestId("net-toggle").first().click();
  const net = page.getByTestId("network").first();
  const api = net.getByTestId("net-row").filter({ hasText: "/lab/jobs/api" });
  await expect(api).toContainText("fills");
  await api.hover();
  // the listing is a browser recording: the outline is over the player (a snapshot would be in its frame's layer)
  await expect.poll(async () => (await page.locator(".wc-hl-label", { hasText: /filled by the request ×\d+/ }).count()) + (await layers(page)).filter((l) => l.labels.some((x) => /filled by the request/.test(x))).length).toBeGreaterThan(0);
  await api.click();
  await expect(net.getByTestId("net-fills")).toContainText("jobs[*].title ×4");
  await net.getByRole("button", { name: "load it" }).click();
  await expect(net.getByTestId("net-body")).toContainText('"title": "Desk Quant Analyst"');
});

test("Author: the live page's network, what each request filled", async ({ page }) => {
  await page.goto(`/author?url=${encodeURIComponent("http://localhost:8011/lab/jobs")}&tier=always`);
  await page.getByTestId("author-net").click();
  const api = page.getByTestId("net-row").filter({ hasText: "/lab/jobs/api" });
  await expect(api).toContainText("fills 8", { timeout: 20_000 });   // 4 titles + 4 locations
});

/** Helpers for driving the Run workspace against a recorded trace. */
import { expect, type Frame, type Page } from "@playwright/test";

const API = "http://localhost:8010";

/** open a recorded run in Run, and wait for it to load (its events and plan) */
export async function openTrace(page: Page, id: string): Promise<number> {
  await page.goto(`/run?trace=${encodeURIComponent(id)}`);
  await expect(page.locator("[data-act=play]")).toBeVisible();
  await expect.poll(async () => Number(await page.locator('input[type=range]').getAttribute("max"))).toBeGreaterThan(1);
  await expect(page.locator(".wc-step").first()).toBeVisible();
  return Number(await page.locator('input[type=range]').getAttribute("max"));
}

/** move the cursor to event index `i` (as the scrubber does) */
export async function seek(page: Page, i: number): Promise<void> {
  await page.evaluate((v) => {
    const r = document.querySelector("input[type=range]") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(r, String(v));
    r.dispatchEvent(new Event("input", { bubbles: true }));
  }, i);
}

/** the run's events as the Run view uses them: a trace carrying its plan's id is only that plan's events */
export async function planEvents(page: Page, id: string): Promise<Record<string, any>[]> {
  const evs = ((await (await page.request.get(`${API}/traces/${id}/events`)).json()) as Record<string, any>[]).filter((e) => e.topic !== "trace");
  const plan = await page.request.get(`${API}/traces/${id}/plan`);
  const pid = plan.ok() ? ((await plan.json()) as { plan_id?: string }).plan_id : undefined;
  return pid && evs.some((e) => e.plan_id === pid) ? evs.filter((e) => e.plan_id === pid) : evs;
}

/** the page frames (snapshots render in sandboxed srcdoc frames; recordings in rrweb's frame) */
export const pageFrames = (page: Page): Frame[] => page.frames().filter((f) => f !== page.mainFrame());

export type Layer = { labels: string[]; solid: number; dashed: number; spot: boolean };
/** what a snapshot frame highlights: its labels, outlines (solid / dashed) and whether an element is spotlit */
export async function layerOf(f: Frame): Promise<Layer | null> {
  return f.evaluate(() => {
    const layer = document.querySelector("[data-wc-layer]"); if (!layer) return null;
    const kids = [...layer.children] as HTMLElement[];
    return {
      labels: kids.map((x) => x.textContent ?? "").filter(Boolean),
      solid: kids.filter((x) => x.style.border && !x.style.border.includes("dashed") && !x.style.border.startsWith("3px")).length,
      dashed: kids.filter((x) => (x.style.border || "").includes("dashed")).length,
      spot: kids.some((x) => (x.style.border || "").startsWith("3px")),
    };
  }).catch(() => null);
}

/** the layers of every page frame shown */
export async function layers(page: Page): Promise<Layer[]> {
  const out: Layer[] = [];
  for (const f of pageFrames(page)) { const l = await layerOf(f); if (l) out.push(l); }
  return out;
}

/** a graph card by its op signature */
export const card = (page: Page, label: string) => page.locator(".wc-step", { hasText: label });

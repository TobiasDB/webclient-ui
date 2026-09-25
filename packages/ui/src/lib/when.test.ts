import { describe, expect, it } from "vitest";
import { looksLikeDate, toWhen } from "./plan";

describe("toWhen (the preview's date reading, as the package's)", () => {
  it("reads the usual forms", () => {
    expect(toWhen("2026-09-18")).toBe("2026-09-18");
    expect(toWhen("Posted 2026-09-18T14:05:00Z", { time: true })).toBe("2026-09-18T14:05:00+00:00");
    expect(toWhen("18 Sep 2026")).toBe("2026-09-18");
    expect(toWhen("September 18th, 2026 at 2:05 pm", { time: true })).toBe("2026-09-18T14:05:00");
    expect(toWhen("09/18/2026")).toBe("2026-09-18");
    expect(toWhen("18/09/2026", { dayfirst: true })).toBe("2026-09-18");
    expect(toWhen("2026.09.18")).toBe("2026-09-18");
    expect(toWhen("no date")).toBe(null);
    expect(looksLikeDate("In stock (22 available)")).toBe(false);
    expect(looksLikeDate("£51.77")).toBe(false);
  });
});

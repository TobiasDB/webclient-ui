import { describe, expect, it } from "vitest";
import { portable } from "./selectors";

describe("portable selectors", () => {
  it("never carries tbody (the server's HTML has none)", () => {
    expect(portable("tbody tr")).toBe("tr");
    expect(portable("table tbody tr")).toBe("table tr");
    expect(portable("table > tbody > tr > td")).toBe("table tr > td");
    expect(portable("tbody > tr:nth-of-type(2)")).toBe("tr:nth-of-type(2)");
    expect(portable("div.tbody-like tr")).toBe("div.tbody-like tr");
  });
});

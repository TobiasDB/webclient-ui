import { describe, expect, it } from "vitest";
import { withAgent } from "./PageFrame";

describe("withAgent", () => {
  it("drops widgets that cannot work in a sandboxed copy (captchas, analytics), keeps the page's own scripts", () => {
    const html = `<html><head><script src="https://www.google.com/recaptcha/api.js" async defer></script><script src="/static/app.js"></script></head><body><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe><iframe src="/embed/map"></iframe><div class="g-recaptcha"></div></body></html>`;
    const out = withAgent(html, "https://x.test/", false);
    expect(out).not.toContain("recaptcha/api.js");
    expect(out).not.toContain("recaptcha/api2");
    expect(out).toContain('src="/static/app.js"');
    expect(out).toContain('src="/embed/map"');
    expect(out).toContain('<base href="https://x.test/">');
  });
});

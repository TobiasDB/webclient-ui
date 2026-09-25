// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { addNode, emptyGraph, opOf, updateNode } from "./graph";
import { checkPlan } from "./check";

describe("plan check", () => {
  it("flags a line that matches nothing after an edit, and lines on pages not open", () => {
    let g = emptyGraph("https://x/");
    const add = (p: string, n: string, a: unknown[] = []) => { const r = addNode(g, p, opOf(n, a)); g = r.graph; return r.id; };
    const page = add(g.root, "resolve"); const li = add(page, "select_all", ["li.r"]);
    const t = add(li, "select", ["b"]); const txt = add(t, "attr", ["text"]);
    const a = add(li, "select", ["a"]); const href = add(a, "attr", ["href"]); const detail = add(href, "resolve");
    const doc = new DOMParser().parseFromString('<ul><li class="r"><b>1</b><a href="/d/1">x</a></li><li class="r"><b>2</b><a href="/d/2">y</a></li></ul>', "text/html");
    const docOf = (id: string) => (id === page ? doc : null);
    expect(checkPlan(g, docOf, "https://x/")).toEqual({ [detail]: expect.objectContaining({ level: "info" }) });
    // the fan-out's selector is edited to something that no longer holds the <b>: its line and read are flagged
    g = updateNode(g, t, { op: opOf("select", ["i"]) });
    const p = checkPlan(g, docOf, "https://x/");
    expect(p[t]?.level).toBe("error"); expect(p[txt]).toBeUndefined();
    g = updateNode(g, li, { op: opOf("select_all", ["li.nope"]) });
    expect(checkPlan(g, docOf, "https://x/")[li]?.short).toBe("no match");
  });
});

describe("plan check on steps", () => {
  it("checks an action's target on the step before it, and what follows on its snapshot", () => {
    let g = emptyGraph("https://x/");
    const add = (p: string, n: string, a: unknown[] = []) => { const r = addNode(g, p, opOf(n, a), { click: "Document", resolve: "Document", select: "Element", attr: "Value" }); g = r.graph; return r.id; };
    const page = add(g.root, "resolve"); const click = add(page, "click", ["button.more"]); const s = add(click, "select", ["p.new"]); add(s, "attr", ["text"]);
    const before = new DOMParser().parseFromString('<button class="more">more</button>', "text/html");
    const after = new DOMParser().parseFromString('<button class="more">more</button><p class="new">hi</p>', "text/html");
    expect(checkPlan(g, (id) => (id === page ? before : null), "https://x/")).toEqual({ [click]: expect.objectContaining({ level: "info" }) });
    expect(checkPlan(g, (id) => (id === page ? before : id === click ? after : null), "https://x/")).toEqual({});
    g = updateNode(g, click, { op: opOf("click", ["button.gone"]) });
    expect(checkPlan(g, (id) => (id === page ? before : id === click ? after : null), "https://x/")[click]?.short).toBe("no target");
  });
});

import { uniqueCandidates } from "./selectors";
describe("selector candidates", () => {
  it("prefers an identifying attribute over position", () => {
    const d = new DOMParser().parseFromString('<div><button data-tab="Upcoming">U</button><button data-tab="Past">P</button></div>', "text/html");
    const el = d.querySelector('[data-tab="Past"]')!;
    expect(uniqueCandidates(el, d)[0]?.selector).toBe('button[data-tab="Past"]');
  });
});

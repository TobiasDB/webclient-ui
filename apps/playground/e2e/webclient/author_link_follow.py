#!/usr/bin/env python
"""End-to-end test of the Author link-follow behaviour, driven by the webclient package
itself (a browser-automation toolkit) against a running Playground.

The Playground's Author workspace mirrors a LIVE browser page. A plain click on a LINK in
that mirror must be recorded as the page RESOLVED FROM the link -- ``select(sel).attr("href")
.resolve()`` -- not as a ``.click()`` on the source page (which would strand every later
selector on the source URL). A SHIFT-click still records a raw ``.click()``. And once a link
is followed, ``select`` / ``select_all`` must find the (re-homed) live page, not report that
none is present.

We drive the real browser with ``WebClient`` -- opening the Playground, typing a URL,
clicking a link inside the mirror by synthesising the same event the Player captures -- and
assert the authored plan. This is the toolkit testing its own UI.

Prerequisites (the dev stack, or the e2e stack from playwright.config.ts):
  * a Playground dev server         -- ``PLAYGROUND_URL`` (default http://localhost:5173)
  * the webclient API it talks to   -- reachable by that Playground (its Vite proxy)
This module starts its OWN fixture site (a listing whose rows link to detail pages), so it
needs nothing else. Run it with the package venv's python:

  env/bin/python apps/playground/e2e/webclient/author_link_follow.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from webclient import WebClient

PLAYGROUND = os.environ.get("PLAYGROUND_URL", "http://localhost:5173").rstrip("/")
FIXTURE_PORT = int(os.environ.get("FIXTURE_PORT", "8077"))
FIXTURE = f"http://127.0.0.1:{FIXTURE_PORT}/list"

# --------------------------------------------------------------------------- #
# the fixture: a listing whose rows link to detail pages
# --------------------------------------------------------------------------- #
_LIST = """<!doctype html><html><head><title>Widgets</title></head><body>
<h1>Widgets</h1>
<ul id="listing">
  <li><a class="item" href="/item?id=1">Widget One</a></li>
  <li><a class="item" href="/item?id=2">Widget Two</a></li>
</ul>
</body></html>"""


def _item(q: str) -> str:
    return (f"<!doctype html><html><head><title>Item {q}</title></head><body>"
            f'<h1 class="name">Widget {q}</h1><span class="price">$4{q}.00</span></body></html>')


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/item"):
            q = self.path.split("id=")[-1] if "id=" in self.path else "?"
            body = _item(q).encode()
        else:
            body = _LIST.encode()
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a: object) -> None:  # silence
        pass


# --------------------------------------------------------------------------- #
# driving the Playground's Author scene through the live mirror
# --------------------------------------------------------------------------- #
# The mirror is an <iframe> under a scaled overlay <div onClick>; the overlay's onClick maps
# the pointer into the iframe (x = (clientX - rect.left) / scale) and reports the picked
# element (with its href) to the Author. We locate a link inside the iframe, map its centre
# back out through the same scale, and dispatch a real click on the overlay -- exactly what a
# human click does. `scale` is the overlay's rendered width over its layout width (CSS
# transform: scale() leaves offsetWidth at the un-scaled size).
_CLICK_IN_MIRROR = r"""((sel, shift) => {
  const layers = [...document.querySelectorAll('.wc-player .origin-top-left')];
  const root = layers.find(l => l.querySelector('iframe'));
  const overlay = layers.find(l => !l.querySelector('iframe'));
  if (!root || !overlay) return {err: 'no player layers'};
  const idoc = root.querySelector('iframe').contentDocument;
  if (!idoc) return {err: 'no mirror document'};
  const el = idoc.querySelector(sel);
  if (!el) return {err: 'element not in mirror', sel};
  const ar = el.getBoundingClientRect(), orc = overlay.getBoundingClientRect();
  const scale = orc.width / overlay.offsetWidth;
  const cx = orc.left + (ar.left + ar.width / 2) * scale;
  const cy = orc.top + (ar.top + ar.height / 2) * scale;
  const top = document.elementFromPoint(cx, cy);
  const mk = t => new MouseEvent(t, {bubbles: true, cancelable: true, clientX: cx, clientY: cy, shiftKey: shift, view: window});
  top.dispatchEvent(mk('mousedown')); top.dispatchEvent(mk('mouseup')); top.dispatchEvent(mk('click'));
  return {ok: true, tag: el.tagName, href: el.href || null};
})(%s, %s)"""

# the plan tree, as its rows read -- Reference(...) and .op(...) lines (the "+ .op(...)"
# palette buttons carry a leading '+', so they are excluded).
_PLAN = (r"""(() => document.body.innerText.split('\n').map(s => s.trim()).filter(s =>"""
         r""" /^Reference\(/.test(s) ||"""
         r""" /^\.(resolve|select|select_all|attr|click|write|wait_for|paginate)\(/.test(s)))()""")

# is the live mirror present (pictured), or the "waiting for the live page…" placeholder?
_LIVE_STATE = r"""(() => ({
  waiting: /waiting for the live page to send its picture/i.test(document.body.innerText),
  player: !!document.querySelector('.wc-player .origin-top-left iframe'),
  hint: ([...document.querySelectorAll('*')].map(e => e.childElementCount === 0 && (e.textContent||'').trim())
          .find(s => /click to interact|picking in|no live/i.test(s))) || null,
}))()"""


def _open_author(pg: object) -> None:
    """Open the Playground, type the fixture URL, enter the Author scene, and wait for the
    live mirror to show the listing's links."""
    pg.write("input", FIXTURE)  # type: ignore[attr-defined]
    pg.evaluate(  # type: ignore[attr-defined]
        "(() => { const b = [...document.querySelectorAll('button,a')]"
        ".find(e => /Author a scrape/i.test(e.textContent||'')); if (b) b.click(); })()")
    ok = False
    for _ in range(60):
        time.sleep(0.5)
        ok = pg.evaluate(  # type: ignore[attr-defined]
            "(() => { const l = [...document.querySelectorAll('.wc-player .origin-top-left')];"
            " const r = l.find(x => x.querySelector('iframe'));"
            " const d = r && r.querySelector('iframe').contentDocument;"
            " return !!(d && d.querySelector('a.item')); })()")
        if ok:
            return
    raise AssertionError("the Author live mirror never showed the listing (is the API reachable?)")


def _click_palette(pg: object, label: str) -> str | None:
    return pg.evaluate(  # type: ignore[attr-defined]
        "((label) => { const b = [...document.querySelectorAll('button')]"
        ".find(e => e.textContent && e.textContent.trim().includes(label));"
        " if (b) { b.click(); return b.textContent.trim(); } return null; })(%s)" % json.dumps(label))


# --------------------------------------------------------------------------- #
# the tests
# --------------------------------------------------------------------------- #

def test_plain_link_click_is_recorded_as_a_resolve(wc: WebClient) -> None:
    """A plain click on a link records select(sel).attr('href').resolve() (a page reached by
    the link) and takes the live mirror to that page -- never a source-page .click()."""
    pg = wc.ref(PLAYGROUND + "/").resolve(browser=True).collect()
    try:
        _open_author(pg)
        clicked = pg.evaluate(_CLICK_IN_MIRROR % ('"a.item"', "false"))
        assert clicked.get("ok"), f"could not click the link: {clicked}"
        time.sleep(4)
        plan = pg.evaluate(_PLAN)
        joined = " | ".join(plan)
        assert any(".select(" in r for r in plan), f"no .select() recorded -- plan: {joined}"
        assert any('.attr("href")' in r for r in plan), f"no .attr(\"href\") recorded -- plan: {joined}"
        assert sum(r.startswith(".resolve(") for r in plan) >= 2, \
            f"expected a second .resolve() (the followed page) -- plan: {joined}"
        # the source-page click must NOT be there
        assert not any(r.startswith(".click(") for r in plan), \
            f"a .click() was recorded for a link follow -- plan: {joined}"
        # and the live mirror is now on the followed page
        assert not pg.evaluate(_LIVE_STATE)["waiting"], "the live mirror was lost after following the link"
    finally:
        wc.release(pg)


def test_shift_click_still_records_a_raw_click(wc: WebClient) -> None:
    """A SHIFT-click on the same link records a raw .click() step (the escape hatch)."""
    pg = wc.ref(PLAYGROUND + "/").resolve(browser=True).collect()
    try:
        _open_author(pg)
        clicked = pg.evaluate(_CLICK_IN_MIRROR % ('"a.item"', "true"))
        assert clicked.get("ok"), f"could not shift-click the link: {clicked}"
        time.sleep(3)
        plan = pg.evaluate(_PLAN)
        joined = " | ".join(plan)
        assert any(r.startswith(".click(") for r in plan), f"no .click() recorded for a shift-click -- plan: {joined}"
        assert not any('.attr("href")' in r for r in plan), f"a shift-click was followed as a resolve -- plan: {joined}"
    finally:
        wc.release(pg)


def test_select_all_finds_the_live_page_after_a_follow(wc: WebClient) -> None:
    """Regression: after following a link, opening a select_all must find the (re-homed) live
    page and enter picking -- not report that no live page is present."""
    pg = wc.ref(PLAYGROUND + "/").resolve(browser=True).collect()
    try:
        _open_author(pg)
        pg.evaluate(_CLICK_IN_MIRROR % ('"a.item"', "false"))
        time.sleep(4)
        assert _click_palette(pg, "+ .select_all") is not None, "the + .select_all palette button was not found"
        time.sleep(3)
        state = pg.evaluate(_LIVE_STATE)
        assert not state["waiting"], "select_all reported no live page after following a link"
        assert state["player"], "the live mirror is gone after opening select_all"
        assert state["hint"] and "picking" in state["hint"], f"select_all did not enter picking: {state}"
    finally:
        wc.release(pg)


def main() -> int:
    srv = HTTPServer(("127.0.0.1", FIXTURE_PORT), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tests = [
        test_plain_link_click_is_recorded_as_a_resolve,
        test_shift_click_still_records_a_raw_click,
        test_select_all_finds_the_live_page_after_a_follow,
    ]
    failed = 0
    try:
        with WebClient(timeout=60.0) as wc:
            for t in tests:
                try:
                    t(wc)
                    print(f"PASS  {t.__name__}")
                except Exception as e:  # noqa: BLE001 -- report and continue
                    failed += 1
                    print(f"FAIL  {t.__name__}: {e}")
    finally:
        srv.shutdown()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

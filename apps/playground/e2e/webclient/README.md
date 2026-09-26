# webclient-driven e2e

End-to-end tests that drive the Playground with the **webclient package itself** (a
browser-automation toolkit) — the toolkit exercising its own UI through a real browser,
rather than a headless Playwright runner.

They complement the Playwright specs in `../` (which run against recorded traces); these
drive a *live* browser page and assert what gets authored when you click around.

## Run

Needs a running Playground and the webclient API it proxies to. The tests start their own
fixture site, so nothing else is required.

```bash
# with the dev stack up (Playground on :5173, API reachable by its Vite proxy):
../../../../webclient/env/bin/python author_link_follow.py

# point at another Playground / fixture port if needed:
PLAYGROUND_URL=http://localhost:5180 FIXTURE_PORT=8078 \
  ../../../../webclient/env/bin/python author_link_follow.py
```

Each file prints `PASS`/`FAIL` per test and exits non-zero on any failure.

## Tests

- **`author_link_follow.py`** — clicking a link in the Author mirror is recorded as the page
  *resolved from* the link (`select(sel).attr("href").resolve()`), not a source-page
  `.click()`; a shift-click still records a raw `.click()`; and `select_all` finds the
  re-homed live page after a follow.

# webclient-ui — the WebClient web front ends

A separate repository from the `webclient` package: everything here talks to the
package's **HTTP API only** (the FastAPI service — `make serve` in `~/Git/webclient`,
which allows these dev servers via CORS). One npm workspace, three packages:

| package | what | run |
|---|---|---|
| `packages/ui` | the shared component library + design tokens + **Storybook** (wireframes and components are both stories) | `npm run storybook` → http://localhost:6006 |
| `apps/playground` | the Playground (Vite + React + TS) | `npm run dev:playground` → http://localhost:5173 |
| `apps/site` | the product website (Astro + React islands) — the site is also the lab | `npm run dev:site` → http://localhost:4321 |

Process (see `webclient/docs/product/*.md`): user stories → Storybook (wireframes as
stories, then real components) → the scenes (workspaces / pages) assembled from them.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # Node 22 (Homebrew)
npm install
npm run storybook
API_URL=http://localhost:8000 npm run dev:playground
```

The API base URL is `VITE_API_URL` (default `http://localhost:8000`). No auth.

## The website is the lab

`apps/site` replaces the package's in-process fixture pages with real pages that keep the same
contract: `/lab/index.json` lists every fixture (`name`, `path`, `feature`, `browser`) and
`/lab/<name>.json` publishes its expected result, both generated from the data the pages
render (`src/data/*.ts`, the registry in `src/data/lab.ts`). The package's test file runs
unchanged against it:

```bash
# terminal 1 — the API (the live demos call it; CORS allows :4321)
cd ~/Git/webclient && make serve
# terminal 2 — the site, built and served by the node adapter (dynamic fixtures need SSR)
npm run build:site && HOST=127.0.0.1 PORT=4321 node apps/site/dist/server/entry.mjs
# terminal 3 — the lab suite, against the site
cd ~/Git/webclient && LAB_URL=http://127.0.0.1:4321 env/bin/python -m pytest tests/test_lab.py
```

`npm run dev:site` is fine for editing pages; the fixture routes that set headers / status
(login, /blocked, /status/{code}, /slow, redirects, gzip) work in dev too.

Site env: `PUBLIC_API_URL` (default `http://localhost:8000`), `PUBLIC_PLAYGROUND_URL`
(default `http://localhost:5173`), `PUBLIC_SITE_URL`, `SITE_HOSTS` (extra Host headers
to trust in prod). The onboarding and traces pages replay `traces/onboarding.jsonl` and
`traces/demo.jsonl` from the API's traces dir (`python demo.py` records both); the cost
page's numbers come from `scripts/measure_cost.py --out apps/site/src/data/cost.json`.

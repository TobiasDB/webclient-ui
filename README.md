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

/** THE LAB CONTRACT. Every page of this site that strains a feature is a fixture: listed at
 * /lab/index.json (name, title, path, feature, browser) with its expected result at
 * /lab/<name>.json. Nothing here is hand-copied from a run: each expectation is derived
 * from the same data the page renders (PRODUCTS, CASE_STUDIES, RELEASES ...), so the
 * page and its expected JSON cannot drift apart. The package's tests/test_lab.py asserts
 * the client finds exactly these facts. */
import { PRODUCTS } from "./products";
import { NEWS } from "./news";
import { RELEASES } from "./changelog";
import { CASE_STUDIES, CURSOR_PAGE, CURSOR_TOTAL, PAGES, PER_PAGE, SCROLL_AFTER, SCROLL_INITIAL } from "./case-studies";
import { EVENTS } from "./events";
import { COST } from "./cost";
import { SITE } from "../lib/site";

export type Fixture = { name: string; title: string; path: string; feature: string; browser: boolean; expected: Record<string, unknown> };

export const TITLES = {
  home: "WebClient — a declarative web client", about: "About WebClient", whitepaper: "Whitepaper", benchData: "Benchmark data", landed: "Whitepaper",
};
export const BENCH_ROWS = 6000;
export const SITEMAP_PAGES = ["/", "/why", "/features", "/docs", "/cost", "/case-studies", "/changelog", "/news", "/events", "/benchmarks", "/whitepaper", "/about"];
export const ROBOTS_DISALLOW = ["/login", "/account", "/blocked"];

/** every anchor the home page renders, in DOM order (nav, the grid, the three paths, footer) */
export const HOME_PATHS: [string, string, string][] = [
  ["/why", "Evaluate", "Why not Playwright, a scraping SaaS, or a Claude session per run — answered with running code."],
  ["/features/tools", "Build", "One registry: the same tools as Python verbs, MCP tools and HTTP endpoints, with schemas and typed errors."],
  ["/features/scale", "Operate", "Self-hosted. A pool, fairness, resource events, the k8s recipe; your data never leaves."],
];
export const HOME_LINKS = [
  ...SITE.nav.map(([h]) => h),
  ...PRODUCTS.map((p) => `/api/products/${p.id}`),
  ...HOME_PATHS.map(([h]) => h),
  ...SITE.footer.map(([h]) => h),
];

export const FIXTURES: Fixture[] = [
  { name: "shop", title: "The home page: a static product grid (records, links, prices)", path: "/", feature: "extract", browser: false,
    expected: { records: PRODUCTS.length, record_selector: "div.card", titles: PRODUCTS.map((p) => p.name), prices: PRODUCTS.map((p) => p.price),
      flags: [], kind: "html", tier: "static", links: HOME_LINKS, item: "/api/products/2", item_stock: PRODUCTS[1]!.stock } },
  { name: "about", title: "A plain page", path: "/about", feature: "fetch", browser: false, expected: { title: TITLES.about, kind: "html" } },
  { name: "spa", title: "The changelog: a JS-rendered shell (SPA)", path: "/changelog", feature: "signals:spa", browser: true,
    expected: { static_flags: ["spa"], remedy: "browser", records_static: 0, records_rendered: RELEASES.length, record_selector: "li.item", tiers_auto: ["static", "browser"] } },
  { name: "feed", title: "The newsroom: an XHR-backed list", path: "/news", feature: "signals:spa+xhr", browser: true,
    expected: { api: "/api/news", records_rendered: NEWS.length, record_selector: "li.item", xhr_endpoints: ["/api/news"], items: NEWS.map(({ title, date }) => ({ title, date })) } },
  { name: "paginated", title: "Case studies: a dataset across pages (rel=next + ?page=)", path: "/case-studies", feature: "pagination", browser: false,
    expected: { pages: PAGES, per_page: PER_PAGE, total: CASE_STUDIES.length, record_selector: "article.row", flags: ["pagination"], next_of_1: "/case-studies?page=2" } },
  { name: "cursor", title: "The case-studies API: keyset pagination (?after=)", path: "/api/case-studies", feature: "pagination:cursor", browser: false,
    expected: { total: CURSOR_TOTAL, page_size: CURSOR_PAGE, cursor_path: "pageInfo.endCursor" } },
  { name: "tabs", title: "Events: content split across ARIA tabs", path: "/events", feature: "signals:tabbed", browser: false,
    expected: { flags: ["tabbed"], tabs: Object.keys(EVENTS), records: Object.values(EVENTS).flat().length, record_selector: "li.event" } },
  { name: "shadow", title: "Status: a web component (shadow root)", path: "/status", feature: "signals:shadow_dom", browser: true,
    expected: { flags_static: ["shadow_dom"], records_rendered: 2, record_selector: "li.p" } },
  { name: "iframe", title: "Whitepaper: a same-origin iframe", path: "/whitepaper", feature: "signals:iframe", browser: true,
    expected: { flags_static: ["iframe"], records_rendered: 2, inner: "/embed/toc", record_selector: "li.q" } },
  { name: "forms", title: "Docs: a search form + buttons", path: "/docs", feature: "signals:forms", browser: false,
    expected: { flags: ["forms", "buttons"], form_fields: ["q", "sort"] } },
  { name: "login", title: "Sign in: a password wall", path: "/login", feature: "signals:login", browser: false,
    expected: { flags: ["login_present", "login_required", "forms", "buttons"], auto_error: "fetch.login_required", account: "/account", cookie: "sid=abc123" } },
  { name: "antibot", title: "Blocked: a Cloudflare-style interstitial (403)", path: "/blocked", feature: "signals:anti_bot", browser: false,
    expected: { flags: ["anti_bot_triggered", "anti_bot_present"], remedy: "stealth", status: 403 } },
  { name: "redirect", title: "An old URL: a redirect chain (302 -> 301 -> 200)", path: "/old/whitepaper", feature: "transport:redirects", browser: false,
    expected: { hops: 2, final: "/whitepaper", title: TITLES.landed } },
  { name: "errors", title: "Status codes: /status/404 500 503", path: "/status/404", feature: "errors", browser: false,
    expected: { base: "/status", codes: { "404": "fetch.http_status", "500": "fetch.http_status", "503": "fetch.http_status" }, retriable: { "404": false, "500": true, "503": true } } },
  { name: "slow", title: "A slow endpoint (?delay= seconds, default 2)", path: "/slow", feature: "resiliency:timeout", browser: false, expected: { default_delay_s: 2 } },
  { name: "api", title: "The products API: a JSON document (nested records)", path: "/api/products", feature: "kind:json", browser: false,
    expected: { kind: "json", path: "data.items", count: PRODUCTS.length, first_name: PRODUCTS[0]!.name } },
  { name: "rss", title: "The news feed (RSS / XML)", path: "/feed.xml", feature: "kind:xml", browser: false,
    expected: { kind: "xml", items: NEWS.length, first_title: NEWS[0]!.title } },
  { name: "pdf", title: "The whitepaper PDF (binary)", path: "/whitepaper.pdf", feature: "kind:binary", browser: false, expected: { kind: "binary", content_type: "application/pdf" } },
  { name: "large", title: "Benchmarks: a very large document (6000 records)", path: "/benchmarks", feature: "signals:large_document", browser: false,
    expected: { records: BENCH_ROWS, flags: ["large_document"], record_selector: "li.item" } },
  { name: "gzip", title: "Benchmark data: a gzip-encoded response", path: "/benchmarks/data", feature: "transport:encoding", browser: false, expected: { title: TITLES.benchData } },
  { name: "sitemap", title: "sitemap.xml + robots.txt discovery", path: "/sitemap.xml", feature: "crawl:sitemap", browser: false,
    expected: { sitemap_urls: SITEMAP_PAGES, disallow: ROBOTS_DISALLOW, sitemap_in_robots: true, seed: "/", must_reach: "/about", must_skip: "/login" } },
  { name: "app", title: "The cost calculator: type, click, rows appear (XHR-backed)", path: "/cost", feature: "interact", browser: true,
    expected: { controls: ["#qty", "#add", "#load"], rows: "#cart li", after_add_rows: 1, after_load_rows: COST.presets.length, api: "/api/cost/presets" } },
  { name: "scroll", title: "The case-study archive: infinite scroll", path: "/case-studies/archive", feature: "interact:scroll", browser: true,
    expected: { initial_rows: SCROLL_INITIAL, after_scroll_rows: SCROLL_AFTER, row_selector: "li.r" } },
];
export const byName = Object.fromEntries(FIXTURES.map((f) => [f.name, f]));

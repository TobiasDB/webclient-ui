import type { APIRoute } from "astro";
import { gzipSync } from "node:zlib";
import { TITLES } from "../../data/lab";
export const prerender = false;
/** the `gzip` fixture: an explicitly gzip-encoded HTML response */
export const GET: APIRoute = () => {
  const html = `<!doctype html><html><head><title>${TITLES.benchData}</title></head><body><main><h1>${TITLES.benchData}</h1><p>Served with Content-Encoding: gzip.</p></main></body></html>`;
  return new Response(gzipSync(Buffer.from(html)), { headers: { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" } });
};

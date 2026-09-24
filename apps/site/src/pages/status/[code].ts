import type { APIRoute } from "astro";
export const prerender = false;
/** the `errors` fixture: /status/404, /status/500, /status/503 answer with that status */
export const GET: APIRoute = ({ params }) => {
  const code = Number(params.code);
  if (!Number.isInteger(code) || code < 100 || code > 599) return new Response("not a status", { status: 400 });
  return new Response(`<!doctype html><html><head><title>Error ${code}</title></head><body><h1>${code}</h1><p>A deliberate ${code} from /status/${code}.</p></body></html>`, { status: code, headers: { "content-type": "text/html; charset=utf-8" } });
};

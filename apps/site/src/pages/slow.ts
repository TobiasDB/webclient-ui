import type { APIRoute } from "astro";
export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
  const delay = Math.min(30, Number(url.searchParams.get("delay") ?? 2));
  await new Promise((r) => setTimeout(r, delay * 1000));
  return new Response(`<!doctype html><html><head><title>Slow</title></head><body><main><h1>Finally</h1><p>after ${delay}s</p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
};

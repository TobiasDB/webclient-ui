import type { APIRoute } from "astro";
import { SITEMAP_PAGES } from "../data/lab";
export const prerender = false; // absolute URLs from the Host the client used (the spec wants absolute locs)
export const GET: APIRoute = ({ request }) => {
  const origin = new URL(request.url).origin;
  const urls = SITEMAP_PAGES.map((u) => `<url><loc>${origin}${u}</loc></url>`).join("");
  return new Response(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml" } });
};

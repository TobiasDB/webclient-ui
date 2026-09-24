import type { APIRoute } from "astro";
import { ROBOTS_DISALLOW } from "../data/lab";
export const prerender = false;
export const GET: APIRoute = ({ request }) => {
  const origin = new URL(request.url).origin;
  return new Response(`User-agent: *\n${ROBOTS_DISALLOW.map((d) => `Disallow: ${d}`).join("\n")}\nSitemap: ${origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
};

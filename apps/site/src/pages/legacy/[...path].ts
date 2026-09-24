import type { APIRoute } from "astro";
export const prerender = false;
/** hop 2: /legacy/<page> 301 -> /<page> */
export const GET: APIRoute = ({ params }) => new Response(null, { status: 301, headers: { location: `/${params.path ?? ""}`, "content-type": "text/plain" } });

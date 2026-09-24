import type { APIRoute } from "astro";
export const prerender = false;
/** the `redirect` fixture, hop 1: /old/<page> 302 -> /legacy/<page> */
export const GET: APIRoute = ({ params }) => new Response(null, { status: 302, headers: { location: `/legacy/${params.path ?? ""}`, "content-type": "text/plain" } });

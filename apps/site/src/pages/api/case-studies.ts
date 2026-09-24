import type { APIRoute } from "astro";
import { cursorPage } from "../../data/case-studies";
export const prerender = false;
export const GET: APIRoute = ({ url }) => Response.json(cursorPage(Number(url.searchParams.get("after") ?? 0)));

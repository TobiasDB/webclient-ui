import type { APIRoute } from "astro";
import { RELEASES } from "../../data/changelog";
export const GET: APIRoute = () => Response.json(RELEASES);

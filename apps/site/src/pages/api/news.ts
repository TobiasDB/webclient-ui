import type { APIRoute } from "astro";
import { NEWS } from "../../data/news";
export const GET: APIRoute = () => Response.json(NEWS.map(({ title, date }) => ({ title, date })));

import type { APIRoute } from "astro";
import { FIXTURES } from "../../data/lab";
export const GET: APIRoute = () =>
  new Response(JSON.stringify(FIXTURES.map(({ name, title, path, feature, browser }) => ({ name, title, path, feature, browser }))), { headers: { "content-type": "application/json" } });

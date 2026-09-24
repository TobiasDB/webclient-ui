import type { APIRoute } from "astro";
import { FIXTURES } from "../../data/lab";
export function getStaticPaths() { return FIXTURES.map((f) => ({ params: { name: f.name } })); }
export const GET: APIRoute = ({ params }) => {
  const f = FIXTURES.find((x) => x.name === params.name);
  return new Response(JSON.stringify(f?.expected ?? {}), { headers: { "content-type": "application/json" } });
};

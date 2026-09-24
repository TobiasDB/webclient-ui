import type { APIRoute } from "astro";
import { PRODUCTS, productItem } from "../../../data/products";
export function getStaticPaths() { return PRODUCTS.map((p) => ({ params: { id: String(p.id) } })); }
export const GET: APIRoute = ({ params }) => { const p = PRODUCTS.find((x) => String(x.id) === params.id); return p ? Response.json(productItem(p)) : new Response("not found", { status: 404 }); };

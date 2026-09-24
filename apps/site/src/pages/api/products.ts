import type { APIRoute } from "astro";
import { PRODUCTS } from "../../data/products";
export const prerender = false; // a file route with a child directory (/api/products/{id}) cannot both be static
export const GET: APIRoute = () => Response.json({ data: { items: PRODUCTS.map((p) => ({ id: p.id, name: p.name, price: { value: Number(p.price), currency: "USD" } })), total: PRODUCTS.length } });

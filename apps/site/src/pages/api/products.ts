import type { APIRoute } from "astro";
import { PRODUCTS } from "../../data/products";
export const GET: APIRoute = () => Response.json({ data: { items: PRODUCTS.map((p) => ({ id: p.id, name: p.name, price: { value: Number(p.price), currency: "USD" } })), total: PRODUCTS.length } });

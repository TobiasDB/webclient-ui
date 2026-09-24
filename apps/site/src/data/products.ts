/** The home page's product grid -- the `shop` fixture: a static record list with titles,
 * prices and a detail link (a JSON item endpoint). */
export type Product = { id: number; name: string; price: string; blurb: string; sku: string; stock: number };
export const PRODUCTS: Product[] = [
  { id: 1, name: "Aeropress", price: "39.00", blurb: "One page, static tier, three rows.", sku: "SKU-1", stock: 7 },
  { id: 2, name: "Grinder", price: "129.00", blurb: "A JS shell, escalated to a browser, still three rows.", sku: "SKU-2", stock: 14 },
  { id: 3, name: "Gooseneck Kettle", price: "59.00", blurb: "Paginated, followed to the end, typed rows out.", sku: "SKU-3", stock: 21 },
];
export const productItem = (p: Product) => ({ id: p.id, name: p.name, stock: { count: p.stock }, sku: p.sku });

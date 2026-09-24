import type { APIRoute } from "astro";
import { NEWS } from "../data/news";
export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? "";
  const items = NEWS.map((it) => `<item><title>${it.title}</title><link>${origin}/news#${it.slug}</link><pubDate>${it.date}</pubDate></item>`).join("");
  return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>WebClient news</title><link>${origin}/news</link>${items}</channel></rss>`, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
};

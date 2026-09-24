import type { APIRoute } from "astro";
// a minimal, valid one-page PDF: the `pdf` fixture (kind: binary) -- the real whitepaper is the /whitepaper page
const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
export const GET: APIRoute = () => new Response(PDF, { headers: { "content-type": "application/pdf" } });

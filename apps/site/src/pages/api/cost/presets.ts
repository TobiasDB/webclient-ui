import type { APIRoute } from "astro";
import { COST } from "../../../data/cost";
export const GET: APIRoute = () => Response.json(COST.presets);

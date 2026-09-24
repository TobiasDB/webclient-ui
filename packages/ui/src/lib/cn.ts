import { clsx, type ClassValue } from "clsx";

/** Merge class names (clsx). Tailwind v4 has no class conflicts worth a merger here. */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);

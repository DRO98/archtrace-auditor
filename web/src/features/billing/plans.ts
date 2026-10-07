import { FREE_FINDINGS_LIMIT, FREE_REPO_LIMIT } from "./quota";

/** Precio mostrado; el cobro real lo define el producto del Payment Link. */
export const PRO_PRICE = "€12";
export const PRO_PERIOD = "/month";

/**
 * Stripe Payment Link (o Lemon Squeezy) del plan Pro. Configura su página de confirmación para redirigir a
 * `https://<app>/?license={CHECKOUT_SESSION_ID}`. Sin él, el botón de compra se muestra deshabilitado.
 */
export const PRO_CHECKOUT_URL = process.env.NEXT_PUBLIC_PRO_CHECKOUT_URL ?? "";

export const FREE_FEATURES: readonly string[] = [
  `${FREE_REPO_LIMIT} imported repos (GitHub or local folders)`,
  "Unlimited demos and Level 0 architecture map",
  `Architecture Check: top ${FREE_FINDINGS_LIMIT} findings + drift`,
  "BYOK or local Ollama: your keys, your costs",
];

export const PRO_FEATURES: readonly string[] = [
  "Unlimited imported repos",
  "Full Architecture Check (cycles, hubs, layer inversions)",
  "Change briefs → Cursor prompts, with history",
  "Same zero-data architecture: code never touches our servers",
];

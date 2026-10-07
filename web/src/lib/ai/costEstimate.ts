import type { TokenUsage } from "@core/playground";
import type { AiProviderId } from "./catalog";

/** USD por millón de tokens (entrada / salida). Precios públicos aproximados: solo orientan. */
export interface TokenPrice {
  input: number;
  output: number;
}

/**
 * De dónde sale la tarifa: el catálogo de la app, un precio escrito por el usuario,
 * un modelo local (coste 0) o ninguna (modelo nuevo sin tarifa conocida).
 */
export type PriceSource = "catalog" | "custom" | "local" | "unknown";

export interface ResolvedPrice {
  price: TokenPrice | null;
  source: PriceSource;
}

/** Tarifas escritas a mano en API & Integración, por `priceKey(provider, model)`. */
export type PriceOverrides = Readonly<Record<string, TokenPrice>>;

export const PRICES_PER_MILLION: Readonly<Partial<Record<AiProviderId, Readonly<Record<string, TokenPrice>>>>> = {
  openai: {
    "gpt-5": { input: 1.25, output: 10 },
    "gpt-5-mini": { input: 0.25, output: 2 },
    "gpt-5-nano": { input: 0.05, output: 0.4 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o4-mini": { input: 1.1, output: 4.4 },
    "text-embedding-3-small": { input: 0.02, output: 0 },
    "text-embedding-3-large": { input: 0.13, output: 0 },
  },
  anthropic: {
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-sonnet-4": { input: 3, output: 15 },
    "claude-opus-4": { input: 15, output: 75 },
    "claude-3-5-haiku": { input: 0.8, output: 4 },
  },
  gemini: {
    "gemini-3.8-flash": { input: 0.3, output: 2.5 },
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  },
  groq: {
    "openai/gpt-oss-120b": { input: 0.15, output: 0.75 },
    "openai/gpt-oss-20b": { input: 0.1, output: 0.5 },
    "qwen/qwen3.8-27b": { input: 0.3, output: 0.6 },
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
    "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  },
  deepseek: {
    "deepseek-chat": { input: 0.27, output: 1.1 },
    "deepseek-reasoner": { input: 0.55, output: 2.19 },
  },
};

export function priceKey(provider: AiProviderId, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Tarifa del catálogo para `model`. Acepta variantes con fecha o sufijo (`gpt-4o-mini-2024-07-18`,
 * `claude-sonnet-4-20250514`, `models/gemini-2.5-flash`): gana el prefijo más largo del catálogo.
 */
export function catalogPrice(provider: AiProviderId, model: string): TokenPrice | null {
  const table = PRICES_PER_MILLION[provider];
  if (!table) return null;
  const id = model.replace(/^models\//, "");
  if (table[id]) return table[id];
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (id.startsWith(`${key}-`) && (!best || key.length > best.length)) best = key;
  }
  return best ? table[best] : null;
}

/** Precio a aplicar: el escrito a mano manda; luego local (0), catálogo o desconocido. */
export function resolvePrice(provider: AiProviderId, model: string, overrides?: PriceOverrides | null): ResolvedPrice {
  const custom = overrides?.[priceKey(provider, model)];
  if (custom && isTokenPrice(custom)) return { price: custom, source: "custom" };
  if (provider === "ollama") return { price: { input: 0, output: 0 }, source: "local" };
  const price = catalogPrice(provider, model);
  return price ? { price, source: "catalog" } : { price: null, source: "unknown" };
}

/** Coste en USD con una tarifa ya resuelta; null si no hay tarifa. */
export function costFor(price: TokenPrice | null, usage: Pick<TokenUsage, "promptTokens" | "completionTokens">): number | null {
  if (!price) return null;
  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
}

/** Coste estimado en USD. Ollama corre en local: 0. Modelo sin tarifa conocida: null. */
export function estimateCost(provider: AiProviderId, model: string, usage: TokenUsage, overrides?: PriceOverrides | null): number | null {
  return costFor(resolvePrice(provider, model, overrides).price, usage);
}

/** Tarifa válida: dos números finitos, no negativos y razonables (< 10 000 $ por millón). */
export function isTokenPrice(value: unknown): value is TokenPrice {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isRate(record.input) && isRate(record.output);
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 10_000;
}

/** Tokens aproximados de un texto (≈ 4 caracteres por token) cuando el proveedor no informa del uso. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

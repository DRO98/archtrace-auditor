import type { TokenUsage } from "@core/playground";
import { PRICES_PER_MILLION, type TokenPrice } from "./costEstimate";

/** Modelos del estimador de costes RAG. Precios públicos aproximados (USD por millón de tokens). */
export interface RagCostModel {
  id: string;
  provider: "OpenAI" | "Groq" | "Anthropic";
  label: string;
  price: TokenPrice;
}

export const RAG_COST_MODELS: readonly RagCostModel[] = [
  { id: "gpt-4o", provider: "OpenAI", label: "GPT-4o", price: PRICES_PER_MILLION.openai?.["gpt-4o"] ?? { input: 2.5, output: 10 } },
  { id: "gpt-4o-mini", provider: "OpenAI", label: "GPT-4o mini", price: PRICES_PER_MILLION.openai?.["gpt-4o-mini"] ?? { input: 0.15, output: 0.6 } },
  { id: "llama-3.3-70b-versatile", provider: "Groq", label: "Llama 3.3 70B", price: { input: 0.59, output: 0.79 } },
  { id: "llama-3.1-8b-instant", provider: "Groq", label: "Llama 3.1 8B Instant", price: { input: 0.05, output: 0.08 } },
  { id: "claude-3-5-sonnet", provider: "Anthropic", label: "Claude 3.5 Sonnet", price: { input: 3, output: 15 } },
];

export const DEFAULT_MONTHLY_REQUESTS = 10_000;
/** Consulta RAG típica cuando aún no hay ejecución de la demo: contexto recuperado + respuesta corta. */
export const FALLBACK_USAGE: Pick<TokenUsage, "promptTokens" | "completionTokens"> = { promptTokens: 1_500, completionTokens: 300 };

export interface RagCostEstimate {
  inputUsd: number;
  outputUsd: number;
  perRequestUsd: number;
  totalUsd: number;
}

/** Coste de `requests` peticiones con el uso de tokens por petición dado. Puro: solo aritmética local. */
export function estimateRagCost(
  usage: Pick<TokenUsage, "promptTokens" | "completionTokens">,
  price: TokenPrice,
  requests: number,
): RagCostEstimate {
  const count = Number.isFinite(requests) && requests > 0 ? requests : 0;
  const prompt = Math.max(0, usage.promptTokens);
  const completion = Math.max(0, usage.completionTokens);
  const inputPerRequest = (prompt * price.input) / 1_000_000;
  const outputPerRequest = (completion * price.output) / 1_000_000;
  return {
    inputUsd: inputPerRequest * count,
    outputUsd: outputPerRequest * count,
    perRequestUsd: inputPerRequest + outputPerRequest,
    totalUsd: (inputPerRequest + outputPerRequest) * count,
  };
}

/** Dólares con precisión útil: céntimos para importes normales, más decimales para micro-costes. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 5;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })}`;
}

/** "$0.15 / $0.6 por 1M" para selectores y avisos; "sin tarifa" si falta. */
export function formatPrice(price: TokenPrice | null): string {
  return price ? `${formatUsd(price.input)} / ${formatUsd(price.output)} por 1M` : "sin tarifa";
}

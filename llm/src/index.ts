import { AI_PROVIDERS, currentModel, defaultModel, isModelName, isProviderId, isUsableKey, type AiProviderId } from "./catalog";
import { envKeyFor, envModelFor, geminiModel, ollamaBaseUrl, openaiModel, readUsableKey, resolveLocalBaseUrl } from "./env";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAiCompatibleProvider, createOpenAiProvider } from "./providers/openai";
import type { AiProvider, AiSelection } from "./types";

const BASE_URLS: Partial<Record<AiProviderId, string>> = {
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
};

/** Orden de preferencia del `.env` cuando hay varias claves: Gemini gana, como hasta ahora. */
const ENV_ORDER = ["gemini", "openai", "anthropic", "groq", "deepseek"] as const;

/** Usado por scripts y `/api/ai/status` sin selección. */
export function createProviderFromEnv(): AiProvider | null {
  for (const id of ENV_ORDER) {
    const key = readUsableKey(id);
    if (!key) continue;
    const model = id === "gemini" ? geminiModel() : id === "openai" ? openaiModel() : envModelFor(id) ?? defaultModel(id);
    return build(id, model, key);
  }
  return null;
}

/**
 * Con proveedor elegido en el navegador se usa SOLO ese: su clave del navegador o, si no hay,
 * la del `.env` para ese mismo proveedor (Ollama no necesita clave). Sin clave → null, nunca otro proveedor.
 * El `.env` completo solo decide cuando no hay selección ("Automático").
 */
export function createProvider(selection: AiSelection | null): AiProvider | null {
  const provider = selection?.provider;
  if (!provider) return createProviderFromEnv();
  const model = selection.model ?? defaultModel(provider);
  if (!AI_PROVIDERS[provider].needsKey) {
    // Servidor local: URL validada (solo hosts locales/privados). vLLM puede exigir clave; Ollama la ignora.
    const baseUrl = resolveLocalBaseUrl(selection.baseUrl);
    return baseUrl ? build(provider, model, selection.apiKey?.trim() || "ollama", baseUrl) : null;
  }
  const key = isUsableKey(selection.apiKey) ? selection.apiKey.trim() : envKeyFor(provider);
  return key ? build(provider, model, key) : null;
}

/** Lee `body.ai` sin confiar en él: descarta proveedores desconocidos y modelos con caracteres raros. */
export function readSelection(raw: unknown): AiSelection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!isProviderId(record.provider)) return null;
  return {
    provider: record.provider,
    model: isModelName(record.model) ? currentModel(record.provider, record.model) : undefined,
    apiKey: typeof record.apiKey === "string" ? record.apiKey : undefined,
    ...(typeof record.baseUrl === "string" && record.baseUrl.trim() ? { baseUrl: record.baseUrl.slice(0, 300) } : {}),
  };
}

export type ProviderDescription = { configured: false } | { configured: true; provider: AiProviderId; model: string };

export function describeProvider(selection: AiSelection | null = null): ProviderDescription {
  const provider = createProvider(selection);
  if (!provider) return { configured: false };
  return { configured: true, provider: provider.id, model: provider.model };
}

function build(id: AiProviderId, model: string, key: string, localBaseUrl?: string): AiProvider {
  switch (id) {
    case "gemini":
      return createGeminiProvider(key, model);
    case "openai":
      return createOpenAiProvider(key, model);
    case "anthropic":
      return createAnthropicProvider(key, model);
    case "ollama":
      // El cliente OpenAI exige una clave no vacía; Ollama la ignora.
      return createOpenAiCompatibleProvider({ id, apiKey: key, model, baseURL: localBaseUrl ?? ollamaBaseUrl(), strictSchema: false });
    case "groq":
    case "deepseek":
      return createOpenAiCompatibleProvider({ id, apiKey: key, model, baseURL: BASE_URLS[id], strictSchema: false });
  }
}

import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiProviderId } from "@/lib/ai/catalog";
import { shortlistModels } from "@/lib/ai/modelShortlist";
import type { ProviderCheck } from "@/lib/ai/providerStatus";

export interface LlmModelOption {
  provider: AiProviderId;
  model: string;
  label: string;
}

export interface LlmModelGroup {
  provider: AiProviderId;
  label: string;
  /** true si la clave está verificada (o el servidor local respondió) y los modelos son los que sirve. */
  verified: boolean;
  options: LlmModelOption[];
}

/**
 * Opciones del menú contextual del nodo LLM. Con el proveedor verificado se listan sus modelos reales
 * (lista corta, primero los del catálogo); sin verificar, los del catálogo, marcados para que el usuario lo sepa.
 * El servidor local (Ollama / vLLM) muestra lo que detectó el escaneo de `/api/tags`.
 */
export function llmModelGroups(checks: Readonly<Record<AiProviderId, ProviderCheck>>): LlmModelGroup[] {
  return AI_PROVIDER_IDS.map((provider) => {
    const info = AI_PROVIDERS[provider];
    const check = checks[provider];
    const verified = check.status === "connected" && check.models.length > 0;
    const models = verified ? shortlistModels(provider, check.models).shortlist : info.models;
    const options = models.map((item) => ({ provider, model: item.id, label: item.label }));
    return { provider, label: info.label, verified, options };
  });
}

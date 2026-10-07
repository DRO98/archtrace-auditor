/** Catálogo de proveedores y modelos. Lo comparten el modal de ajustes (cliente) y `createProvider` (servidor). */

export const AI_PROVIDER_IDS = ["openai", "anthropic", "gemini", "groq", "deepseek", "ollama"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiModelInfo {
  id: string;
  label: string;
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  models: readonly AiModelInfo[];
  /** Ollama corre en local y no pide clave. */
  needsKey: boolean;
  /** Dónde conseguir la clave (texto de ayuda en el modal). */
  keyHint?: string;
  /** Prefijo habitual de sus claves: solo sirve para avisar de un pegado equivocado, nunca para bloquear. */
  keyPrefix?: string;
}

export const OLLAMA_DEFAULT_URL = "http://localhost:11434/v1";

export const AI_PROVIDERS: Readonly<Record<AiProviderId, AiProviderInfo>> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    keyHint: "platform.openai.com/api-keys",
    keyPrefix: "sk-",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    needsKey: true,
    keyHint: "console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    keyHint: "aistudio.google.com/apikey",
    keyPrefix: "AIza",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  groq: {
    id: "groq",
    label: "Groq",
    needsKey: true,
    keyHint: "console.groq.com/keys",
    keyPrefix: "gsk_",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    needsKey: true,
    keyHint: "platform.deepseek.com/api_keys",
    keyPrefix: "sk-",
    models: [{ id: "deepseek-chat", label: "DeepSeek V3" }],
  },
  ollama: {
    id: "ollama",
    label: "Local (Ollama / vLLM)",
    needsKey: false,
    models: [
      { id: "llama3", label: "Llama 3" },
      { id: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
    ],
  },
};

export function isProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function providerLabel(id: AiProviderId): string {
  return AI_PROVIDERS[id].label;
}

/** "GPT-OSS 120B": etiqueta del catálogo, o el id tal cual si el modelo se escribió a mano. */
export function modelLabel(id: AiProviderId, model: string): string {
  return AI_PROVIDERS[id].models.find((item) => item.id === model)?.label ?? model;
}

/** "Groq · GPT-OSS 120B": etiqueta del catálogo, o el id tal cual si el modelo se escribió a mano. */
export function selectionLabel(id: AiProviderId, model: string): string {
  return `${AI_PROVIDERS[id].label} · ${modelLabel(id, model)}`;
}

export function defaultModel(id: AiProviderId): string {
  return AI_PROVIDERS[id].models[0]?.id ?? "";
}

/** Modelos que el proveedor ya no sirve (404 `model_not_found`). Quedan guardados en `localStorage` de versiones antiguas. */
const RETIRED_MODELS: Partial<Record<AiProviderId, readonly string[]>> = {
  groq: ["llama-3.3-70b-versatile"],
};

/** El modelo pedido, o el por defecto del proveedor si está retirado. */
export function currentModel(id: AiProviderId, model: string): string {
  return RETIRED_MODELS[id]?.includes(model) ? defaultModel(id) : model;
}

const PLACEHOLDER = /tu_api_key|changeme|your_api_key/i;

/** Una clave vacía, corta o de plantilla no cuenta: se cae al `.env`. */
export function isUsableKey(value: string | null | undefined): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed && trimmed.length >= 8 && !PLACEHOLDER.test(trimmed));
}

/** Nombre de modelo aceptable desde el cliente (el catálogo o uno escrito a mano con caracteres normales). */
export function isModelName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && /^[\w.:/-]+$/.test(value);
}

/** Aviso para la clave escrita en Ajustes, o null si parece correcta (o está vacía: entonces manda el `.env`). */
export function keyWarning(id: AiProviderId, value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  if (!key) return null;
  const info = AI_PROVIDERS[id];
  if (!isUsableKey(key)) {
    return "Esta clave parece incompleta o de ejemplo: el servidor la ignorará y usará la del .env si existe.";
  }
  if (/\s/.test(key)) return "La clave contiene espacios: revisa que se haya pegado entera y sin saltos de línea.";
  if (info.keyPrefix && !key.startsWith(info.keyPrefix)) {
    return `Las claves de ${info.label} suelen empezar por «${info.keyPrefix}». ¿Es la clave del proveedor correcto?`;
  }
  return null;
}

import { isUsableKey, OLLAMA_DEFAULT_URL, type AiProviderId } from "./catalog";

const KEY_VARS = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
} as const satisfies Partial<Record<AiProviderId, string>>;

export type KeyedProviderId = keyof typeof KEY_VARS;

export function readUsableKey(provider: KeyedProviderId): string | null {
  const value = process.env[KEY_VARS[provider]]?.trim();
  return isUsableKey(value) ? value : null;
}

/** Qué proveedores tienen clave utilizable en el entorno del servidor (`.env` / `.env.local`). Nunca expone el valor. */
export function envKeyStatus(): Record<KeyedProviderId, boolean> {
  return {
    gemini: readUsableKey("gemini") !== null,
    openai: readUsableKey("openai") !== null,
    anthropic: readUsableKey("anthropic") !== null,
    groq: readUsableKey("groq") !== null,
    deepseek: readUsableKey("deepseek") !== null,
  };
}

export function envKeyFor(provider: AiProviderId): string | null {
  return provider === "ollama" ? null : readUsableKey(provider);
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
}

export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function envModelFor(provider: AiProviderId): string | null {
  if (provider === "gemini") return geminiModel();
  if (provider === "openai") return openaiModel();
  return process.env[`${provider.toUpperCase()}_MODEL`]?.trim() || null;
}

export function ollamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL?.trim() || OLLAMA_DEFAULT_URL;
}

const PRIVATE_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|host\.docker\.internal|[\w-]+\.local)$/i;

/**
 * URL del servidor local (Ollama / vLLM) pedida por el navegador. Solo se aceptan hosts de la máquina
 * o de la red privada: el servidor de la app no debe servir de proxy hacia internet con URLs del cliente.
 * Vacía → `OLLAMA_BASE_URL` o el valor por defecto. Inválida → null.
 */
export function resolveLocalBaseUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return ollamaBaseUrl();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const configured = ollamaBaseUrl();
  const sameAsEnv = value.replace(/\/+$/, "") === configured.replace(/\/+$/, "");
  if (!sameAsEnv && !PRIVATE_HOST.test(url.hostname)) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

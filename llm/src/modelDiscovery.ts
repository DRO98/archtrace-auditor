import { AI_PROVIDERS, modelLabel, type AiProviderId } from "./catalog";
import { resolvePrice, type PriceSource, type TokenPrice } from "./costEstimate";
import { mapProviderError } from "./errors";
import { AiError } from "./types";

/** Un modelo que el proveedor sirve ahora mismo con esa clave, con su tarifa por millón de tokens. */
export interface DiscoveredModel {
  id: string;
  label: string;
  /** null = sin tarifa conocida: la interfaz permite escribirla a mano. */
  price: TokenPrice | null;
  priceSource: Exclude<PriceSource, "custom">;
}

export interface DiscoveryTarget {
  provider: AiProviderId;
  /** Clave ya resuelta (navegador o `.env`). Para el servidor local puede faltar. */
  apiKey: string | null;
  /** Solo servidor local: URL OpenAI-compatible ya validada (`resolveLocalBaseUrl`). */
  baseUrl: string | null;
}

const OPENAI_COMPATIBLE_URLS: Partial<Record<AiProviderId, string>> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
};

/** Modelos que no sirven para chat (audio, imagen, moderación, embeddings…). */
const NON_CHAT = /embed|whisper|tts|dall-e|audio|realtime|transcribe|moderation|image|davinci|babbage|guard|playai|search|computer-use/i;

const MAX_MODELS = 200;

/**
 * Lista los modelos activos del proveedor consultando su API con la clave del usuario.
 * Sirve también de verificación: una clave inválida responde 401/403 y se mapea a `auth`.
 */
export async function listProviderModels(target: DiscoveryTarget, signal: AbortSignal): Promise<DiscoveredModel[]> {
  const { provider } = target;
  try {
    const ids = await fetchModelIds(target, signal);
    const unique = [...new Map(ids.filter((item) => item.id).map((item) => [item.id, item])).values()];
    return unique
      .filter((item) => provider === "ollama" || !NON_CHAT.test(item.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, MAX_MODELS)
      .map((item) => {
        const resolved = resolvePrice(provider, item.id);
        return {
          id: item.id,
          label: item.label ?? modelLabel(provider, item.id),
          price: resolved.price,
          priceSource: resolved.source === "custom" ? "catalog" : resolved.source,
        };
      });
  } catch (error) {
    throw mapProviderError(error, provider);
  }
}

interface RawModel {
  id: string;
  label?: string;
}

async function fetchModelIds(target: DiscoveryTarget, signal: AbortSignal): Promise<RawModel[]> {
  const { provider, apiKey } = target;
  switch (provider) {
    case "anthropic": {
      const body = await getJson("https://api.anthropic.com/v1/models?limit=100", signal, {
        "x-api-key": requireKey(apiKey, provider),
        "anthropic-version": "2023-06-01",
      });
      return readList(body, "data").map((item) => ({ id: str(item.id), label: optionalStr(item.display_name) }));
    }
    case "gemini": {
      // La clave va en cabecera, nunca en la URL (acabaría en logs).
      const body = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", signal, {
        "x-goog-api-key": requireKey(apiKey, provider),
      });
      return readList(body, "models")
        .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("generateContent"))
        .map((item) => ({ id: str(item.name).replace(/^models\//, ""), label: optionalStr(item.displayName) }))
        .filter((item) => item.id.startsWith("gemini"));
    }
    case "ollama": {
      const base = target.baseUrl;
      if (!base) throw new AiError("unconfigured", "La URL del servidor local no es válida (solo se aceptan hosts locales o de red privada).");
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const body = await getJson(`${base}/models`, signal, headers);
      return readList(body, "data").map((item) => ({ id: str(item.id) }));
    }
    case "openai":
    case "groq":
    case "deepseek": {
      const body = await getJson(`${OPENAI_COMPATIBLE_URLS[provider]}/models`, signal, {
        authorization: `Bearer ${requireKey(apiKey, provider)}`,
      });
      return readList(body, "data").map((item) => ({ id: str(item.id) }));
    }
  }
}

function requireKey(apiKey: string | null, provider: AiProviderId): string {
  if (!apiKey) throw new AiError("unconfigured", `Falta la clave de ${AI_PROVIDERS[provider].label}.`);
  return apiKey;
}

/** GET JSON; un estado no-2xx se lanza como `Error` con `status` para que `mapProviderError` lo clasifique. */
async function getJson(url: string, signal: AbortSignal, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    const error = Object.assign(new Error(text.slice(0, 500) || response.statusText), { status: response.status });
    const code = readBodyErrorCode(text);
    throw code ? Object.assign(error, { code }) : error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiError("bad_response", "El proveedor no devolvió una lista de modelos en JSON.");
  }
}

/** `{"error":{"code":"insufficient_quota"}}` → "insufficient_quota" (para detectar cuota agotada). */
function readBodyErrorCode(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return null;
    const inner = parsed.error;
    if (typeof inner === "object" && inner !== null && "code" in inner && typeof inner.code === "string") return inner.code;
  } catch {
    // Cuerpo no JSON.
  }
  return null;
}

function readList(body: unknown, field: string): Record<string, unknown>[] {
  if (typeof body !== "object" || body === null) return [];
  const list = (body as Record<string, unknown>)[field];
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

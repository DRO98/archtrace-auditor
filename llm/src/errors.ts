import { providerLabel } from "./catalog";
import { AiError, type AiErrorCode, type AiProviderId, type ProviderErrorInfo } from "./types";

export function mapProviderError(error: unknown, provider: AiProviderId, model?: string): AiError {
  const name = providerLabel(provider);
  if (error instanceof AiError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AiError("aborted", "La petición se canceló.");
  }

  const status = readStatus(error);
  const message = error instanceof Error ? error.message : "";
  const upstream: ProviderErrorInfo = { status, message: upstreamMessage(message) };
  const detail = status ? `HTTP ${status}: ${upstream.message}` : upstream.message || undefined;
  if (isQuotaExhausted(status, readErrorCode(error), upstream.message)) {
    return new AiError(
      "quota",
      `Tu clave de ${name} se ha quedado sin saldo o ha agotado su cuota. Recarga créditos en el panel de ${name} o cambia de proveedor en API & Integración.`,
      detail,
      upstream,
    );
  }
  if (status === 404 || readErrorCode(error) === "model_not_found") {
    const which = model ? `El modelo "${model}"` : "El modelo elegido";
    return new AiError("provider", `${which} no existe en ${name} o tu clave no tiene acceso. Elige otro modelo en Ajustes.`, detail, upstream);
  }
  if (status === 401 || status === 403) {
    return new AiError("auth", `La clave de ${name} no es válida. Revísala en Ajustes o en web/.env.local.`, detail, upstream);
  }
  if (status === 429) {
    return new AiError("rate_limit", `${name} limitó el uso. Espera un momento y vuelve a intentarlo.`, detail, upstream);
  }
  if (status !== null && isTransientStatus(status)) {
    return new AiError(
      "unavailable",
      `${name} no está disponible ahora mismo (HTTP ${status}). Suele ser temporal: reintenta en unos segundos o cambia de modelo en Ajustes.`,
      detail,
      upstream,
    );
  }

  if (/abort/i.test(message)) {
    return new AiError("aborted", "La petición se canceló.");
  }
  if (isNetworkFailure(error, message)) {
    const local = provider === "ollama" ? " ¿Está Ollama arrancado (ollama serve)?" : "";
    return new AiError("network", `No se pudo conectar con ${name}.${local}`);
  }

  console.error(`[ai:${provider}] error del proveedor`, error);
  return new AiError("provider", `${name} devolvió un error.`, detail, upstream);
}

/** Gemini mete el cuerpo JSON en `message` ('{"error":{"code":404,"message":"…"}}'): extrae el texto legible. */
function upstreamMessage(message: string): string {
  const start = message.indexOf("{");
  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(message.slice(start));
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        const inner = parsed.error;
        if (typeof inner === "object" && inner !== null && "message" in inner && typeof inner.message === "string") {
          return inner.message;
        }
      }
    } catch {
      // No es JSON: se devuelve el mensaje tal cual.
    }
  }
  return message;
}

export function statusForCode(code: AiErrorCode): number {
  switch (code) {
    case "auth":
      return 401;
    case "rate_limit":
      return 429;
    case "quota":
      return 402;
    case "unconfigured":
    case "unavailable":
      return 503;
    case "timeout":
      return 504;
    case "aborted":
      return 499;
    case "bad_response":
      return 422;
    case "network":
    case "provider":
      return 502;
    default:
      return 502;
  }
}

const QUOTA_MESSAGE = /insufficient[_ ](quota|balance)|credit balance is too low|exceeded your current quota|billing[_ ]hard[_ ]limit|payment required/i;

/**
 * Saldo o cuota agotados, distinto de un 429 pasajero: DeepSeek responde 402, OpenAI 429 `insufficient_quota`,
 * Anthropic 400 "credit balance is too low" y Gemini 429 "exceeded your current quota".
 */
export function isQuotaExhausted(status: number | null, code: string | null, message: string): boolean {
  if (status === 402) return true;
  if (code === "insufficient_quota") return true;
  return (status === 400 || status === 403 || status === 429) && QUOTA_MESSAGE.test(message);
}

/** 5xx y 529 (Anthropic "overloaded"): fallos del proveedor que suelen resolverse solos. */
export function isTransientStatus(status: number): boolean {
  return status === 529 || (status >= 500 && status <= 599);
}

/** Estado HTTP de un error del proveedor (SDKs y `fetch` lo exponen como `status`). */
export function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  if ("status" in error && typeof error.status === "number") return error.status;
  return null;
}

/** El SDK de OpenAI expone `code` del cuerpo (`model_not_found`, `invalid_api_key`…). */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/** Recorre la cadena `cause` (el SDK de OpenAI envuelve el ECONNREFUSED en APIConnectionError). */
function isNetworkFailure(error: unknown, message: string, depth = 0): boolean {
  if (typeof error === "object" && error !== null) {
    if ("code" in error) {
      const code = error.code;
      if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT") return true;
    }
    if (error instanceof Error && error.name === "APIConnectionError") return true;
    if (depth < 4 && "cause" in error && error.cause) {
      const cause = error.cause;
      if (isNetworkFailure(cause, cause instanceof Error ? cause.message : "", depth + 1)) return true;
    }
  }
  return /fetch failed|network|connection error|ECONNREFUSED|ENOTFOUND/i.test(message);
}

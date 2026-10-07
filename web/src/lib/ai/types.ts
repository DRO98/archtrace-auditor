import type { TokenUsage } from "@core/playground";
import type { AiProviderId } from "./catalog";

export type { AiProviderId } from "./catalog";

export type AiErrorCode =
  | "auth"
  | "rate_limit"
  /** Sin saldo o cuota agotada (402, `insufficient_quota`, "credit balance is too low"…). No se arregla esperando. */
  | "quota"
  | "network"
  | "bad_response"
  | "provider"
  | "unavailable"
  | "timeout"
  | "aborted"
  | "unconfigured";

/** Error HTTP tal como lo devolvió el proveedor (404 modelo retirado, 401 clave, 429 cuota…). */
export interface ProviderErrorInfo {
  status: number | null;
  message: string;
}

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly hint: string;
  /** Diagnostic detail (validation errors, finish reason, upstream message). Safe to show to the developer. */
  readonly detail?: string;
  readonly providerError?: ProviderErrorInfo;

  constructor(code: AiErrorCode, hint: string, detail?: string, providerError?: ProviderErrorInfo) {
    super(detail ? `${hint} (${detail})` : hint);
    this.name = "AiError";
    this.code = code;
    this.hint = hint;
    this.detail = detail;
    this.providerError = providerError;
  }
}

export interface CompleteJsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
}

export interface CompleteTextRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface CompleteTextResult {
  text: string;
  /** Ausente si el proveedor no informa del consumo (algunos modelos de Ollama). */
  usage?: TokenUsage;
}

export interface AiProvider {
  id: AiProviderId;
  model: string;
  completeJson(request: CompleteJsonRequest, signal: AbortSignal): Promise<unknown>;
  /** Texto libre, de una vez (sin streaming). Lo usa el playground RAG. */
  completeText(request: CompleteTextRequest, signal: AbortSignal): Promise<CompleteTextResult>;
}

/** Proveedor, modelo y clave elegidos en el navegador. Cualquier campo puede faltar: entonces manda el `.env`. */
export interface AiSelection {
  provider?: AiProviderId;
  model?: string;
  apiKey?: string;
  /** Solo para el servidor local (Ollama / vLLM): URL OpenAI-compatible, validada en el servidor. */
  baseUrl?: string;
}

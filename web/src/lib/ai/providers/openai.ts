import OpenAI from "openai";
import { mapProviderError } from "../errors";
import { logRawResponse, parseProviderJson } from "../json";
import {
  AiError,
  type AiProvider,
  type AiProviderId,
  type CompleteJsonRequest,
  type CompleteTextRequest,
  type CompleteTextResult,
} from "../types";

interface OpenAiCompatibleOptions {
  id: AiProviderId;
  apiKey: string;
  model: string;
  baseURL?: string;
  /**
   * Solo OpenAI garantiza `json_schema` estricto. Groq, DeepSeek y Ollama reciben el esquema
   * en el prompt, piden `json_object` y la respuesta pasa por `parseProviderJson`.
   */
  strictSchema: boolean;
}

export function createOpenAiProvider(apiKey: string, model: string): AiProvider {
  return createOpenAiCompatibleProvider({ id: "openai", apiKey, model, strictSchema: true });
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const { id, model, strictSchema } = options;
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  // GPT-OSS en Groq razona antes de responder y ese razonamiento consume `max_tokens`: con presupuestos
  // cortos el JSON sale cortado y Groq lo rechaza con 400 `json_validate_failed`.
  const reasoningOptions = id === "groq" && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {};

  return {
    id,
    model,
    async completeJson(request: CompleteJsonRequest, signal: AbortSignal): Promise<unknown> {
      try {
        return await requestJson(request, signal);
      } catch (error) {
        // Groq valida el JSON generado y responde 400 `json_validate_failed` si no parsea (p. ej. cortado
        // por `max_tokens`). Se rescata `failed_generation` o se reintenta una vez sin `response_format`.
        if (strictSchema || !isJsonValidateFailed(error)) throw mapProviderError(error, id, model);
        const failed = readFailedGeneration(error);
        if (failed) {
          try {
            return parseProviderJson(failed, id, "length");
          } catch {
            // No se pudo reparar: se reintenta abajo.
          }
        }
        logRawResponse(id, "json_validate_failed: reintento sin response_format", failed ?? "");
        try {
          const completion = await client.chat.completions.create(
            {
              model,
              messages: [
                { role: "system", content: `${request.system}\n\n${jsonInstruction(request)}` },
                { role: "user", content: request.user },
              ],
              max_tokens: request.maxTokens * 2,
              ...reasoningOptions,
            },
            { signal },
          );
          const choice = completion.choices[0];
          const text = choice?.message.content;
          if (!text) throw new AiError("bad_response", "La IA no devolvió texto.", `finish_reason=${choice?.finish_reason ?? "?"}`);
          return parseProviderJson(text, id, choice.finish_reason);
        } catch (retryError) {
          throw mapProviderError(retryError, id, model);
        }
      }
    },

    async completeText(request: CompleteTextRequest, signal: AbortSignal): Promise<CompleteTextResult> {
      try {
        const messages = [
          { role: "system" as const, content: request.system },
          { role: "user" as const, content: request.user },
        ];
        // OpenAI ya no acepta `max_tokens` en modelos recientes; los compatibles solo conocen `max_tokens`.
        const completion = await client.chat.completions.create(
          strictSchema ? { model, messages, max_completion_tokens: request.maxTokens } : { model, messages, max_tokens: request.maxTokens },
          { signal },
        );
        const choice = completion.choices[0];
        const text = choice?.message.content;
        if (!text) {
          logRawResponse(id, "respuesta vacía", completion, choice?.finish_reason);
          throw new AiError(
            "bad_response",
            "La IA no devolvió texto.",
            choice?.message.refusal ?? `finish_reason=${choice?.finish_reason ?? "?"}`,
          );
        }
        const usage = completion.usage;
        return {
          text,
          usage: usage
            ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }
            : undefined,
        };
      } catch (error) {
        throw mapProviderError(error, id, model);
      }
    },
  };

  async function requestJson(request: CompleteJsonRequest, signal: AbortSignal): Promise<unknown> {
    const completion = await client.chat.completions.create(
      strictSchema
        ? {
            model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: request.schemaName, strict: true, schema: request.schema },
            },
            max_completion_tokens: request.maxTokens,
          }
        : {
            model,
            messages: [
              {
                role: "system",
                content: `${request.system}

${jsonInstruction(request)}`,
              },
              { role: "user", content: request.user },
            ],
            response_format: { type: "json_object" },
            max_tokens: request.maxTokens,
            ...reasoningOptions,
          },
      { signal },
    );
    const choice = completion.choices[0];
    const text = choice?.message.content;
    if (!text) {
      logRawResponse(id, "respuesta vacía", completion, choice?.finish_reason);
      const refusal = choice?.message.refusal;
      throw new AiError("bad_response", "La IA no devolvió texto.", refusal ?? `finish_reason=${choice?.finish_reason ?? "?"}`);
    }
    return parseProviderJson(text, id, choice.finish_reason);
  }
}

/** Cuerpo de error del SDK de OpenAI (`APIError.error`); algunos proveedores lo anidan en `error.error`. */
function errorBody(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null || !("error" in error)) return null;
  const body = error.error;
  if (typeof body !== "object" || body === null) return null;
  if ("error" in body && typeof body.error === "object" && body.error !== null) return body.error as Record<string, unknown>;
  return body as Record<string, unknown>;
}

/** Groq: HTTP 400 `json_validate_failed` ("Failed to validate JSON") cuando el modelo genera JSON inválido. */
export function isJsonValidateFailed(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = ("code" in error && error.code) || errorBody(error)?.code;
  if (code === "json_validate_failed") return true;
  const status = "status" in error ? error.status : null;
  return status === 400 && error instanceof Error && /failed to validate json/i.test(error.message);
}

/** Texto que el modelo llegó a generar antes de que Groq rechazara el JSON. */
export function readFailedGeneration(error: unknown): string | null {
  const failed = errorBody(error)?.failed_generation;
  return typeof failed === "string" && failed.trim() ? failed : null;
}

/** Instrucción para proveedores sin `json_schema`: el esquema viaja en el prompt. */
export function jsonInstruction(request: CompleteJsonRequest): string {
  return [
    "Responde únicamente en formato JSON válido: un solo objeto JSON, sin markdown ni texto alrededor.",
    `El JSON debe cumplir este JSON Schema (${request.schemaName}):`,
    JSON.stringify(request.schema),
  ].join("\n");
}

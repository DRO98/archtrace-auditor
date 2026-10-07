import { mapProviderError } from "../errors";
import { logRawResponse, parseProviderJson } from "../json";
import { parseRetryAfter, withTransientRetry } from "../retry";
import { AiError, type AiProvider, type CompleteJsonRequest, type CompleteTextRequest, type CompleteTextResult } from "../types";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface MessagesResponse {
  content?: Array<{ type: string; text?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Messages API por fetch (sin SDK). El JSON se fuerza con una herramienta cuyo `input_schema`
 * es el esquema pedido y `tool_choice` obligatorio: el modelo devuelve el objeto ya estructurado.
 */
export function createAnthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    id: "anthropic",
    model,
    async completeJson(request: CompleteJsonRequest, signal: AbortSignal): Promise<unknown> {
      try {
        const body = await postMessages(
          apiKey,
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
            tools: [{ name: request.schemaName, description: "Devuelve la respuesta estructurada.", input_schema: request.schema }],
            tool_choice: { type: "tool", name: request.schemaName },
          },
          signal,
        );
        const tool = body.content?.find((block) => block.type === "tool_use");
        if (tool && typeof tool.input === "object" && tool.input !== null) return tool.input;

        const prose = body.content?.find((block) => block.type === "text")?.text;
        if (prose) return parseProviderJson(prose, "anthropic", body.stop_reason);
        logRawResponse("anthropic", "respuesta vacía", body, body.stop_reason);
        throw new AiError("bad_response", "Anthropic no devolvió contenido.", `stop_reason=${body.stop_reason ?? "?"}`);
      } catch (error) {
        throw mapProviderError(error, "anthropic", model);
      }
    },

    async completeText(request: CompleteTextRequest, signal: AbortSignal): Promise<CompleteTextResult> {
      try {
        const body = await postMessages(
          apiKey,
          { model, max_tokens: request.maxTokens, system: request.system, messages: [{ role: "user", content: request.user }] },
          signal,
        );
        const text = (body.content ?? [])
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text)
          .join("");
        if (!text) {
          logRawResponse("anthropic", "respuesta vacía", body, body.stop_reason);
          throw new AiError("bad_response", "Anthropic no devolvió contenido.", `stop_reason=${body.stop_reason ?? "?"}`);
        }
        const input = body.usage?.input_tokens;
        const output = body.usage?.output_tokens;
        return {
          text,
          usage:
            typeof input === "number" && typeof output === "number"
              ? { promptTokens: input, completionTokens: output, totalTokens: input + output }
              : undefined,
        };
      } catch (error) {
        throw mapProviderError(error, "anthropic", model);
      }
    },
  };
}

async function postMessages(apiKey: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<MessagesResponse> {
  const text = await withTransientRetry(async () => {
    const response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(payload),
      signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw Object.assign(new Error(raw), { status: response.status, retryAfterMs });
    }
    return raw;
  }, signal);
  return parseEnvelope(text);
}

/** Un proxy o un corte de red pueden devolver 200 con HTML o un cuerpo a medias: no debe escapar un SyntaxError. */
function parseEnvelope(text: string): MessagesResponse {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed as MessagesResponse;
  } catch {
    // Se trata abajo.
  }
  logRawResponse("anthropic", "sobre de respuesta no es JSON", text);
  throw new AiError("bad_response", "Anthropic devolvió una respuesta ilegible.");
}

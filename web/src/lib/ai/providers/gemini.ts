import { GoogleGenAI } from "@google/genai";
import { mapProviderError } from "../errors";
import { logRawResponse, parseProviderJson } from "../json";
import { withTransientRetry } from "../retry";
import { AiError, type AiProvider, type CompleteJsonRequest, type CompleteTextRequest, type CompleteTextResult } from "../types";

/**
 * Gemini 2.5 models spend "thinking" tokens out of maxOutputTokens. Without headroom a 2.5k budget
 * is consumed before the JSON closes and the lesson arrives truncated.
 */
const THINKING_HEADROOM_TOKENS = 6000;

export function createGeminiProvider(apiKey: string, model: string): AiProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    id: "gemini",
    model,
    async completeJson(request: CompleteJsonRequest, signal: AbortSignal): Promise<unknown> {
      try {
        const response = await withTransientRetry(
          () =>
            client.models.generateContent({
              model,
              contents: request.user,
              config: {
                systemInstruction: request.system,
                responseMimeType: "application/json",
                responseJsonSchema: request.schema,
                maxOutputTokens: request.maxTokens + THINKING_HEADROOM_TOKENS,
                abortSignal: signal,
              },
            }),
          signal,
        );
        const text = response.text;
        const finishReason = response.candidates?.[0]?.finishReason;
        if (!text) {
          logRawResponse("gemini", "respuesta vacía", response, finishReason);
          const blocked = response.promptFeedback?.blockReason;
          throw new AiError("bad_response", "Gemini no devolvió texto.", blocked ? `blockReason=${blocked}` : `finishReason=${finishReason ?? "?"}`);
        }
        return parseProviderJson(text, "gemini", finishReason);
      } catch (error) {
        throw mapProviderError(error, "gemini", model);
      }
    },

    async completeText(request: CompleteTextRequest, signal: AbortSignal): Promise<CompleteTextResult> {
      try {
        const response = await withTransientRetry(
          () =>
            client.models.generateContent({
              model,
              contents: request.user,
              config: {
                systemInstruction: request.system,
                maxOutputTokens: request.maxTokens + THINKING_HEADROOM_TOKENS,
                abortSignal: signal,
              },
            }),
          signal,
        );
        const text = response.text;
        const finishReason = response.candidates?.[0]?.finishReason;
        if (!text) {
          logRawResponse("gemini", "respuesta vacía", response, finishReason);
          const blocked = response.promptFeedback?.blockReason;
          throw new AiError("bad_response", "Gemini no devolvió texto.", blocked ? `blockReason=${blocked}` : `finishReason=${finishReason ?? "?"}`);
        }
        const meta = response.usageMetadata;
        const prompt = meta?.promptTokenCount;
        const completion = meta?.candidatesTokenCount;
        return {
          text,
          usage:
            typeof prompt === "number" && typeof completion === "number"
              ? { promptTokens: prompt, completionTokens: completion, totalTokens: meta?.totalTokenCount ?? prompt + completion }
              : undefined,
        };
      } catch (error) {
        throw mapProviderError(error, "gemini", model);
      }
    },
  };
}


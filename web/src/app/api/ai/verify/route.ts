import { createProvider, readSelection } from "@/lib/ai";
import { isUsableKey } from "@/lib/ai/catalog";
import { aiErrorResponse, runWithDeadline, unconfiguredResponse } from "@/lib/ai/route";
import { AiError } from "@/lib/ai/types";

export const runtime = "nodejs";

const VERIFY_TIMEOUT_MS = 20_000;

/**
 * Prueba la selección del navegador con una llamada mínima (≈ 20 tokens): así una clave inválida,
 * un modelo retirado o un Ollama apagado se detectan en Ajustes y no a mitad de la primera lección.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Sin cuerpo: se prueba el `.env`.
  }
  const ai = typeof body === "object" && body !== null && "ai" in body ? body.ai : null;
  const selection = readSelection(ai);
  const provider = createProvider(selection);
  if (!provider) return unconfiguredResponse();
  // De dónde sale la clave con la que se prueba: el navegador, el `.env` del servidor o ninguna (Ollama).
  const keySource = provider.id === "ollama" ? "local" : isUsableKey(selection?.apiKey) ? "browser" : "server";
  const startedAt = Date.now();

  try {
    await runWithDeadline(request, provider, VERIFY_TIMEOUT_MS, (signal) =>
      // Texto libre y no JSON: el modo JSON estricto falla en algunos modelos (p. ej. 400 en Groq) aunque la clave sea válida.
      provider.completeText(
        { system: "Health check. Reply with the single word: ok", user: "ping", maxTokens: 64 },
        signal,
      ),
    );
    return Response.json({ ok: true, provider: provider.id, model: provider.model, latencyMs: Date.now() - startedAt, keySource });
  } catch (error) {
    // Respuesta vacía (p. ej. un modelo de razonamiento que gasta los 64 tokens pensando):
    // la clave y el modelo funcionan, que es lo que se prueba aquí.
    if (error instanceof AiError && error.code === "bad_response") {
      return Response.json({ ok: true, provider: provider.id, model: provider.model, latencyMs: Date.now() - startedAt, keySource });
    }
    return aiErrorResponse(error, "El proveedor respondió, pero no con lo esperado.", "api/ai/verify");
  }
}

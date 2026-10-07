import { providerLabel } from "./catalog";
import { statusForCode } from "./errors";
import { AiError, type AiProvider } from "./types";

/**
 * Ejecuta `run` con un plazo máximo y enlazado a la cancelación del cliente. Si vence el plazo,
 * el error es `timeout` (no `aborted`): el usuario debe saber que el proveedor tardó, no que canceló.
 */
export async function runWithDeadline<T>(
  request: Request,
  provider: AiProvider,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new AiError(
        "timeout",
        `${providerLabel(provider.id)} tardó más de ${Math.round(timeoutMs / 1000)} s en responder. Reintenta o elige un modelo más rápido en Ajustes.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
}

/** Respuesta JSON uniforme para cualquier fallo de IA: `{ error, code, detail?, provider_error? }`. */
export function aiErrorResponse(error: unknown, fallbackHint: string, tag: string): Response {
  const ai = error instanceof AiError ? error : new AiError("bad_response", fallbackHint);
  if (!(error instanceof AiError)) console.error(`[${tag}] error inesperado`, error);
  return Response.json(
    { error: ai.hint, code: ai.code, detail: ai.detail, provider_error: ai.providerError },
    { status: statusForCode(ai.code) },
  );
}

export const UNCONFIGURED_HINT =
  "Elige un proveedor y guarda su clave en Ajustes, o configura una clave en web/.env.local.";

export function unconfiguredResponse(): Response {
  return Response.json({ error: UNCONFIGURED_HINT, code: "unconfigured" }, { status: 503 });
}

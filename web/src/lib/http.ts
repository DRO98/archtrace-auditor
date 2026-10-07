export interface JsonResponse {
  ok: boolean;
  status: number;
  /** null si el cuerpo no era JSON (página de error HTML, 504 de un proxy, cuerpo vacío…). */
  body: unknown;
}

/** POST JSON que nunca lanza por un cuerpo no-JSON; solo por red o cancelación. */
export async function postJson(url: string, payload: unknown, signal?: AbortSignal): Promise<JsonResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export interface ApiError {
  message: string;
  code: string | null;
}

/** Mensaje legible de `{ error, code, detail?, provider_error? }`, o uno por estado HTTP si el cuerpo no sirve. */
export function readApiError(response: JsonResponse, fallback: string): ApiError {
  const body = response.body;
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    const code = "code" in body && typeof body.code === "string" ? body.code : null;
    const detail = "detail" in body && typeof body.detail === "string" ? body.detail : readProviderError(body);
    return { message: detail ? `${body.error} (${detail})` : body.error, code };
  }
  if (response.status === 504) return { message: "El servidor tardó demasiado en responder. Reintenta.", code: "timeout" };
  if (response.status >= 500) return { message: `El servidor falló (HTTP ${response.status}). Reintenta en unos segundos.`, code: null };
  return { message: fallback, code: null };
}

/** Error de `fetch` (sin conexión con el servidor de la app) en lenguaje llano. */
export function networkErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "No se pudo contactar con el servidor de la app. ¿Sigue arrancado `npm run dev`?";
  return error instanceof Error && error.message ? error.message : fallback;
}

function readProviderError(body: object): string | null {
  if (!("provider_error" in body) || typeof body.provider_error !== "object" || body.provider_error === null) return null;
  const info = body.provider_error;
  const message = "message" in info && typeof info.message === "string" ? info.message : "";
  const status = "status" in info && typeof info.status === "number" ? `HTTP ${info.status}` : "";
  return [status, message].filter(Boolean).join(": ") || null;
}

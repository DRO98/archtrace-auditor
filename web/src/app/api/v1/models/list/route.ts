import { AI_PROVIDERS, isProviderId, isUsableKey } from "@/lib/ai/catalog";
import { envKeyFor, resolveLocalBaseUrl } from "@/lib/ai/env";
import { listProviderModels } from "@/lib/ai/modelDiscovery";
import { aiErrorResponse, UNCONFIGURED_HINT } from "@/lib/ai/route";
import { AiError } from "@/lib/ai/types";

export const runtime = "nodejs";

const LIST_TIMEOUT_MS = 12_000;

/**
 * Proxy de descubrimiento: POST `{ provider, apiKey?, baseUrl? }` → `{ ok, provider, keySource, models, fetchedAt }`.
 * La clave viaja en el cuerpo (nunca en la URL), se usa para esta petición y no se guarda. Sin clave del
 * navegador se prueba la del `.env`. Listar modelos es gratis y a la vez verifica la clave (401 → `auth`).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) return Response.json({ error: "Falta el proveedor." }, { status: 400 });
  const record = body as Record<string, unknown>;
  if (!isProviderId(record.provider)) return Response.json({ error: "Proveedor desconocido." }, { status: 400 });
  const provider = record.provider;
  const browserKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : null;

  let apiKey: string | null;
  let keySource: "browser" | "server" | "local";
  let baseUrl: string | null = null;
  if (!AI_PROVIDERS[provider].needsKey) {
    baseUrl = resolveLocalBaseUrl(typeof record.baseUrl === "string" ? record.baseUrl.slice(0, 300) : null);
    if (!baseUrl) {
      return Response.json(
        { error: "La URL del servidor local no es válida: solo se aceptan hosts locales o de red privada.", code: "unconfigured" },
        { status: 400 },
      );
    }
    apiKey = browserKey;
    keySource = "local";
  } else if (isUsableKey(browserKey)) {
    apiKey = browserKey;
    keySource = "browser";
  } else {
    apiKey = envKeyFor(provider);
    keySource = "server";
    if (!apiKey) return Response.json({ error: UNCONFIGURED_HINT, code: "unconfigured" }, { status: 503 });
  }

  const deadline = AbortSignal.timeout(LIST_TIMEOUT_MS);
  try {
    const signal = AbortSignal.any([request.signal, deadline]);
    const models = await listProviderModels({ provider, apiKey, baseUrl }, signal);
    return Response.json(
      { ok: true, provider, keySource, models, fetchedAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (deadline.aborted && !request.signal.aborted) {
      const seconds = Math.round(LIST_TIMEOUT_MS / 1000);
      error = new AiError("timeout", `${AI_PROVIDERS[provider].label} no respondió en ${seconds} s al pedir su lista de modelos.`);
    }
    return aiErrorResponse(error, "El proveedor no devolvió su lista de modelos.", "api/v1/models/list");
  }
}

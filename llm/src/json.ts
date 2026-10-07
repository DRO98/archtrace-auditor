import { AiError, type AiProviderId } from "./types";

const RAW_LOG_LIMIT = 4000;

/** Strips markdown fences / prose around a JSON object and parses it. Returns null when nothing parseable remains. */
export function parseLooseJson(text: string): unknown {
  const clean = text.replace(/```(?:json)?\s*|\s*```/gi, "").trim();
  try {
    return JSON.parse(clean) as unknown;
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

/**
 * Recupera un objeto JSON cortado por el límite de tokens: cierra la cadena y los corchetes abiertos
 * y, si aun así no parsea, recorta hasta el último separador y lo vuelve a intentar.
 * `{"answer": "Hola mund` → `{"answer": "Hola mund"}`. Devuelve null si no queda un objeto.
 */
export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let body = text.slice(start).replace(/\s*```\s*$/, "");
  for (let attempt = 0; attempt < 8 && body.length > 0; attempt += 1) {
    const parsed = tryParse(closeOpenJson(body));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    const cuts = [body.lastIndexOf(","), body.lastIndexOf("{") + 1, body.lastIndexOf("[") + 1].filter(
      (index) => index > 0 && index < body.length,
    );
    if (cuts.length === 0) return null;
    body = body.slice(0, Math.max(...cuts));
  }
  return null;
}

function closeOpenJson(body: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") closers.push("}");
    else if (char === "[") closers.push("]");
    else if (char === "}" || char === "]") closers.pop();
  }
  let out = body;
  if (inString) out = `${escaped ? out.slice(0, -1) : out}"`;
  out = out.replace(/[\s,:]+$/, "");
  return out + closers.reverse().join("");
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Parses provider text as JSON or throws a bad_response AiError after logging the raw payload server-side. */
export function parseProviderJson(text: string, provider: AiProviderId, finishReason?: string): unknown {
  const value = parseLooseJson(text);
  if (value !== null) return value;
  const truncated = finishReason === "MAX_TOKENS" || finishReason === "length";
  if (truncated) {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      logRawResponse(provider, "JSON truncado reparado", text, finishReason);
      return repaired;
    }
  }
  logRawResponse(provider, "JSON inválido", text, finishReason);
  throw new AiError(
    "bad_response",
    truncated ? "La respuesta de la IA se cortó antes de terminar." : "La IA no devolvió JSON válido.",
    finishReason ? `finishReason=${finishReason}` : undefined,
  );
}

export function logRawResponse(source: string, reason: string, raw: unknown, finishReason?: string): void {
  const text = typeof raw === "string" ? raw : safeStringify(raw);
  const clipped = text.length > RAW_LOG_LIMIT ? `${text.slice(0, RAW_LOG_LIMIT)}… [${text.length} chars]` : text;
  console.error(`[ai:${source}] ${reason}${finishReason ? ` (finishReason=${finishReason})` : ""}\n--- raw ---\n${clipped}\n-----------`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

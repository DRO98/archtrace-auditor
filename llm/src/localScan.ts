import { OLLAMA_DEFAULT_URL } from "./catalog";

/** Un modelo instalado en el servidor local, con lo que informa `GET /api/tags` de Ollama. */
export interface LocalModelInfo {
  id: string;
  sizeBytes: number | null;
  /** "8.0B" */
  parameterSize: string | null;
  /** "Q4_K_M" */
  quantization: string | null;
  family: string | null;
  modifiedAt: string | null;
}

const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[\w-]+\.local)$/i;

/**
 * `http://localhost:11434/v1` → `http://localhost:11434/api/tags`. La API nativa de Ollama cuelga de la raíz,
 * no de `/v1` (la ruta OpenAI-compatible). Solo hosts locales o de red privada: nunca se escanea internet.
 */
export function ollamaTagsUrl(baseUrl: string | null | undefined): string | null {
  const raw = baseUrl?.trim() || OLLAMA_DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !LOCAL_HOSTS.test(url.hostname)) return null;
  const root = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${url.origin}${root}/api/tags`;
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const optStr = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Cuerpo de `/api/tags` → modelos ordenados por nombre. Entradas sin nombre se descartan. */
export function parseOllamaTags(body: unknown): LocalModelInfo[] {
  if (!isRec(body) || !Array.isArray(body.models)) return [];
  const models = body.models.filter(isRec).flatMap((item): LocalModelInfo[] => {
    const id = optStr(item.name) ?? optStr(item.model);
    if (!id) return [];
    const details = isRec(item.details) ? item.details : {};
    return [
      {
        id,
        sizeBytes: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : null,
        parameterSize: optStr(details.parameter_size),
        quantization: optStr(details.quantization_level),
        family: optStr(details.family),
        modifiedAt: optStr(item.modified_at),
      },
    ];
  });
  return [...new Map(models.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Descripción corta para la tabla: "8.0B · Q4_K_M · 4.7 GB". */
export function describeLocalModel(model: LocalModelInfo): string {
  return [model.parameterSize, model.quantization, model.sizeBytes !== null ? formatBytes(model.sizeBytes) : null].filter(Boolean).join(" · ");
}

const SCAN_TIMEOUT_MS = 4_000;

/**
 * Escanea desde el navegador (BYOK: la petición sale del cliente, como el resto de llamadas de IA) los
 * modelos instalados. Ollama acepta por defecto orígenes `localhost`/`127.0.0.1`; si otro origen está
 * bloqueado por CORS o el servidor es vLLM (sin `/api/tags`), lanza y el llamador recurre al listado
 * OpenAI-compatible.
 */
export async function scanOllamaModels(baseUrl: string | null | undefined, signal?: AbortSignal): Promise<LocalModelInfo[]> {
  const url = ollamaTagsUrl(baseUrl);
  if (!url) throw new Error("La URL del servidor local no es válida (solo hosts locales o de red privada).");
  const timeout = AbortSignal.timeout(SCAN_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`${url} respondió HTTP ${response.status}.`);
  return parseOllamaTags((await response.json()) as unknown);
}

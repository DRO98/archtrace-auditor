import { resolveLocalBaseUrl } from "@llm/env";
import { sha256 } from "../paths";

/**
 * Infraestructura del RAG vectorial: embeddings con Ollama (`/api/embed`, local) y almacén Qdrant por REST
 * (`fetch`, sin SDK). Ambos son servicios locales: ningún fragmento de código sale de la máquina.
 */

export interface Embedder {
  readonly model: string;
  embed(texts: readonly string[], kind: "document" | "query"): Promise<number[][]>;
}

export interface VectorConfig {
  /** `auto` (por defecto): se usa si Qdrant y Ollama responden; `off`: solo BM25; `on`: avisa si no están. */
  mode: "auto" | "on" | "off";
  qdrantUrl: string;
  ollamaUrl: string;
  embedModel: string;
}

export function vectorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VectorConfig {
  const raw = env.ARCHTRACE_VECTOR?.trim().toLowerCase();
  const mode = raw === "on" || raw === "off" ? raw : "auto";
  // `OLLAMA_BASE_URL` es la URL OpenAI-compatible (`…/v1`); la API nativa de embeddings cuelga de la raíz.
  const ollama = (resolveLocalBaseUrl(env.ARCHTRACE_OLLAMA_URL ?? null) ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
  return {
    mode,
    qdrantUrl: (env.ARCHTRACE_QDRANT_URL?.trim() || "http://localhost:6333").replace(/\/+$/, ""),
    ollamaUrl: ollama,
    embedModel: env.ARCHTRACE_EMBED_MODEL?.trim() || "nomic-embed-text",
  };
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number, method = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → HTTP ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** nomic-embed-text necesita prefijos de tarea; otros modelos los toleran. */
const PREFIX = { document: "search_document: ", query: "search_query: " } as const;
const MAX_CHARS = 6000;
const BATCH = 32;

export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async embed(texts: readonly string[], kind: "document" | "query"): Promise<number[][]> {
    const out: number[][] = [];
    for (let index = 0; index < texts.length; index += BATCH) {
      const input = texts.slice(index, index + BATCH).map((text) => `${PREFIX[kind]}${text}`.slice(0, MAX_CHARS));
      const result = await postJson<{ embeddings?: number[][] }>(`${this.baseUrl}/api/embed`, { model: this.model, input }, this.timeoutMs);
      if (!Array.isArray(result.embeddings) || result.embeddings.length !== input.length) {
        throw new Error(`Ollama no devolvió embeddings para ${this.model} (¿falta \`ollama pull ${this.model}\`?).`);
      }
      out.push(...result.embeddings);
    }
    return out;
  }
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface VectorHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/** Id de punto de Qdrant (UUID) estable a partir de una clave de contenido. */
export function pointId(key: string): string {
  const hex = sha256(key);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Cliente REST mínimo de Qdrant. */
export class QdrantStore {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/collections`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureCollection(name: string, size: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/collections/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (response.ok) {
      const info = (await response.json()) as { result?: { config?: { params?: { vectors?: { size?: number } } } } };
      const existing = info.result?.config?.params?.vectors?.size;
      if (existing === undefined || existing === size) return;
      // Otro tamaño de vector (otro modelo con el mismo nombre de colección): se recrea.
      await fetch(`${this.baseUrl}/collections/${encodeURIComponent(name)}`, { method: "DELETE", signal: AbortSignal.timeout(this.timeoutMs) });
    } else {
      await response.body?.cancel();
    }
    await postJson(`${this.baseUrl}/collections/${encodeURIComponent(name)}`, { vectors: { size, distance: "Cosine" } }, this.timeoutMs, "PUT");
  }

  async exists(name: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/collections/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    await response.body?.cancel();
    return response.ok;
  }

  /** Ids presentes de entre los pedidos. */
  async existing(name: string, ids: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let index = 0; index < ids.length; index += 256) {
      const result = await postJson<{ result?: Array<{ id: string }> }>(
        `${this.baseUrl}/collections/${encodeURIComponent(name)}/points`,
        { ids: ids.slice(index, index + 256), with_payload: false, with_vector: false },
        this.timeoutMs,
      );
      for (const point of result.result ?? []) found.add(String(point.id));
    }
    return found;
  }

  async upsert(name: string, points: readonly VectorPoint[]): Promise<void> {
    for (let index = 0; index < points.length; index += 128) {
      await postJson(`${this.baseUrl}/collections/${encodeURIComponent(name)}/points?wait=true`, { points: points.slice(index, index + 128) }, this.timeoutMs, "PUT");
    }
  }

  /** Todos los ids de la colección (para borrar lo que ya no existe en el repo). */
  async allIds(name: string): Promise<string[]> {
    const ids: string[] = [];
    let offset: unknown = null;
    do {
      const result = await postJson<{ result?: { points?: Array<{ id: string }>; next_page_offset?: unknown } }>(
        `${this.baseUrl}/collections/${encodeURIComponent(name)}/points/scroll`,
        { limit: 1000, with_payload: false, with_vector: false, ...(offset !== null ? { offset } : {}) },
        this.timeoutMs,
      );
      for (const point of result.result?.points ?? []) ids.push(String(point.id));
      offset = result.result?.next_page_offset ?? null;
    } while (offset !== null && offset !== undefined);
    return ids;
  }

  async remove(name: string, ids: readonly string[]): Promise<void> {
    for (let index = 0; index < ids.length; index += 512) {
      await postJson(`${this.baseUrl}/collections/${encodeURIComponent(name)}/points/delete?wait=true`, { points: ids.slice(index, index + 512) }, this.timeoutMs);
    }
  }

  /** API de consulta universal (`/points/query`, Qdrant ≥ 1.10; `/points/search` está obsoleta). */
  async search(name: string, vector: readonly number[], limit: number, filter?: Record<string, unknown>): Promise<VectorHit[]> {
    const result = await postJson<{ result?: { points?: Array<{ id: string; score: number; payload?: Record<string, unknown> }> } }>(
      `${this.baseUrl}/collections/${encodeURIComponent(name)}/points/query`,
      { query: vector, limit, with_payload: true, ...(filter ? { filter } : {}) },
      this.timeoutMs,
    );
    return (result.result?.points ?? []).map((hit) => ({ id: String(hit.id), score: hit.score, payload: hit.payload ?? {} }));
  }
}

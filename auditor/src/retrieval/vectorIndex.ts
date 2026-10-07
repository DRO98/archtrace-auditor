import type { DocSection } from "../docs/sections";
import type { RepoIndex } from "../index/repoIndex";
import { repoKey, sha256 } from "../paths";
import { Bm25Retriever, type Retriever } from "./bm25";
import { OllamaEmbedder, pointId, QdrantStore, vectorConfigFromEnv, type Embedder, type VectorConfig, type VectorPoint } from "./vector";

/** Símbolos del repo parecidos a la unidad (contexto "componentes relacionados"). */
export type RelatedSymbols = (query: string, excludeFile: string, limit: number) => Promise<string[]>;

export interface RetrievalSetup {
  retriever: Retriever;
  related: RelatedSymbols | null;
  mode: "bm25" | "hybrid";
  embedded: number;
  reused: number;
}

export interface VectorIndexOptions {
  repoRoot: string;
  sections: readonly DocSection[];
  index: RepoIndex;
  warnings: string[];
  config?: VectorConfig;
  /** Inyectables en tests. */
  embedder?: Embedder;
  store?: QdrantStore;
  maxSymbols?: number;
}

const RRF_K = 60;
const MAX_SYMBOLS = 4000;

function collectionName(repoRoot: string, model: string, kind: "docs" | "symbols"): string {
  return `archtrace_${repoKey(repoRoot)}_${model.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}_${kind}`;
}

/**
 * Prepara la recuperación de reglas: BM25 siempre; si Qdrant y Ollama responden, además un índice vectorial
 * por sección de documentación y por símbolo (nunca por línea), sincronizado de forma incremental (el id del
 * punto es el hash del contenido: solo se embebe lo nuevo y se borra lo que ya no existe).
 */
export async function setupRetrieval(options: VectorIndexOptions): Promise<RetrievalSetup> {
  const bm25 = new Bm25Retriever(options.sections);
  const fallback: RetrievalSetup = { retriever: bm25, related: null, mode: "bm25", embedded: 0, reused: 0 };
  const config = options.config ?? vectorConfigFromEnv();
  if (config.mode === "off") return fallback;

  const store = options.store ?? new QdrantStore(config.qdrantUrl);
  if (!(await store.healthy())) {
    if (config.mode === "on") options.warnings.push(`RAG vectorial: Qdrant no responde en ${config.qdrantUrl}; se usa búsqueda léxica (BM25).`);
    return fallback;
  }
  const embedder = options.embedder ?? new OllamaEmbedder(config.ollamaUrl, config.embedModel);
  let dimension: number;
  try {
    dimension = (await embedder.embed(["probe"], "query"))[0]!.length;
  } catch (error) {
    // Qdrant está arrancado: el usuario quiere RAG vectorial, así que se avisa aunque el modo sea `auto`.
    options.warnings.push(`RAG vectorial: embeddings no disponibles (${error instanceof Error ? error.message.slice(0, 160) : String(error)}); se usa BM25.`);
    return fallback;
  }

  const docsCollection = collectionName(options.repoRoot, embedder.model, "docs");
  const symbolsCollection = collectionName(options.repoRoot, embedder.model, "symbols");
  let embedded = 0;
  let reused = 0;
  try {
    const docPoints = options.sections
      .filter((section) => section.text.trim().length > 0)
      .map((section) => ({
        key: `${section.id}\0${sha256(section.text)}`,
        text: `${section.headingPath.join(" › ")}\n${section.text}`,
        payload: { sectionId: section.id, file: section.file, hasRules: section.rules.length > 0 },
      }));
    const symbolPoints: Array<{ key: string; text: string; payload: Record<string, unknown> }> = [];
    for (const file of options.index.treeFiles()) {
      const entry = options.index.treeEntry(file);
      for (const symbol of entry?.symbols ?? []) {
        if (symbolPoints.length >= (options.maxSymbols ?? MAX_SYMBOLS)) break;
        const text = `${file} · ${symbol.kind} ${symbol.qualifiedName}: ${symbol.signature}${symbol.doc ? ` — ${symbol.doc}` : ""}`;
        symbolPoints.push({
          key: `${file}\0${symbol.qualifiedName}\0${sha256(text)}`,
          text,
          payload: { file, qualifiedName: symbol.qualifiedName, kind: symbol.kind, signature: symbol.signature, startLine: symbol.range.startLine },
        });
      }
    }
    for (const [collection, items] of [
      [docsCollection, docPoints],
      [symbolsCollection, symbolPoints],
    ] as const) {
      const sync = await syncCollection(store, embedder, collection, dimension, items);
      embedded += sync.embedded;
      reused += sync.reused;
    }
  } catch (error) {
    options.warnings.push(`RAG vectorial: no se pudo sincronizar el índice (${error instanceof Error ? error.message.slice(0, 160) : String(error)}); se usa BM25.`);
    return fallback;
  }

  const sectionsById = new Map(options.sections.map((section) => [section.id, section]));
  let degraded = false;
  const degrade = (error: unknown) => {
    if (degraded) return;
    degraded = true;
    options.warnings.push(`RAG vectorial: búsqueda fallida (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); el resto con BM25.`);
  };

  const retriever: Retriever = {
    async search(query, limit) {
      const lexical = await bm25.search(query, limit * 2);
      if (degraded) return lexical.slice(0, limit);
      try {
        const [vector] = await embedder.embed([query], "query");
        const hits = await store.search(docsCollection, vector!, limit * 2);
        const semantic = hits
          .map((hit) => sectionsById.get(String(hit.payload.sectionId)))
          .filter((section): section is DocSection => section !== undefined);
        return fuse([lexical.map((hit) => hit.section), semantic], limit);
      } catch (error) {
        degrade(error);
        return lexical.slice(0, limit);
      }
    },
  };

  const related: RelatedSymbols = async (query, excludeFile, limit) => {
    if (degraded) return [];
    try {
      const [vector] = await embedder.embed([query], "query");
      const hits = await store.search(symbolsCollection, vector!, limit, { must_not: [{ key: "file", match: { value: excludeFile } }] });
      return hits.map((hit) => `- ${String(hit.payload.file)}::${String(hit.payload.qualifiedName)} (L${String(hit.payload.startLine)}): ${String(hit.payload.signature)}`);
    } catch (error) {
      degrade(error);
      return [];
    }
  };

  return { retriever, related, mode: "hybrid", embedded, reused };
}

async function syncCollection(
  store: QdrantStore,
  embedder: Embedder,
  collection: string,
  dimension: number,
  items: ReadonlyArray<{ key: string; text: string; payload: Record<string, unknown> }>,
): Promise<{ embedded: number; reused: number }> {
  await store.ensureCollection(collection, dimension);
  const byId = new Map(items.map((item) => [pointId(item.key), item]));
  const present = await store.existing(collection, [...byId.keys()]);
  const missing = [...byId.entries()].filter(([id]) => !present.has(id));
  if (missing.length > 0) {
    const vectors = await embedder.embed(
      missing.map(([, item]) => item.text),
      "document",
    );
    const points: VectorPoint[] = missing.map(([id, item], index) => ({ id, vector: vectors[index]!, payload: item.payload }));
    await store.upsert(collection, points);
  }
  const stale = (await store.allIds(collection)).filter((id) => !byId.has(id));
  if (stale.length > 0) await store.remove(collection, stale);
  return { embedded: missing.length, reused: byId.size - missing.length };
}

/** Reciprocal Rank Fusion: combina rankings sin calibrar puntuaciones (BM25 y coseno no son comparables). */
export function fuse(rankings: ReadonlyArray<readonly DocSection[]>, limit: number): Array<{ section: DocSection; score: number }> {
  const scores = new Map<string, { section: DocSection; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((section, rank) => {
      const entry = scores.get(section.id) ?? { section, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      scores.set(section.id, entry);
    });
  }
  return [...scores.values()].sort((left, right) => right.score - left.score || left.section.id.localeCompare(right.section.id)).slice(0, limit);
}

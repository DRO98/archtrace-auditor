/**
 * Port de `sandbox/src/rag/pipeline.py`. Los pasos van por separado (`chunk`, `embed`, `index`)
 * para que la traza del playground mida cada etapa; `ingest` los encadena como el original.
 */
import type { RetrievedChunk } from "@core/playground";
import { chunkText } from "./chunker";
import { Embedder } from "./embedder";
import { VectorStore } from "./vectorStore";

export const DEFAULT_TOP_K = 4;

export class RagPipeline {
  readonly store: VectorStore;
  readonly embedder: Embedder;

  constructor(embedder = new Embedder(), store = new VectorStore(embedder.dimensions)) {
    this.embedder = embedder;
    this.store = store;
  }

  chunk(text: string): string[] {
    return chunkText(text);
  }

  embed(chunks: readonly string[]): number[][] {
    return this.embedder.embedMany(chunks);
  }

  index(documentId: string, chunks: readonly string[], vectors: readonly number[][]): number {
    return this.store.addMany(
      chunks.map((text, position) => ({
        recordId: `${documentId}:${position}`,
        text,
        values: vectors[position] ?? [],
        source: documentId,
      })),
    );
  }

  /** Trocea, embebe e indexa un documento. Devuelve cuántos registros escribió. */
  ingest(documentId: string, text: string): number {
    const chunks = this.chunk(text);
    return this.index(documentId, chunks, this.embed(chunks));
  }

  /** Los fragmentos más cercanos a la pregunta, con su similitud coseno. */
  retrieve(question: string, limit = DEFAULT_TOP_K): RetrievedChunk[] {
    const query = this.embedder.embed(question);
    return this.store.search(query, limit).map(({ record, score }) => ({ id: record.recordId, text: record.text, score }));
  }
}

export const ANSWER_SYSTEM_PROMPT = [
  "Eres el LLM de un pipeline RAG didáctico.",
  "Responde a la pregunta usando SOLO el contexto recuperado. Si el contexto no basta, dilo claramente.",
  "Responde en el idioma de la pregunta, de forma breve, y cita los fragmentos como [1], [2]…",
].join(" ");

/** Mismo formato que el original (`Question: …\nContext:\n…`), con los fragmentos numerados. */
export function buildAnswerPrompt(question: string, chunks: readonly RetrievedChunk[]): string {
  const context = chunks.length > 0 ? chunks.map((chunk, index) => `[${index + 1}] ${chunk.text}`).join("\n") : "(sin contexto)";
  return `Question: ${question}\nContext:\n${context}`;
}

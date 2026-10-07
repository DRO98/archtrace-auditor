import type { TraceBaseEvent, TraceModuleRef } from "./trace.js";

/**
 * Perfil RAG del tracing (`@core/trace`): una consulta RAG real (didáctica) cuyo progreso llega al lienzo por SSE.
 * Solo tipos: se importan con `import type` desde `@core/playground`.
 *
 * Convenciones:
 * - `nodeId` es el id de un módulo del CodeGraph (su `filePath`), o `null` si el grafo no tiene
 *   un módulo que encaje con la etapa: la interfaz no debe romperse por ello.
 * - Una etapa puede repetirse (el vector store indexa y luego busca): las latencias se suman.
 * - `latencyMs` es el tiempo real de la etapa, sin la pausa visual que añade el servidor.
 */
export type RagStageId = "api" | "chunker" | "embedder" | "vector_store" | "llm";
/** @deprecated Usa `RagStageId` (perfil RAG) o `TraceStageId` (genérico). */
export type PlaygroundStageId = RagStageId;

export interface RetrievedChunk {
  id: string;
  text: string;
  /** Similitud coseno en [0, 1]. */
  score: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** true si el proveedor no informó del uso y se estimó (≈ 4 caracteres por token). */
  estimated?: boolean;
}

/** Lo mínimo del grafo que el servidor necesita para asignar cada etapa a un nodo. */
export type PlaygroundModuleRef = TraceModuleRef;

/** Coste de una etapa de la consulta con la tarifa aplicada (USD por millón de tokens). */
export interface PlaygroundCostLine {
  stage: "embedder" | "llm";
  /** Proveedor y modelo que hicieron el trabajo ("local" si corre en el servidor de la app). */
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** true si los tokens se estimaron (≈ 4 caracteres por token). */
  estimated: boolean;
  price: { input: number; output: number } | null;
  /** catalog = tarifa conocida · custom = escrita por el usuario · local = 0 $ · unknown = sin tarifa. */
  priceSource: "catalog" | "custom" | "local" | "unknown";
  /** null = sin tarifa para ese modelo. */
  costUsd: number | null;
}

/** Resultado de una consulta RAG. */
export interface RagResultEvent {
  type: "result";
  profile?: "rag";
  answer: string;
  chunks: RetrievedChunk[];
  usage: TokenUsage;
  /** null = sin tarifa conocida para ese modelo. Ollama (local) cuesta 0. Suma de `costBreakdown`. */
  costUsd: number | null;
  provider: string;
  model: string;
  /** Coste paso a paso (embedder + LLM). Ausente en trazas antiguas o demos. */
  costBreakdown?: PlaygroundCostLine[];
}

/** Eventos del perfil RAG: los comunes (`TraceBaseEvent`) + el streaming del LLM y el resultado RAG. */
export type PlaygroundSseEvent = TraceBaseEvent<RagStageId> | { type: "llm_delta"; text: string } | RagResultEvent;

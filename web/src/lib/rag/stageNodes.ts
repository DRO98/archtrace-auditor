import type { PlaygroundModuleRef, RagStageId } from "@core/playground";
import { RAG_STAGES } from "../trace/profiles";
import { resolveStageNodeFor, resolveStageNodesFor } from "../trace/stageNodes";

/** Palabras que delatan el módulo de cada etapa RAG, por prioridad (ver `RAG_STAGES`). */
export const STAGE_TOKENS: Readonly<Record<RagStageId, readonly string[]>> = Object.fromEntries(
  RAG_STAGES.map((stage) => [stage.id, stage.tokens]),
) as Record<RagStageId, readonly string[]>;

/** Módulo del grafo que representa la etapa RAG, o null si ninguno encaja (la UI lo tolera). */
export function resolveStageNode(stage: RagStageId, modules: readonly PlaygroundModuleRef[]): string | null {
  const def = RAG_STAGES.find((item) => item.id === stage);
  return def ? resolveStageNodeFor(def, modules) : null;
}

export function resolveStageNodes(modules: readonly PlaygroundModuleRef[]): Record<RagStageId, string | null> {
  return resolveStageNodesFor(RAG_STAGES, modules);
}

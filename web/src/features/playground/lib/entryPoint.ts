import type { PlaygroundModuleRef, RagStageId } from "@core/playground";
import type { TraceProfileId, TraceStageId } from "@core/trace";
import type { DemoPlayground } from "../../demos/types";
import { resolveStageNodes } from "../../../lib/rag/stageNodes";
import { RAG_STAGES } from "../../../lib/trace/profiles";

/** Nodo del lienzo desde el que se lanza "Probar / Simular". `null` en el store = sistema completo. */
export interface EntryPoint {
  nodeId: string;
  label: string;
  /**
   * Etapa que representa el nodo, o null si es un módulo que la traza no recorre. En RAG es una etapa
   * del pipeline; en los perfiles genéricos las etapas son los propios nodos, así que es `nodeId`.
   */
  stage: TraceStageId | null;
}

export const SYSTEM_ENTRY_LABEL = "Sistema Completo (API Routes)";

/** Rótulo del punto de entrada por defecto de cada perfil. */
export function systemEntryLabel(profile: TraceProfileId = "rag"): string {
  return profile === "rag" ? SYSTEM_ENTRY_LABEL : "Entrada automática";
}

/** Variables que consume cada etapa: lo que el panel pide "inyectar" al entrar por ese nodo. */
export const ENTRY_INPUTS: Readonly<Record<RagStageId | "system" | "module", readonly string[]>> = {
  system: ["question", "documentText"],
  ...(Object.fromEntries(RAG_STAGES.map((stage) => [stage.id, stage.inputs ?? []])) as Record<RagStageId, readonly string[]>),
  module: ["question", "documentText"],
};

const GENERIC_INPUTS: Readonly<Record<Exclude<TraceProfileId, "rag">, readonly string[]>> = {
  http: ["body (JSON)"],
  event: ["evento (JSON)"],
};

export function entryInputs(entry: EntryPoint | null, profile: TraceProfileId = "rag"): readonly string[] {
  if (profile !== "rag") return GENERIC_INPUTS[profile];
  if (!entry) return ENTRY_INPUTS.system;
  return ENTRY_INPUTS[(entry.stage as RagStageId | null) ?? "module"] ?? ENTRY_INPUTS.module;
}

/**
 * Etapa que representa `nodeId`: en una demo la dicen sus etapas; con un grafo real se usa el mismo
 * mapeo por nombre que el servidor (`resolveStageNodes`), así la traza pasa de verdad por ese nodo.
 * En los perfiles genéricos cualquier nodo es una etapa.
 */
export function resolveEntry(
  nodeId: string,
  modules: readonly PlaygroundModuleRef[],
  demo: DemoPlayground | null,
  profile: TraceProfileId = "rag",
): EntryPoint {
  const label = modules.find((item) => item.id === nodeId)?.label ?? nodeId;
  if (profile !== "rag") return { nodeId, label, stage: nodeId };
  if (demo) return { nodeId, label, stage: demo.stages.find((item) => item.nodeId === nodeId)?.stage ?? null };
  const nodes = resolveStageNodes(modules);
  const stage = (Object.keys(nodes) as RagStageId[]).find((id) => nodes[id] === nodeId) ?? null;
  return { nodeId, label, stage };
}

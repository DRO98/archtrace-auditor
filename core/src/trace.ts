/**
 * Tracing agnóstico del stack: el contrato común de cualquier "Probar / Simular" que pinta un
 * recorrido en el lienzo (una consulta RAG, una petición HTTP, un evento Kafka…).
 * Solo tipos: se importan con `import type` desde `@core/trace`.
 *
 * Convenciones:
 * - Un *profile* (`TraceProfileId`) fija el vocabulario de etapas; RAG es uno más (ver `@core/playground`).
 * - `nodeId` es el id de un módulo del CodeGraph (su `filePath`), o `null` si ningún módulo encaja con
 *   la etapa: la interfaz no debe romperse por ello.
 * - Una etapa puede repetirse: las latencias por nodo se suman.
 * - `latencyMs` es el tiempo real (o simulado, si el runner lo declara) de la etapa, sin pausas visuales.
 */
import type { ModuleRole } from "./graph.js";

export type TraceProfileId = "rag" | "http" | "event";

/** Id de etapa. Cada perfil declara su catálogo (`TraceProfileDef.stages`); los runners genéricos usan ids de nodo. */
export type TraceStageId = string;

/** Lo mínimo del grafo que un runner necesita para asignar etapas a nodos. */
export interface TraceModuleRef {
  id: string;
  label: string;
  filePath: string;
  role?: ModuleRole;
}

/** Etapa del catálogo de un perfil. */
export interface TraceStageDef {
  id: TraceStageId;
  label: string;
  /** Palabras (ruta + etiqueta, en minúsculas) que delatan el módulo de la etapa, por prioridad. */
  tokens: readonly string[];
  /** Roles que también la delatan si ningún token encaja. */
  roles?: readonly ModuleRole[];
  /** Variables que consume la etapa: lo que el panel pide "inyectar" al entrar por ese nodo. */
  inputs?: readonly string[];
}

export interface TraceProfileDef {
  id: TraceProfileId;
  label: string;
  description: string;
  /** Catálogo ordenado de etapas. Vacío = el recorrido lo decide el grafo (aristas desde el punto de entrada). */
  stages: readonly TraceStageDef[];
  /** true si el perfil necesita un proveedor de IA (BYOK u Ollama). */
  needsAi: boolean;
}

/** Eventos comunes a todos los perfiles (lo que pinta el lienzo). `S` estrecha el id de etapa. */
export type TraceBaseEvent<S extends string = TraceStageId> =
  /** `label` (opcional) sustituye al nombre genérico de la etapa en la interfaz. */
  | { type: "stage_start"; stage: S; nodeId: string | null; label?: string }
  /** `error`: la etapa terminó pero falló (el recorrido sigue para ver dónde se cortó). */
  | { type: "stage_done"; stage: S; nodeId: string | null; latencyMs: number; detail?: string; error?: string }
  | { type: "edge_active"; edgeId: string }
  /** `code`: el de `AiErrorCode` (auth, quota, rate_limit…) si el fallo vino de un proveedor. */
  | { type: "error"; message: string; code?: string }
  | { type: "done" };

/** Resultado de un perfil no-RAG: resumen, salida final y agregados del recorrido. */
export interface TraceGenericResult {
  type: "result";
  profile: Exclude<TraceProfileId, "rag">;
  summary: string;
  /** Lo que devolvió el último nodo (o la respuesta real del endpoint, si se llamó). */
  output?: unknown;
  totalLatencyMs: number;
  hops: number;
  errors: number;
  /** true si las latencias son simuladas (no medidas). */
  simulated: boolean;
}

export type TraceSseEvent = TraceBaseEvent | TraceGenericResult;

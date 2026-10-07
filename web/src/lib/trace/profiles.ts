import type { RagStageId } from "@core/playground";
import type { TraceProfileDef, TraceProfileId, TraceStageDef } from "@core/trace";

/**
 * Etapas del perfil RAG. Los tokens van por prioridad: gana el primero que aparezca en algún módulo
 * (ruta + etiqueta, en minúsculas). Así "llm" gana a "service" aunque otro módulo se llame `*_service`.
 */
export const RAG_STAGES: readonly (TraceStageDef & { id: RagStageId })[] = [
  { id: "api", label: "API", tokens: ["api", "route", "bootstrap", "server", "main"], inputs: ["question", "documentText"] },
  { id: "chunker", label: "Chunker", tokens: ["chunk", "splitter", "split"], inputs: ["documentText"] },
  { id: "embedder", label: "Embedder", tokens: ["embed"], inputs: ["chunks[]", "question"] },
  { id: "vector_store", label: "Vector Store", tokens: ["vector", "index", "store"], inputs: ["vectors[]", "queryVector"] },
  { id: "llm", label: "LLM", tokens: ["llm", "service", "model"], inputs: ["question", "context[top-k]"] },
];

/**
 * Catálogo de perfiles de "Probar / Simular". RAG es uno más: los perfiles genéricos no tienen
 * etapas fijas, el recorrido sale de las aristas del grafo desde el punto de entrada.
 */
export const TRACE_PROFILES: Readonly<Record<TraceProfileId, TraceProfileDef>> = {
  rag: {
    id: "rag",
    label: "Consulta RAG",
    description: "Pregunta + documento reales contra tu proveedor de IA (BYOK u Ollama): trocea, embebe, busca y genera.",
    stages: RAG_STAGES,
    needsAi: true,
  },
  http: {
    id: "http",
    label: "Petición HTTP",
    description: "Envía un JSON al punto de entrada y sigue las llamadas por el grafo. Con URL, mide la petición real.",
    stages: [],
    needsAi: false,
  },
  event: {
    id: "event",
    label: "Evento",
    description: "Inyecta un evento JSON en un productor y sigue el flujo de datos (topics, streams, consumidores).",
    stages: [],
    needsAi: false,
  },
};

export const TRACE_PROFILE_IDS: readonly TraceProfileId[] = ["rag", "http", "event"];

export function isTraceProfileId(value: unknown): value is TraceProfileId {
  return typeof value === "string" && (TRACE_PROFILE_IDS as readonly string[]).includes(value);
}

/** Nombre a mostrar de una etapa: el del catálogo del perfil o, si no está, el id tal cual. */
export function stageLabel(profile: TraceProfileId, stage: string): string {
  return TRACE_PROFILES[profile].stages.find((item) => item.id === stage)?.label ?? stage;
}

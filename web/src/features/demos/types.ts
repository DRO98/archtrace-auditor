import type { CodeGraph } from "@core/graph";
import type { PlaygroundStageId, RetrievedChunk, TokenUsage } from "@core/playground";
import type { ScenarioFile } from "@core/simulation";
import type { TraceProfileId } from "@core/trace";

/** Una etapa de la traza simulada del playground. `nodeId` debe ser un módulo del grafo de la demo. */
export interface DemoTraceStage {
  stage: PlaygroundStageId;
  label: string;
  nodeId: string;
  /** Latencia "medida" que se muestra; la reproducción la acelera para que el recorrido dure unos segundos. */
  latencyMs: number;
  detail: string;
}

/** Lo que el playground reproduce en modo demo: sin red ni API key. */
export interface DemoPlayground {
  question: string;
  /** Rótulo del campo "Documento" en el playground ("Herramientas disponibles", "Audio de entrada"…). */
  inputLabel: string;
  documentName: string;
  documentText: string;
  /** Texto del modelo que aparece en resultados ("llama3 (simulado)"). */
  model: string;
  stages: readonly DemoTraceStage[];
  answer: string;
  chunks: readonly RetrievedChunk[];
  usage: TokenUsage;
}

/** Demo de un perfil genérico (HTTP, evento): "Probar / Simular" abre con este perfil y este payload. */
export interface DemoTraceProfile {
  profile: Exclude<TraceProfileId, "rag">;
  /** JSON de ejemplo que se precarga. */
  payload: string;
  /** Nodo de entrada por defecto (si falta, el runner lo elige por rol). */
  entryNodeId?: string;
}

export interface DemoDefinition {
  /** Nombre del grafo (`/dashboard/pipeline/<graphName>`): a-z, 0-9, `_` y `-`. */
  graphName: string;
  title: string;
  /** Una línea para el selector. */
  tagline: string;
  graph: CodeGraph;
  scenarios: ScenarioFile;
  /** Perfil RAG: consulta grabada que se reproduce sin red ni API key. Ausente en demos no-RAG. */
  playground?: DemoPlayground;
  /** Perfil genérico por defecto de la demo (p. ej. un evento Kafka en una demo de microservicios). */
  trace?: DemoTraceProfile;
}

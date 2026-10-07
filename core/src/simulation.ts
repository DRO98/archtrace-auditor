/**
 * Escenarios de simulación de flujo ("Trazabilidad de ejecución").
 * Solo tipos: se importan con `import type` desde `@core/simulation`.
 *
 * Convenciones:
 * - `stepIndex` es 0-based y debe coincidir con la posición del paso en `steps`.
 * - `nodeId` es el id de un módulo del CodeGraph (que es su `filePath`).
 * - `edgeIdToNext` es el id de una arista DIBUJADA en el lienzo: una arista
 *   principal (`imports:<origen>:<destino>`) o de apoyo (`support:<padre>:<hijo>`).
 *   Si falta, la ruta entre este paso y el siguiente se calcula sobre el grafo.
 * - `fileReference` debe coincidir EXACTAMENTE con un sub-bloque del módulo
 *   (mismo nombre y mismo rango). Los rangos son 1-based e inclusivos.
 * - `mockPayload` son datos ilustrativos, no capturados de una ejecución real.
 * - `metrics` (opcional) son métricas ilustrativas del paso; tampoco salen de una ejecución real.
 */

/**
 * Métricas de un paso, agnósticas del stack. Lo común a cualquier sistema es la latencia (y si
 * falló); lo específico de cada perfil vive en `extensions` (ver `RagMetricKey` para RAG).
 */
export interface StepMetrics {
  latencyMs: number;
  /** Mensaje de error si el paso falló: el paso sigue en el recorrido para ver dónde se cortó. */
  error?: string;
  /** Métricas numéricas del perfil (RAG: tokens y relevancia del contexto; Kafka: lag; HTTP: status…). */
  extensions?: Record<string, number>;
}

/**
 * Claves de `StepMetrics.extensions` del perfil RAG.
 * `promptTokens`/`generationTokens` son enteros ≥ 0; `contextScore` está en [0, 1].
 */
export type RagMetricKey = "promptTokens" | "generationTokens" | "contextScore";

export interface RagTokenCount {
  prompt: number;
  generation: number;
}

/**
 * @deprecated Formato antiguo (v1) de métricas, acoplado a RAG. Los parsers lo siguen aceptando y lo
 * convierten a `StepMetrics` (`tokenCount`/`contextScore` → `extensions`).
 */
export interface RagStepMetrics {
  latencyMs: number;
  tokenCount: RagTokenCount;
  /** Relevancia del contexto recuperado, de 0 a 1. */
  contextScore: number;
}

export interface FlowStep {
  stepIndex: number;
  nodeId: string;
  edgeIdToNext?: string;
  title: string;
  description: string;
  fileReference: {
    path: string;
    lineStart: number;
    lineEnd: number;
    functionName: string;
  };
  mockPayload: {
    input: Record<string, unknown> | string;
    output: Record<string, unknown> | string;
  };
  durationMs?: number; // tiempo base a velocidad 1x (por defecto 2000 ms)
  metrics?: StepMetrics;
}

export interface ExecutionFlowScenario {
  id: string;
  name: string;
  description: string;
  entryNodeId: string;
  steps: FlowStep[];
}

/** Contenido de `public/scenarios/<grafo>.json`. */
export interface ScenarioFile {
  version: 1;
  graph: string;
  scenarios: ExecutionFlowScenario[];
}

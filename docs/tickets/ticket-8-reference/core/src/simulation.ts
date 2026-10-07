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
 */
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

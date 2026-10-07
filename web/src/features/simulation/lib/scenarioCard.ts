import type { ExecutionFlowScenario } from "@core/simulation";

/** Escritura (ingesta) o lectura (consulta / inferencia) para la píldora de la tarjeta. */
export type ScenarioOperation = "ingest" | "query";

const INGEST = /ingest|guardar|escritura|upsert|almacen/i;
const QUERY = /pregunta|consulta|inferenc|answer|search|query|responder|buscar/i;

/**
 * Clasifica el escenario por su id y nombre. Si empatan, mira las funciones de los pasos.
 * La descripción se deja fuera: un flujo de guardado puede mencionar "preguntas" sin ser una consulta.
 */
export function scenarioOperation(scenario: ExecutionFlowScenario): ScenarioOperation {
  const title = `${scenario.id} ${scenario.name}`;
  const titleIngest = INGEST.test(title);
  const titleQuery = QUERY.test(title);
  if (titleIngest !== titleQuery) return titleIngest ? "ingest" : "query";

  const functions = scenario.steps.map((step) => step.fileReference.functionName).join(" ");
  const fnIngest = INGEST.test(functions);
  const fnQuery = QUERY.test(functions);
  if (fnIngest !== fnQuery) return fnIngest ? "ingest" : "query";
  if (titleIngest || fnIngest) return "ingest";
  return "query";
}

/** Etiquetas de los módulos por los que pasa el escenario, en orden de primera visita. */
export function pipelineLabels(
  scenario: ExecutionFlowScenario,
  labelOf: (nodeId: string) => string,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const step of scenario.steps) {
    if (seen.has(step.nodeId)) continue;
    seen.add(step.nodeId);
    labels.push(labelOf(step.nodeId));
  }
  return labels;
}

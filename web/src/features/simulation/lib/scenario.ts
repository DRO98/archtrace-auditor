import type { CodeGraph } from "@core/graph";
import type { ExecutionFlowScenario, FlowStep, ScenarioFile, StepMetrics } from "@core/simulation";
import type { RoutingEdge } from "./route";

export type ParseScenarioResult =
  | { ok: true; file: ScenarioFile }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 30;
const MAX_DESCRIPTION = 400;
const MAX_PAYLOAD_CHARS = 4000;
const MIN_DURATION = 300;
const MAX_DURATION = 15000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isPayload(value: unknown): value is Record<string, unknown> | string {
  if (typeof value === "string") return true;
  if (!isRecord(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_PAYLOAD_CHARS;
  } catch {
    return false;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Extensiones cuyo rango está fijado por el perfil RAG: se validan aunque lleguen en el formato nuevo. */
function validRagExtension(key: string, value: number): boolean {
  if (key === "promptTokens" || key === "generationTokens") return isCount(value);
  if (key === "contextScore") return isRatio(value);
  return true;
}

/**
 * Métricas de un paso: `null` si el objeto no cumple el contrato.
 *
 * Acepta dos formatos:
 * - Genérico: `{ latencyMs, error?, extensions?: Record<string, number> }`.
 * - Legado RAG (v1): `{ latencyMs, tokenCount: { prompt, generation }, contextScore }`, que se
 *   convierte a extensiones (`promptTokens`, `generationTokens`, `contextScore`).
 */
export function readStepMetrics(value: unknown): StepMetrics | null {
  if (!isRecord(value)) return null;
  const { latencyMs } = value;
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0) return null;

  if ("tokenCount" in value || "contextScore" in value) {
    if (!isRecord(value.tokenCount)) return null;
    const { prompt, generation } = value.tokenCount;
    if (!isCount(prompt) || !isCount(generation) || !isRatio(value.contextScore)) return null;
    return {
      latencyMs,
      extensions: { promptTokens: prompt, generationTokens: generation, contextScore: value.contextScore },
    };
  }

  const metrics: StepMetrics = { latencyMs };
  if (value.error !== undefined) {
    if (!isText(value.error)) return null;
    metrics.error = value.error;
  }
  if (value.extensions !== undefined) {
    if (!isRecord(value.extensions)) return null;
    const extensions: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value.extensions)) {
      if (typeof raw !== "number" || !Number.isFinite(raw) || !validRagExtension(key, raw)) return null;
      extensions[key] = raw;
    }
    metrics.extensions = extensions;
  }
  return metrics;
}

/**
 * Valida un archivo de escenarios contra el grafo real. Es estricto a propósito:
 * un escenario con líneas o nombres que no coinciden con el código debe fallar, no "arreglarse".
 *
 * @param edges aristas DIBUJADAS en el lienzo (las que devuelve `graphToFlow`), no `graph.edges`.
 */
export function parseScenarioFile(
  raw: unknown,
  graph: CodeGraph,
  edges: readonly RoutingEdge[],
): ParseScenarioResult {
  const errors: string[] = [];
  const fail = (message: string): void => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };

  if (!isRecord(raw)) return { ok: false, errors: ["El archivo de escenarios debe ser un objeto"] };
  if (raw.version !== 1) fail("version debe ser 1");
  if (!isText(raw.graph)) fail("graph debe ser un texto");
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    return { ok: false, errors: [...errors, "scenarios debe ser una lista con al menos un escenario"] };
  }

  const modules = new Map(graph.modules.map((item) => [item.id, item]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const scenarios: ExecutionFlowScenario[] = [];
  const seenIds = new Set<string>();

  for (const entry of raw.scenarios) {
    if (!isRecord(entry)) {
      fail("escenario inválido");
      continue;
    }
    const scenarioLabel = typeof entry.id === "string" ? entry.id : "(sin id)";
    if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/.test(entry.id)) {
      fail(`${scenarioLabel}: id debe usar solo a-z, 0-9 y guiones`);
    } else if (seenIds.has(entry.id)) {
      fail(`${scenarioLabel}: id duplicado`);
    } else {
      seenIds.add(entry.id);
    }
    if (!isText(entry.name)) fail(`${scenarioLabel}: name inválido`);
    if (!isText(entry.description)) fail(`${scenarioLabel}: description inválida`);
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) {
      fail(`${scenarioLabel}: steps debe ser una lista con al menos un paso`);
      continue;
    }

    const steps: FlowStep[] = [];
    entry.steps.forEach((stepRaw: unknown, index: number) => {
      const label = `${scenarioLabel} · paso ${index}`;
      if (!isRecord(stepRaw)) {
        fail(`${label}: paso inválido`);
        return;
      }
      if (stepRaw.stepIndex !== index) fail(`${label}: stepIndex debe ser ${index}`);
      if (!isText(stepRaw.title)) fail(`${label}: title inválido`);
      if (!isText(stepRaw.description)) fail(`${label}: description inválida`);
      else if (stepRaw.description.length > MAX_DESCRIPTION) {
        fail(`${label}: description supera ${MAX_DESCRIPTION} caracteres`);
      }

      const nodeId = stepRaw.nodeId;
      const owner = typeof nodeId === "string" ? modules.get(nodeId) : undefined;
      if (typeof nodeId !== "string" || !owner) fail(`${label}: nodeId inexistente (${String(nodeId)})`);

      const reference = stepRaw.fileReference;
      let referenceOk = false;
      if (!isRecord(reference)) {
        fail(`${label}: fileReference inválido`);
      } else if (
        typeof reference.path !== "string" ||
        !isText(reference.functionName) ||
        !isLine(reference.lineStart) ||
        !isLine(reference.lineEnd) ||
        reference.lineEnd < reference.lineStart
      ) {
        fail(`${label}: fileReference incompleto o con líneas inválidas`);
      } else if (owner) {
        const block = owner.subBlocks.find((item) => item.name === reference.functionName);
        if (reference.path !== owner.filePath) {
          fail(`${label}: fileReference.path (${reference.path}) no es el archivo del nodo (${owner.filePath})`);
        } else if (!block) {
          fail(`${label}: ${String(reference.functionName)} no existe en ${owner.filePath}`);
        } else if (
          block.range.startLine !== reference.lineStart ||
          block.range.endLine !== reference.lineEnd
        ) {
          fail(
            `${label}: rango ${reference.lineStart}-${reference.lineEnd} ≠ ${block.range.startLine}-${block.range.endLine} de ${block.name}`,
          );
        } else {
          referenceOk = true;
        }
      }

      const payload = stepRaw.mockPayload;
      if (!isRecord(payload) || !isPayload(payload.input) || !isPayload(payload.output)) {
        fail(`${label}: mockPayload.input/output deben ser texto u objeto (máx. ${MAX_PAYLOAD_CHARS} caracteres)`);
      }

      if (stepRaw.durationMs !== undefined) {
        const value = stepRaw.durationMs;
        if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_DURATION || value > MAX_DURATION) {
          fail(`${label}: durationMs debe ser un entero entre ${MIN_DURATION} y ${MAX_DURATION}`);
        }
      }

      const metrics = stepRaw.metrics === undefined ? undefined : readStepMetrics(stepRaw.metrics);
      if (metrics === null) {
        fail(
          `${label}: metrics inválido (latencyMs ≥ 0, error texto, extensions numéricas; tokens enteros ≥ 0 y contextScore entre 0 y 1)`,
        );
      }

      const isLast = index === (entry.steps as unknown[]).length - 1;
      if (stepRaw.edgeIdToNext !== undefined) {
        const edge = typeof stepRaw.edgeIdToNext === "string" ? edgeById.get(stepRaw.edgeIdToNext) : undefined;
        const nextRaw: unknown = (entry.steps as unknown[])[index + 1];
        const nextNode = isRecord(nextRaw) && typeof nextRaw.nodeId === "string" ? nextRaw.nodeId : null;
        if (isLast) {
          fail(`${label}: el último paso no puede tener edgeIdToNext`);
        } else if (!edge) {
          fail(`${label}: edgeIdToNext no es una arista dibujada (${String(stepRaw.edgeIdToNext)})`);
        } else if (
          typeof nodeId === "string" &&
          nextNode !== null &&
          !(
            (edge.source === nodeId && edge.target === nextNode) ||
            (edge.source === nextNode && edge.target === nodeId)
          )
        ) {
          fail(`${label}: edgeIdToNext no conecta ${nodeId} con ${nextNode}`);
        }
      }

      if (errors.length === 0 && referenceOk && typeof nodeId === "string" && isRecord(reference) && isRecord(payload)) {
        const step: FlowStep = {
          stepIndex: index,
          nodeId,
          title: String(stepRaw.title),
          description: String(stepRaw.description),
          fileReference: {
            path: String(reference.path),
            lineStart: Number(reference.lineStart),
            lineEnd: Number(reference.lineEnd),
            functionName: String(reference.functionName),
          },
          mockPayload: {
            input: payload.input as Record<string, unknown> | string,
            output: payload.output as Record<string, unknown> | string,
          },
        };
        if (typeof stepRaw.edgeIdToNext === "string") step.edgeIdToNext = stepRaw.edgeIdToNext;
        if (typeof stepRaw.durationMs === "number") step.durationMs = stepRaw.durationMs;
        if (metrics) step.metrics = metrics;
        steps.push(step);
      }
    });

    const first = Array.isArray(entry.steps) && isRecord(entry.steps[0]) ? entry.steps[0].nodeId : undefined;
    if (!isText(entry.entryNodeId) || !modules.has(entry.entryNodeId)) {
      fail(`${scenarioLabel}: entryNodeId inexistente`);
    } else if (entry.entryNodeId !== first) {
      fail(`${scenarioLabel}: entryNodeId debe ser el nodo del primer paso`);
    }

    if (errors.length === 0) {
      scenarios.push({
        id: String(entry.id),
        name: String(entry.name),
        description: String(entry.description),
        entryNodeId: String(entry.entryNodeId),
        steps,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, file: { version: 1, graph: String(raw.graph), scenarios } };
}

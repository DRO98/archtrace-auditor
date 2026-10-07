import type { ExecutionFlowScenario, RagMetricKey, StepMetrics } from "@core/simulation";

export type MetricTone = "good" | "warn" | "bad";

/** Métricas de un paso del perfil RAG (tokens + relevancia) en el formato genérico `StepMetrics`. */
export function ragStepMetrics(latencyMs: number, prompt = 0, generation = 0, contextScore = 1): StepMetrics {
  const extensions: Record<RagMetricKey, number> = { promptTokens: prompt, generationTokens: generation, contextScore };
  return { latencyMs, extensions };
}

/** Valor de una extensión numérica del paso, o `null` si el perfil no la declara. */
export function metricExtension(metrics: StepMetrics, key: string): number | null {
  const value = metrics.extensions?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ScenarioMetrics {
  latencyMs: {
    /** Latencia de cada paso, en el orden del escenario; `null` si el paso no declara métricas. */
    steps: Array<number | null>;
    total: number;
  };
  /** Suma de tokens (extensiones RAG). Todo a 0 si ningún paso los declara. */
  tokenCount: { prompt: number; generation: number; total: number };
  /** Media de los pasos que declaran `contextScore`; `null` si ninguno lo declara. */
  contextScore: number | null;
  /** Pasos con métricas: si es 0, la tarjeta no tiene nada que enseñar. */
  measuredSteps: number;
  /** Pasos con `error`. */
  errorSteps: number;
  /** true si algún paso trae extensiones RAG (tokens o relevancia). */
  hasRagExtensions: boolean;
}

/** Suma latencias y tokens del escenario y promedia la relevancia del contexto. */
export function aggregateMetrics(scenario: ExecutionFlowScenario): ScenarioMetrics {
  const measured: StepMetrics[] = [];
  const steps = scenario.steps.map((step) => {
    if (!step.metrics) return null;
    measured.push(step.metrics);
    return step.metrics.latencyMs;
  });

  let total = 0;
  let prompt = 0;
  let generation = 0;
  let score = 0;
  let scored = 0;
  let errorSteps = 0;
  let hasRagExtensions = false;
  for (const metrics of measured) {
    total += metrics.latencyMs;
    if (metrics.error) errorSteps += 1;
    const p = metricExtension(metrics, "promptTokens");
    const g = metricExtension(metrics, "generationTokens");
    const c = metricExtension(metrics, "contextScore");
    if (p !== null) prompt += p;
    if (g !== null) generation += g;
    if (c !== null) {
      score += c;
      scored += 1;
    }
    if (p !== null || g !== null || c !== null) hasRagExtensions = true;
  }

  return {
    latencyMs: { steps, total },
    tokenCount: { prompt, generation, total: prompt + generation },
    contextScore: scored > 0 ? score / scored : null,
    measuredSteps: measured.length,
    errorSteps,
    hasRagExtensions,
  };
}

export interface ComponentMetrics {
  /** Suma de los pasos del escenario que ocurren en el componente. */
  latencyMs: number;
  /** Latencia total del escenario, para saber qué parte del recorrido se lleva el componente. */
  flowLatencyMs: number;
  tokenCount: { prompt: number; generation: number; total: number };
  contextScore: number | null;
  measuredSteps: number;
  errorSteps: number;
  hasRagExtensions: boolean;
}

/**
 * Coste y rendimiento de un componente dentro de un escenario: agrega solo sus pasos con métricas.
 * `null` si el componente no participa o ninguno de sus pasos declara métricas.
 */
export function componentMetrics(scenario: ExecutionFlowScenario, nodeId: string): ComponentMetrics | null {
  const own = aggregateMetrics({ ...scenario, steps: scenario.steps.filter((step) => step.nodeId === nodeId) });
  if (own.measuredSteps === 0) return null;
  return {
    latencyMs: own.latencyMs.total,
    flowLatencyMs: aggregateMetrics(scenario).latencyMs.total,
    tokenCount: own.tokenCount,
    contextScore: own.contextScore,
    measuredSteps: own.measuredSteps,
    errorSteps: own.errorSteps,
    hasRagExtensions: own.hasRagExtensions,
  };
}

/** Verde ≤150 ms, amarillo ≤500 ms, rojo >500 ms. */
export function latencyTone(ms: number): MetricTone {
  if (ms <= 150) return "good";
  if (ms <= 500) return "warn";
  return "bad";
}

/** Verde ≥0.7, amarillo ≥0.4, rojo <0.4. */
export function contextScoreTone(score: number): MetricTone {
  if (score >= 0.7) return "good";
  if (score >= 0.4) return "warn";
  return "bad";
}

export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

export function formatTokens(count: number): string {
  return count.toLocaleString("es-ES");
}

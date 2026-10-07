import type { RunRecord } from "@/features/runs/lib/runLog";

/** Umbrales críticos por nodo: latencia media > 1000 ms o tasa de error > 1 %. */
export const SLA_THRESHOLDS = { latencyMs: 1000, errorRate: 0.01 } as const;

export type SlaThresholds = { latencyMs: number; errorRate: number };
export type SlaBreach = "latency" | "errors";

export interface NodeHealth {
  nodeId: string;
  label: string;
  /** Latencia media por ejecución en la que el nodo participó (suma de sus etapas en esa ejecución). */
  avgLatencyMs: number;
  /** Peor latencia observada en una ejecución. */
  maxLatencyMs: number;
  /** Etapas fallidas / etapas del nodo, en [0, 1]. */
  errorRate: number;
  /** Ejecuciones en las que participó. */
  samples: number;
  breaches: SlaBreach[];
}

/**
 * Salud por nodo a partir del Tracing Log (ejecuciones reales o simuladas de cualquier perfil). Las etapas
 * "upstream" (preparación antes del punto de entrada) también cuentan: el nodo trabajó igual.
 */
export function nodeHealth(runs: readonly RunRecord[], thresholds: SlaThresholds = SLA_THRESHOLDS): Map<string, NodeHealth> {
  const acc = new Map<string, { label: string; perRun: number[]; stages: number; errors: number }>();
  for (const run of runs) {
    const inRun = new Map<string, number>();
    for (const stage of run.stages) {
      if (!stage.nodeId) continue;
      const entry = acc.get(stage.nodeId) ?? { label: stage.label, perRun: [], stages: 0, errors: 0 };
      entry.stages += 1;
      if (stage.error !== undefined) entry.errors += 1;
      acc.set(stage.nodeId, entry);
      inRun.set(stage.nodeId, (inRun.get(stage.nodeId) ?? 0) + stage.latencyMs);
    }
    for (const [nodeId, ms] of inRun) acc.get(nodeId)?.perRun.push(ms);
  }

  const health = new Map<string, NodeHealth>();
  for (const [nodeId, entry] of acc) {
    const avgLatencyMs = entry.perRun.reduce((sum, ms) => sum + ms, 0) / Math.max(1, entry.perRun.length);
    const errorRate = entry.stages === 0 ? 0 : entry.errors / entry.stages;
    const breaches: SlaBreach[] = [];
    if (avgLatencyMs > thresholds.latencyMs) breaches.push("latency");
    if (errorRate > thresholds.errorRate) breaches.push("errors");
    health.set(nodeId, {
      nodeId,
      label: entry.label,
      avgLatencyMs,
      maxLatencyMs: Math.max(0, ...entry.perRun),
      errorRate,
      samples: entry.perRun.length,
      breaches,
    });
  }
  return health;
}

/** Solo los nodos que incumplen algún umbral, del peor al menos malo. */
export function slaAlerts(health: ReadonlyMap<string, NodeHealth>): NodeHealth[] {
  return [...health.values()]
    .filter((item) => item.breaches.length > 0)
    .sort((left, right) => right.breaches.length - left.breaches.length || right.avgLatencyMs - left.avgLatencyMs);
}

export function describeBreach(item: NodeHealth, thresholds: SlaThresholds = SLA_THRESHOLDS): string {
  const parts: string[] = [];
  if (item.breaches.includes("latency")) {
    parts.push(`latencia media ${Math.round(item.avgLatencyMs)} ms (> ${thresholds.latencyMs} ms)`);
  }
  if (item.breaches.includes("errors")) {
    parts.push(`errores ${(item.errorRate * 100).toFixed(1)} % (> ${(thresholds.errorRate * 100).toFixed(0)} %)`);
  }
  return `${parts.join(" · ")} en ${item.samples} ${item.samples === 1 ? "ejecución" : "ejecuciones"}`;
}

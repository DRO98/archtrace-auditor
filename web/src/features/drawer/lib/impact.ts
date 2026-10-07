import type { BlastEdge } from "@/features/canvas/lib/blastRadius";

export type RiskLevel = "high" | "secondary" | "indirect" | "contract" | "none";

export interface RiskBadge {
  level: RiskLevel;
  label: string;
}

/** Riesgo de un módulo aguas abajo según su distancia al origen. */
export function riskForDepth(depth: number): RiskBadge {
  if (depth <= 1) return { level: "high", label: "Cambio crítico" };
  if (depth === 2) return { level: "secondary", label: "Dependencia moderada" };
  return { level: "indirect", label: "Impacto acotado" };
}

/** Quien consume el origen depende de su contrato (firma, forma de los datos): se rompe si cambia. */
export const CALLER_RISK: RiskBadge = { level: "contract", label: "Rompe contrato" };

/**
 * Riesgo global del cambio: el acoplamiento directo (salidas + consumidores) pesa más que la cascada.
 */
export function overallRisk(direct: number, cascade: number, callers: number): RiskBadge {
  const coupling = direct + callers;
  if (coupling === 0 && cascade === 0) return { level: "none", label: "Sin riesgo" };
  if (coupling >= 4 || direct + cascade >= 6) return { level: "high", label: "Cambio crítico" };
  if (coupling >= 2 || cascade > 0) return { level: "secondary", label: "Dependencia moderada" };
  return { level: "indirect", label: "Impacto acotado" };
}

/** Módulos que llaman al origen (aristas entrantes directas), sin repetir ni contar auto-aristas. */
export function directCallers(sourceId: string, edges: readonly BlastEdge[]): string[] {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.target === sourceId && edge.source !== sourceId) seen.add(edge.source);
  }
  return [...seen];
}

/**
 * Cable que conviene resaltar al pasar por un módulo de la lista.
 * - "outgoing": el cable afectado que llega a `moduleId` (el que viene del origen si existe).
 * - "incoming": el cable `moduleId → origen`.
 */
export function edgeFor(
  direction: "outgoing" | "incoming",
  sourceId: string,
  moduleId: string,
  edges: readonly BlastEdge[],
  affectedEdgeIds: ReadonlySet<string> = new Set(),
): string | null {
  if (direction === "incoming") {
    return edges.find((edge) => edge.source === moduleId && edge.target === sourceId)?.id ?? null;
  }
  const direct = edges.find((edge) => edge.source === sourceId && edge.target === moduleId);
  if (direct) return direct.id;
  return edges.find((edge) => edge.target === moduleId && affectedEdgeIds.has(edge.id))?.id ?? null;
}

/** Umbral a partir del cual la lista muestra el buscador. */
export const FILTER_THRESHOLD = 5;

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return fields.some((field) => normalize(field).includes(needle));
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

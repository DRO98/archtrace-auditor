import type { CSSProperties } from "react";
import type { EdgeSimStatus } from "../lib/visuals";

/** Color de la simulación (`--color-flow` en globals.css). */
export const FLOW_ACTIVE = "#7c3aed";
export const FLOW_DONE = "#c4b5fd";

const BY_STATUS: Record<EdgeSimStatus, CSSProperties> = {
  active: { stroke: FLOW_ACTIVE, strokeWidth: 3, opacity: 1 },
  done: { stroke: FLOW_DONE, strokeWidth: 2, opacity: 1 },
  off: { opacity: 0.2 },
};

/** Estilo de una arista según la simulación. Sin simulación (`undefined`) devuelve el estilo tal cual. */
export function simEdgeStyle(
  base: CSSProperties | undefined,
  status: EdgeSimStatus | undefined,
): CSSProperties | undefined {
  if (!status) return base;
  return { ...base, ...BY_STATUS[status] };
}

import type { CSSProperties } from "react";
import type { EdgeSimStatus } from "../lib/visuals";

/** Color de la simulación (`--color-flow` en globals.css). */
export const FLOW_ACTIVE = "#0d9488";
export const FLOW_DONE = "#99f6e4";

/** Trazo discontinuo que avanza despacio por la arista activa (`@keyframes sim-flow` en globals.css). */
export const FLOW_DASH: CSSProperties = {
  strokeDasharray: "10 8",
  animationName: "sim-flow",
  animationDuration: "2.5s",
  animationTimingFunction: "linear",
  animationIterationCount: "infinite",
};

const BY_STATUS: Record<EdgeSimStatus, CSSProperties> = {
  active: { stroke: FLOW_ACTIVE, strokeWidth: 3, opacity: 1, ...FLOW_DASH },
  done: { stroke: FLOW_DONE, strokeWidth: 2, opacity: 1 },
  preview: { stroke: "#0f766e", strokeWidth: 2.5, strokeOpacity: 1, opacity: 1 },
  off: { opacity: 0.2 },
};

/**
 * Estilo de una arista según la simulación. Sin simulación (`undefined`) devuelve el estilo tal cual.
 * `reversed`: el dato va de destino a origen, así que el trazo se anima al revés.
 */
export function simEdgeStyle(
  base: CSSProperties | undefined,
  status: EdgeSimStatus | undefined,
  reversed = false,
): CSSProperties | undefined {
  if (!status) return base;
  const style = { ...base, ...BY_STATUS[status] };
  return status === "active" && reversed ? { ...style, animationDirection: "reverse" } : style;
}

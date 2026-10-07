import type { CSSProperties } from "react";
import type { Edge } from "@xyflow/react";
import { FLOW_DASH } from "@/features/simulation/components/simEdgeStyle";
import type { CanvasHover } from "../store";
import { EDGE_STYLE } from "../theme";

export const IMPACT_STROKE = "#d97706";
/** Cable de entrada (quién llama al origen) resaltado desde el panel de impacto. */
export const IMPACT_HOVER_STROKE = "#0f766e";

export interface EdgeFocus {
  selectedModuleId: string | null;
  hover: CanvasHover;
  /** Aristas aguas abajo en el análisis de impacto; manda sobre todo lo demás. */
  affectedEdgeIds: ReadonlySet<string> | null;
  /** Cable resaltado desde la lista del panel de impacto (solo cuenta con el análisis activo). */
  impactHoverEdgeId?: string | null;
}

/** Qué aristas resaltar y si se animan. `null` = sin foco: se pintan todas con su estilo base. */
function focusedEdges(edges: readonly Edge[], focus: EdgeFocus): { ids: Set<string>; animate: boolean } | null {
  const { hover, selectedModuleId } = focus;
  if (hover?.kind === "edge") return { ids: new Set([hover.id]), animate: false };
  const moduleId = hover?.kind === "module" ? hover.id : selectedModuleId;
  if (!moduleId) return null;
  const ids = new Set(edges.filter((edge) => edge.source === moduleId || edge.target === moduleId).map((edge) => edge.id));
  // El flujo del nodo seleccionado se anima (dirección origen → destino); el hover es transitorio y no.
  return { ids, animate: hover === null };
}

const DIMMED: CSSProperties = { opacity: EDGE_STYLE.dimmedOpacity };

/**
 * Estilo de cada arista según el foco del lienzo. Las resaltadas conservan el color de su origen pero
 * ganan grosor y opacidad plena, y se elevan sobre el resto; las demás bajan a `dimmedOpacity`.
 */
export function paintEdges(edges: Edge[], focus: EdgeFocus): Edge[] {
  if (focus.affectedEdgeIds) {
    const affected = focus.affectedEdgeIds;
    // Pasar el ratón por un módulo de la lista del panel resalta su cable por encima del resto;
    // el hover del propio lienzo no altera el análisis.
    const hovered = focus.impactHoverEdgeId ?? null;
    return edges.map((edge) =>
      edge.id === hovered
        ? {
            ...edge,
            zIndex: 2,
            style: {
              ...edge.style,
              stroke: affected.has(edge.id) ? IMPACT_STROKE : IMPACT_HOVER_STROKE,
              strokeWidth: EDGE_STYLE.focusWidth + 2,
              strokeOpacity: 1,
              opacity: 1,
              ...FLOW_DASH,
            },
          }
        : affected.has(edge.id)
        ? {
            ...edge,
            zIndex: 1,
            style: { ...edge.style, stroke: IMPACT_STROKE, strokeWidth: EDGE_STYLE.focusWidth, strokeOpacity: 1, opacity: 1, ...FLOW_DASH },
          }
        : { ...edge, style: { ...edge.style, ...DIMMED } },
    );
  }
  const focused = focusedEdges(edges, focus);
  if (!focused) return edges;
  return edges.map((edge) => {
    if (!focused.ids.has(edge.id)) return { ...edge, style: { ...edge.style, ...DIMMED } };
    const style: CSSProperties = { ...edge.style, strokeWidth: EDGE_STYLE.focusWidth, strokeOpacity: 1, opacity: 1 };
    // Las aristas de apoyo ya son discontinuas: se resaltan sin animación para no confundir su trazo.
    const animated = focused.animate && edge.type !== "support";
    return { ...edge, zIndex: 1, style: animated ? { ...style, ...FLOW_DASH } : style };
  });
}

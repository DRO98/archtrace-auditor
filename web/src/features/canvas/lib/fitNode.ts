import type { useReactFlow } from "@xyflow/react";
import { CARD_HEIGHT, CARD_WIDTH, SUPPORT_SIZE } from "../theme";

type FitView = ReturnType<typeof useReactFlow>["fitView"];
type SetCenter = ReturnType<typeof useReactFlow>["setCenter"];
type GetInternalNode = ReturnType<typeof useReactFlow>["getInternalNode"];

export const FIT_NODE_DURATION_MS = 800;

/** Zoom fijo del visor de pasos: se desplaza la cámara sin acercar el nodo. */
export const STEP_VIEW_ZOOM = 0.85;
export const STEP_VIEW_DURATION_MS = 600;
/** Alto que tapa la barra de pasos (arriba a la izquierda), en píxeles de pantalla. */
export const STEP_BAR_PADDING_TOP = 100;
/** Aire extra a la izquierda de un panel que se superponga al lienzo. */
export const PANEL_GAP = 20;

/** Hueco de pantalla que tapan los paneles en cada lado; el nodo se centra en lo que queda. */
export interface StepViewPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Encuadra un nodo con aire alrededor: el nodo ocupa ~40 % de la vista y el zoom no pasa de 1.25,
 * así se ven sus vecinos y no se recorta. Lo usan el drawer, el buscador y el seguimiento del IDE.
 * Pasa `duration` desde `useMotionDuration(FIT_NODE_DURATION_MS)` para respetar "reducir movimiento".
 */
export function fitNode(fitView: FitView, id: string, duration = FIT_NODE_DURATION_MS): void {
  void fitView({ nodes: [{ id }], padding: 1.5, maxZoom: 1.25, duration });
}

export const NO_PADDING: StepViewPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * `rightOverlap`: píxeles del lienzo que tapa la columna derecha. Hoy es 0 porque la columna es
 * hermana del lienzo en el flex (el lienzo ya termina donde empieza el panel); se mide igualmente
 * para que el encuadre siga siendo correcto si un panel llega a superponerse.
 */
export function stepViewPadding(panels: { rightOverlap: number; stepBarOpen: boolean }): StepViewPadding {
  return {
    top: panels.stepBarOpen ? STEP_BAR_PADDING_TOP : 0,
    right: panels.rightOverlap > 0 ? panels.rightOverlap + PANEL_GAP : 0,
    bottom: 0,
    left: 0,
  };
}

/** Píxeles del lienzo que tapa el panel lateral derecho (`[data-right-panel]`), 0 si no hay solape. */
export function measureRightOverlap(pane: HTMLElement | null): number {
  if (!pane || typeof document === "undefined") return 0;
  const panel = document.querySelector<HTMLElement>("[data-right-panel]");
  if (!panel) return 0;
  const paneRect = pane.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const verticalOverlap = panelRect.bottom > paneRect.top && panelRect.top < paneRect.bottom;
  if (!verticalOverlap) return 0;
  return Math.max(0, Math.min(paneRect.right, panelRect.right) - Math.max(paneRect.left, panelRect.left));
}

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Punto de flujo que `setCenter` debe enfocar para que el centro del nodo caiga en el centro
 * del área libre (viewport menos los paneles). El zoom no entra en el tamaño del nodo:
 * solo convierte el padding de pantalla a unidades del lienzo.
 */
export function stepCenterPoint(box: NodeBox, zoom: number, padding: StepViewPadding): { x: number; y: number } {
  const scale = zoom > 0 ? zoom : 1;
  return {
    x: box.x + box.width / 2 + (padding.right - padding.left) / (2 * scale),
    y: box.y + box.height / 2 - (padding.top - padding.bottom) / (2 * scale),
  };
}

/**
 * Paneo suave hacia el nodo del paso, con zoom constante. Usa la posición absoluta
 * (incluye cajas de subsistema): la posición relativa al padre mandaría la cámara al vacío.
 */
export function centerStepNode(
  setCenter: SetCenter,
  getInternalNode: GetInternalNode,
  id: string,
  options: { zoom?: number; duration?: number; padding?: StepViewPadding } = {},
): void {
  const node = getInternalNode(id);
  if (!node) return;
  const zoom = options.zoom ?? STEP_VIEW_ZOOM;
  const padding = options.padding ?? NO_PADDING;
  const fallback = node.type === "support" ? SUPPORT_SIZE : CARD_WIDTH;
  const fallbackHeight = node.type === "support" ? SUPPORT_SIZE : CARD_HEIGHT;
  const width = node.measured.width ?? node.width ?? fallback;
  const height = node.measured.height ?? node.height ?? fallbackHeight;
  const { x, y } = node.internals.positionAbsolute;
  const target = stepCenterPoint(
    {
      x,
      y,
      width: width > 0 ? width : fallback,
      height: height > 0 ? height : fallbackHeight,
    },
    zoom,
    padding,
  );
  void setCenter(target.x, target.y, { zoom, duration: options.duration ?? STEP_VIEW_DURATION_MS });
}

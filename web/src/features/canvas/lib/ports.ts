import { Position } from "@xyflow/react";

export type PortSide = "left" | "right" | "top" | "bottom";

export const PORT_SIDES: readonly PortSide[] = ["left", "right", "top", "bottom"];

/** Id estable del handle de cada lado; el mismo id existe como source y como target. */
export const portHandleId = (side: PortSide): string => `port-${side}`;

export const PORT_POSITION: Readonly<Record<PortSide, Position>> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PortPair {
  source: PortSide;
  target: PortSide;
}

/** Por encima de esta relación |dy|/|dx| una conexión dentro de la misma columna sale en vertical. */
const VERTICAL_BIAS = 1.2;

/**
 * Lados por los que sale y entra una arista. Entre columnas distintas siempre en horizontal
 * (el flujo avanza de izquierda a derecha y los codos caen en los pasillos). Dentro de una misma
 * columna (proyecciones X solapadas) y claramente más lejos en Y que en X, en vertical:
 * p. ej. LLM Service → Prompts o Chunker → Embedder dentro de su caja.
 */
export function pickPortPair(source: Rect, target: Rect, others: readonly Rect[] = []): PortPair {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  const sameColumn = source.x < target.x + target.width && target.x < source.x + source.width;
  if (sameColumn && Math.abs(dy) > VERTICAL_BIAS * Math.abs(dx)) {
    // Un cable vertical que tendría que atravesar otra tarjeta de la pila (Registry → Page Fetcher →
    // Web Search) sale por el lado derecho: el corto queda en el centro y el largo por el carril exterior.
    if (others.some((other) => sitsBetween(other, source, target))) return { source: "right", target: "right" };
    return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
  }
  return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
}

/** `other` ocupa el tramo vertical entre `source` y `target` (misma banda X y entre sus alturas). */
function sitsBetween(other: Rect, source: Rect, target: Rect): boolean {
  const left = Math.max(source.x, target.x);
  const right = Math.min(source.x + source.width, target.x + target.width);
  if (other.x >= right || other.x + other.width <= left) return false;
  const top = Math.min(source.y + source.height, target.y + target.height);
  const bottom = Math.max(source.y, target.y);
  return other.y < bottom && other.y + other.height > top;
}

export interface PortEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * Asigna puertos a cada arista principal. Un lado inferior ocupado por sub-nodos (asas-diamante
 * y círculos debajo de la tarjeta) no se usa: esa arista sale y entra por la derecha y el router
 * la lleva por el pasillo exterior de la columna.
 */
export function assignEdgePorts(
  edges: readonly PortEdge[],
  rectOf: (id: string) => Rect | undefined,
  hasSupports: (id: string) => boolean = () => false,
  /** Tarjetas y sub-nodos visibles: sirven para detectar cables verticales que pasarían por encima de otra. */
  allRects: ReadonlyMap<string, Rect> = new Map(),
): Map<string, PortPair> {
  const ports = new Map<string, PortPair>();
  for (const edge of edges) {
    const source = rectOf(edge.source);
    const target = rectOf(edge.target);
    if (!source || !target) continue;
    const others = [...allRects].flatMap(([id, rect]) => (id === edge.source || id === edge.target ? [] : [rect]));
    const pair = pickPortPair(source, target, others);
    const blocked =
      (pair.source === "bottom" && hasSupports(edge.source)) || (pair.target === "bottom" && hasSupports(edge.target));
    ports.set(edge.id, blocked ? { source: "right", target: "right" } : pair);
  }
  return ports;
}

/** Lado más usado por un nodo como origen o destino; `fallback` si no tiene aristas. */
export function majoritySide(sides: readonly PortSide[], fallback: PortSide): PortSide {
  const counts = new Map<PortSide, number>();
  for (const side of sides) counts.set(side, (counts.get(side) ?? 0) + 1);
  let best = fallback;
  let top = 0;
  for (const side of PORT_SIDES) {
    const count = counts.get(side) ?? 0;
    if (count > top) {
      best = side;
      top = count;
    }
  }
  return best;
}

/** Separación máxima entre dos cables que salen del mismo lado, y margen libre en cada esquina. */
export const PORT_SLOT_GAP = 14;
export const PORT_SLOT_MARGIN = 12;

/** Ranura de una arista en un lado: `index` de `count`, repartidas a lo largo del lado. */
export interface PortSlot {
  side: PortSide;
  index: number;
  count: number;
}

export interface EdgeSlots {
  source: PortSlot;
  target: PortSlot;
}

/** Id del handle de una ranura concreta (`port-right-2`). */
export const slotHandleId = (slot: PortSlot): string => `${portHandleId(slot.side)}-${slot.index}`;

/**
 * Reparte las aristas que comparten nodo y lado en ranuras distintas, para que no salgan todas del
 * mismo punto. Se ordenan por la posición del otro extremo (Y en lados izquierdo/derecho, X arriba/abajo):
 * el cable hacia el destino más alto sale por la ranura más alta y los tramos iniciales no se cruzan.
 */
export function assignPortSlots(
  edges: ReadonlyArray<PortEdge & { ports: PortPair }>,
  rectOf: (id: string) => Rect | undefined,
): Map<string, EdgeSlots> {
  const buckets = new Map<string, Array<{ edge: string; end: "source" | "target"; key: number }>>();
  const center = (rect: Rect, side: PortSide) => (side === "left" || side === "right" ? rect.y + rect.height / 2 : rect.x + rect.width / 2);
  for (const edge of edges) {
    const source = rectOf(edge.source);
    const target = rectOf(edge.target);
    if (!source || !target) continue;
    for (const [end, node, side, other] of [
      ["source", edge.source, edge.ports.source, target],
      ["target", edge.target, edge.ports.target, source],
    ] as const) {
      const bucketKey = `${node}\u0000${side}`;
      const list = buckets.get(bucketKey) ?? [];
      list.push({ edge: edge.id, end, key: center(other, side) });
      buckets.set(bucketKey, list);
    }
  }

  const partial = new Map<string, Partial<EdgeSlots>>();
  for (const [bucketKey, list] of buckets) {
    const side = bucketKey.slice(bucketKey.indexOf("\u0000") + 1) as PortSide;
    list.sort((left, right) => left.key - right.key || left.edge.localeCompare(right.edge) || left.end.localeCompare(right.end));
    list.forEach((item, index) => {
      const slots = partial.get(item.edge) ?? {};
      slots[item.end] = { side, index, count: list.length };
      partial.set(item.edge, slots);
    });
  }

  const slots = new Map<string, EdgeSlots>();
  for (const [edge, item] of partial) {
    if (item.source && item.target) slots.set(edge, { source: item.source, target: item.target });
  }
  return slots;
}

/** Desplazamiento (px) de la ranura respecto al centro del lado, acotado para no llegar a las esquinas. */
export function slotOffset(slot: PortSlot, sideLength: number): number {
  if (slot.count <= 1) return 0;
  const room = Math.max(0, sideLength - 2 * PORT_SLOT_MARGIN);
  const gap = Math.min(PORT_SLOT_GAP, room / (slot.count - 1));
  return (slot.index - (slot.count - 1) / 2) * gap;
}

/** Longitud del lado `side` de `rect`. */
export function sideLength(rect: Rect, side: PortSide): number {
  return side === "left" || side === "right" ? rect.height : rect.width;
}

/** Punto de anclaje de una ranura: el punto medio del lado desplazado a lo largo de él. */
export function slotAnchor(rect: Rect, slot: PortSlot): { x: number; y: number } {
  const anchor = portAnchor(rect, slot.side);
  const offset = slotOffset(slot, sideLength(rect, slot.side));
  return slot.side === "left" || slot.side === "right" ? { x: anchor.x, y: anchor.y + offset } : { x: anchor.x + offset, y: anchor.y };
}

/** Punto medio del lado `side` de `rect`. */
export function portAnchor(rect: Rect, side: PortSide): { x: number; y: number } {
  switch (side) {
    case "left":
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case "top":
      return { x: rect.x + rect.width / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

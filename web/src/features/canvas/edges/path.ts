import type { GraphPosition } from "../lib/layout";
import { EDGE_STYLE } from "../theme";

/** Polilínea completa (origen, codos, destino) calculada por el router; vacía = sin ruta. */
export type RoutedEdgeData = { points: GraphPosition[] };

const CORNER_RADIUS = EDGE_STYLE.cornerRadius;

/**
 * Traza la polilínea con esquinas redondeadas. Admite tramos horizontales y verticales en
 * cualquier sentido. Los extremos se sustituyen por la posición real de los handles.
 * Devuelve null si no hay ruta.
 */
export function routedPath(
  source: GraphPosition,
  points: readonly GraphPosition[],
  target: GraphPosition,
  radius = CORNER_RADIUS,
): string | null {
  if (points.length < 2) return null;
  const chain = points.map((point) => ({ ...point }));
  const align = (end: GraphPosition, anchor: number, neighbour: number) => {
    const original = points[anchor] as GraphPosition;
    const next = chain[neighbour];
    if (next && neighbour !== anchor) {
      const horizontal = original.y === (points[neighbour] as GraphPosition).y;
      if (horizontal) next.y = end.y;
      else next.x = end.x;
    }
    chain[anchor] = { ...end };
  };
  const last = chain.length - 1;
  if (last >= 3) {
    align(source, 0, 1);
    align(target, last, last - 1);
  } else {
    chain[0] = { ...source };
    chain[last] = { ...target };
  }

  let path = `M ${chain[0]?.x},${chain[0]?.y}`;
  for (let index = 1; index < last; index += 1) {
    const previous = chain[index - 1] as GraphPosition;
    const corner = chain[index] as GraphPosition;
    const next = chain[index + 1] as GraphPosition;
    const into = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const out = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (into === 0 || out === 0) continue;
    const r = Math.min(radius, into / 2, out / 2);
    const before = { x: corner.x - ((corner.x - previous.x) / into) * r, y: corner.y - ((corner.y - previous.y) / into) * r };
    const after = { x: corner.x + ((next.x - corner.x) / out) * r, y: corner.y + ((next.y - corner.y) / out) * r };
    path += ` L ${before.x},${before.y} Q ${corner.x},${corner.y} ${after.x},${after.y}`;
  }
  path += ` L ${chain[last]?.x},${chain[last]?.y}`;
  return path;
}

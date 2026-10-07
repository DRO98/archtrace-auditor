export interface RoutingEdge {
  id: string;
  source: string;
  target: string;
}

/** Un salto por una arista. `reversed` = el paquete viaja de `target` a `source`. */
export interface RouteHop {
  edgeId: string;
  reversed: boolean;
}

export const MAX_ROUTE_HOPS = 4;

interface Neighbor {
  to: string;
  hop: RouteHop;
}

/**
 * Camino que recorre el paquete de `from` a `to` sobre las aristas dibujadas.
 *
 * - `from === to` → `[]` (sin viaje).
 * - `preferredEdgeId` que conecte ambos nodos (en cualquier sentido) → un solo salto.
 * - Si no, camino más corto tratando las aristas como no dirigidas; a igualdad de
 *   saltos gana el que va a favor de la dirección de las aristas.
 * - Sin camino, o más de MAX_ROUTE_HOPS saltos → `null`.
 */
export function resolveRoute(
  edges: readonly RoutingEdge[],
  from: string,
  to: string,
  preferredEdgeId?: string,
): RouteHop[] | null {
  if (from === to) return [];

  if (preferredEdgeId !== undefined) {
    const preferred = edges.find((edge) => edge.id === preferredEdgeId);
    if (preferred && preferred.source === from && preferred.target === to) {
      return [{ edgeId: preferred.id, reversed: false }];
    }
    if (preferred && preferred.source === to && preferred.target === from) {
      return [{ edgeId: preferred.id, reversed: true }];
    }
  }

  const adjacency = new Map<string, Neighbor[]>();
  const add = (node: string, neighbor: Neighbor): void => {
    const list = adjacency.get(node);
    if (list) list.push(neighbor);
    else adjacency.set(node, [neighbor]);
  };
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    add(edge.source, { to: edge.target, hop: { edgeId: edge.id, reversed: false } });
    add(edge.target, { to: edge.source, hop: { edgeId: edge.id, reversed: true } });
  }

  // Dijkstra sobre un grafo pequeño: coste 1 por salto, +0.01 si va contra la flecha.
  const cost = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, { node: string; hop: RouteHop }>();
  const open = new Set<string>([from]);
  const closed = new Set<string>();

  while (open.size > 0) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const node of open) {
      const value = cost.get(node) ?? Number.POSITIVE_INFINITY;
      if (value < best) {
        best = value;
        current = node;
      }
    }
    if (current === null) break;
    open.delete(current);
    closed.add(current);
    if (current === to) break;

    for (const { to: next, hop } of adjacency.get(current) ?? []) {
      if (closed.has(next)) continue;
      const candidate = best + 1 + (hop.reversed ? 0.01 : 0);
      if (candidate < (cost.get(next) ?? Number.POSITIVE_INFINITY)) {
        cost.set(next, candidate);
        previous.set(next, { node: current, hop });
        open.add(next);
      }
    }
  }

  if (!previous.has(to)) return null;

  const hops: RouteHop[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return null;
    hops.unshift(step.hop);
    cursor = step.node;
  }
  return hops.length > MAX_ROUTE_HOPS ? null : hops;
}

/** Ruta de cada transición `i → i+1` de un escenario. `null` = sin camino (salto directo). */
export function resolveScenarioRoutes(
  steps: ReadonlyArray<{ nodeId: string; edgeIdToNext?: string }>,
  edges: readonly RoutingEdge[],
): Array<RouteHop[] | null> {
  const routes: Array<RouteHop[] | null> = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    if (!current || !next) continue;
    routes.push(resolveRoute(edges, current.nodeId, next.nodeId, current.edgeIdToNext));
  }
  return routes;
}

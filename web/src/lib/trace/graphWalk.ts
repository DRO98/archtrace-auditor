import type { EdgeKind, ModuleRole } from "@core/graph";
import type { TraceModuleRef, TraceProfileId } from "@core/trace";

/** Arista semántica del grafo (no la dibujada): el sentido es llamador → llamado / productor → consumidor. */
export interface TraceGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface WalkHop {
  nodeId: string;
  /** Nodo desde el que llega el paso; null en el punto de entrada. */
  from: string | null;
  /** Arista semántica por la que llega; null en el punto de entrada. */
  edgeId: string | null;
  depth: number;
}

export const MAX_WALK_HOPS = 24;
export const MAX_WALK_DEPTH = 8;

/**
 * Qué aristas sigue cada perfil y con qué prioridad (menor = antes). Un evento viaja por `data-flow`;
 * si el grafo no tiene ninguna desde un nodo, cae a `calls` e `imports` (un consumidor que importa
 * el cliente del broker). Una petición HTTP sigue llamadas e imports.
 */
const EDGE_PRIORITY: Readonly<Record<Exclude<TraceProfileId, "rag">, Readonly<Partial<Record<EdgeKind, number>>>>> = {
  http: { calls: 0, imports: 1, "data-flow": 2 },
  event: { "data-flow": 0, calls: 1, imports: 2 },
};

/** Roles de entrada por perfil: el punto de entrada por defecto si el usuario no elige nodo. */
const ENTRY_ROLES: Readonly<Record<Exclude<TraceProfileId, "rag">, readonly ModuleRole[]>> = {
  http: ["api", "rpc", "app", "ui"],
  event: ["broker", "stream", "api", "app"],
};

/**
 * Punto de entrada por defecto: el primer módulo con rol de entrada del perfil que tenga salidas;
 * si no hay, el módulo con más salidas y ninguna entrada (una raíz del grafo).
 */
export function defaultEntry(
  profile: Exclude<TraceProfileId, "rag">,
  modules: readonly TraceModuleRef[],
  edges: readonly TraceGraphEdge[],
): string | null {
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  for (const role of ENTRY_ROLES[profile]) {
    const hit = modules.find((item) => item.role === role && (outDegree.get(item.id) ?? 0) > 0);
    if (hit) return hit.id;
  }
  const roots = modules
    .filter((item) => (outDegree.get(item.id) ?? 0) > 0 && (inDegree.get(item.id) ?? 0) === 0)
    .sort((left, right) => (outDegree.get(right.id) ?? 0) - (outDegree.get(left.id) ?? 0));
  return roots[0]?.id ?? modules[0]?.id ?? null;
}

/**
 * Recorrido en anchura desde `entry` siguiendo las aristas en su sentido, con las del tipo preferido
 * del perfil primero. Cada nodo se visita una vez; se corta en MAX_WALK_HOPS nodos o MAX_WALK_DEPTH
 * niveles para que un grafo enorme no convierta la traza en un barrido del sistema entero.
 */
export function walkGraph(
  profile: Exclude<TraceProfileId, "rag">,
  entry: string,
  edges: readonly TraceGraphEdge[],
): WalkHop[] {
  const priority = EDGE_PRIORITY[profile];
  const outgoing = new Map<string, TraceGraphEdge[]>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  for (const list of outgoing.values()) {
    list.sort((left, right) => (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9));
  }

  const hops: WalkHop[] = [{ nodeId: entry, from: null, edgeId: null, depth: 0 }];
  const seen = new Set([entry]);
  for (let index = 0; index < hops.length && hops.length < MAX_WALK_HOPS; index += 1) {
    const hop = hops[index];
    if (!hop || hop.depth >= MAX_WALK_DEPTH) continue;
    let candidates = outgoing.get(hop.nodeId) ?? [];
    // En un evento, si el nodo tiene flujo de datos explícito, solo se sigue ese.
    if (profile === "event" && candidates.some((edge) => edge.kind === "data-flow")) {
      candidates = candidates.filter((edge) => edge.kind === "data-flow");
    }
    for (const edge of candidates) {
      if (seen.has(edge.target) || hops.length >= MAX_WALK_HOPS) continue;
      seen.add(edge.target);
      hops.push({ nodeId: edge.target, from: hop.nodeId, edgeId: edge.id, depth: hop.depth + 1 });
    }
  }
  return hops;
}

/**
 * Latencia simulada de un paso según el rol del nodo (orden de magnitud realista, determinista):
 * una caché responde en ~1 ms, una BD en decenas, un modelo de IA en cientos.
 */
const ROLE_LATENCY_MS: Readonly<Partial<Record<ModuleRole, number>>> = {
  api: 12,
  rpc: 6,
  app: 4,
  ui: 8,
  service: 10,
  pipeline: 6,
  transform: 8,
  database: 24,
  cache: 1.5,
  broker: 5,
  stream: 35,
  "ai-model": 650,
  prompt: 2,
  util: 1,
  code: 3,
};

export function simulatedLatency(role: ModuleRole | undefined, nodeId: string): number {
  const base = ROLE_LATENCY_MS[role ?? "code"] ?? 3;
  // Variación determinista (±20 %) por nodo: dos nodos con el mismo rol no dan la misma cifra.
  let hash = 0;
  for (const char of nodeId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const jitter = 0.8 + ((hash % 400) / 1000);
  return Math.round(base * jitter * 10) / 10;
}

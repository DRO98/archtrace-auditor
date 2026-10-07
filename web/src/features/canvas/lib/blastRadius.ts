import type { CodeModule, ModuleRole } from "@core/graph";

/** Arista mínima del lienzo: `Edge` de React Flow es asignable. */
export interface BlastEdge {
  id: string;
  source: string;
  target: string;
}

export interface BlastRadius {
  affectedNodeIds: Set<string>;
  affectedEdgeIds: Set<string>;
  /** Distancia mínima desde el origen. 1 = impacto directo. El origen no aparece. */
  depthMap: Record<string, number>;
}

export type ImpactVisual = "idle" | "origin" | "direct" | "cascade" | "dim";

const EMPTY: BlastRadius = {
  affectedNodeIds: new Set(),
  affectedEdgeIds: new Set(),
  depthMap: {},
};

/**
 * Cierre transitivo aguas abajo: BFS por aristas salientes.
 * Ciclos y auto-aristas no se reentran. Un origen sin aristas devuelve conjuntos vacíos.
 */
export function calculateBlastRadius(sourceNodeId: string, edges: readonly BlastEdge[]): BlastRadius {
  const outgoing = new Map<string, BlastEdge[]>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }
  if (!outgoing.has(sourceNodeId) && !edges.some((edge) => edge.target === sourceNodeId || edge.source === sourceNodeId)) {
    return EMPTY;
  }

  const affectedNodeIds = new Set<string>();
  const affectedEdgeIds = new Set<string>();
  const depthMap: Record<string, number> = {};
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceNodeId, depth: 0 }];
  const seen = new Set<string>([sourceNodeId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextEdges = outgoing.get(current.id);
    if (!nextEdges) continue;
    const nextDepth = current.depth + 1;
    for (const edge of nextEdges) {
      affectedEdgeIds.add(edge.id);
      if (seen.has(edge.target)) continue;
      seen.add(edge.target);
      affectedNodeIds.add(edge.target);
      depthMap[edge.target] = nextDepth;
      queue.push({ id: edge.target, depth: nextDepth });
    }
  }

  return { affectedNodeIds, affectedEdgeIds, depthMap };
}

export function impactVisual(
  nodeId: string,
  active: boolean,
  sourceNodeId: string | null,
  depthMap: Record<string, number>,
): ImpactVisual {
  if (!active || !sourceNodeId) return "idle";
  if (nodeId === sourceNodeId) return "origin";
  const depth = depthMap[nodeId];
  if (depth === undefined) return "dim";
  return depth === 1 ? "direct" : "cascade";
}

export interface ImpactSummary {
  modules: number;
  apiRoutes: number;
  label: string;
}

function roleOf(codeModule: CodeModule): ModuleRole {
  return codeModule.role ?? "code";
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeImpact(
  depthMap: Record<string, number>,
  modulesById: ReadonlyMap<string, CodeModule>,
): ImpactSummary {
  let modules = 0;
  let apiRoutes = 0;
  for (const id of Object.keys(depthMap)) {
    const codeModule = modulesById.get(id);
    if (!codeModule) continue;
    if (roleOf(codeModule) === "api") apiRoutes += 1;
    else modules += 1;
  }
  return { modules, apiRoutes, label: impactLabel(modules, apiRoutes) };
}

export function impactLabel(modules: number, apiRoutes: number): string {
  if (modules === 0 && apiRoutes === 0) return "Ningún módulo impactado";
  const moduleText = countLabel(modules, "módulo", "módulos");
  const apiText = countLabel(apiRoutes, "ruta API", "rutas API");
  if (modules === 0) return `${apiText} impactada${apiRoutes === 1 ? "" : "s"}`;
  if (apiRoutes === 0) return `${moduleText} impactado${modules === 1 ? "" : "s"}`;
  return `${moduleText} y ${apiText} impactadas`;
}

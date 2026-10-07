import type { ExecutionFlowScenario } from "@core/simulation";
import type { EnginePhase } from "./engine";
import { resolveScenarioRoutes, type RouteHop, type RoutingEdge } from "./route";

export type NodeSimStatus = "active" | "done" | "upcoming" | "preview" | "off";
export type EdgeSimStatus = "active" | "done" | "preview" | "off";

export interface SimVisuals {
  /** Un valor por cada nodo del grafo. */
  nodeStatus: Record<string, NodeSimStatus>;
  /** Solo aristas con estado: `off` (ajenas al escenario), `done` o `active`. Las que faltan se ven normales. */
  edgeStatus: Record<string, EdgeSimStatus>;
  /** Aristas activas que el dato recorre de destino a origen (el trazo animado va al revés). */
  edgeReversed: Record<string, true>;
  /** Primera arista de la ruta activa: ahí se fija la etiqueta con el dato. */
  labelEdgeId: string | null;
}

export interface VisualInput {
  scenario: ExecutionFlowScenario;
  routes: ReadonlyArray<readonly RouteHop[] | null>;
  edges: readonly RoutingEdge[];
  nodeIds: readonly string[];
  state: { stepIndex: number; phase: EnginePhase; hopIndex: number };
}

/**
 * Qué aspecto tiene cada nodo y arista en el instante actual. Es una función pura:
 * se recalcula solo cuando cambia el paso, la fase o el salto, no en cada fotograma.
 *
 * - `active`: el nodo del paso en curso (solo mientras el paso se "procesa"). En aristas: la ruta por la
 *   que sale el dato del paso en curso (o el salto en curso durante un viaje).
 * - `done`: nodos de pasos ya terminados (y el paso del que se está saliendo durante un viaje).
 * - `upcoming`: participan en el escenario pero aún no les toca.
 * - `off`: no participan en el escenario (se atenúan).
 */
export function deriveVisuals(input: VisualInput): SimVisuals {
  const { scenario, routes, edges, nodeIds, state } = input;
  const { steps } = scenario;
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  const participants = new Set<string>(steps.map((step) => step.nodeId));
  const scenarioEdges = new Set<string>();
  for (const route of routes) {
    if (!route) continue;
    for (const hop of route) {
      scenarioEdges.add(hop.edgeId);
      const edge = edgeById.get(hop.edgeId);
      if (edge) {
        participants.add(edge.source);
        participants.add(edge.target);
      }
    }
  }

  const done = new Set<string>();
  for (let index = 0; index < state.stepIndex; index += 1) {
    const step = steps[index];
    if (step) done.add(step.nodeId);
  }
  const current = steps[state.stepIndex]?.nodeId ?? null;
  if (state.phase !== "process" && current) done.add(current);
  const active = state.phase === "process" ? current : null;

  const nodeStatus: Record<string, NodeSimStatus> = {};
  for (const id of nodeIds) {
    if (id === active) nodeStatus[id] = "active";
    else if (done.has(id)) nodeStatus[id] = "done";
    else if (participants.has(id)) nodeStatus[id] = "upcoming";
    else nodeStatus[id] = "off";
  }

  const edgeStatus: Record<string, EdgeSimStatus> = {};
  const edgeReversed: Record<string, true> = {};
  let labelEdgeId: string | null = null;
  const activate = (hop: RouteHop): void => {
    edgeStatus[hop.edgeId] = "active";
    if (hop.reversed) edgeReversed[hop.edgeId] = true;
    labelEdgeId ??= hop.edgeId;
  };

  for (const edge of edges) {
    if (!scenarioEdges.has(edge.id)) edgeStatus[edge.id] = "off";
  }
  for (let index = 0; index < state.stepIndex; index += 1) {
    for (const hop of routes[index] ?? []) edgeStatus[hop.edgeId] = "done";
  }
  const route = routes[state.stepIndex] ?? [];
  if (state.phase === "travel") {
    route.forEach((hop, hopIndex) => {
      if (hopIndex < state.hopIndex) edgeStatus[hop.edgeId] = "done";
    });
    const hop = route[state.hopIndex];
    if (hop) activate(hop);
  } else if (state.phase === "process") {
    route.forEach(activate);
  }

  return { nodeStatus, edgeStatus, edgeReversed, labelEdgeId };
}

/**
 * Resaltado al pasar el ratón por una tarjeta, antes de arrancar la simulación.
 * Los nodos y aristas del recorrido quedan en `preview`; el resto, en `off`.
 */
export function derivePreview(
  scenario: ExecutionFlowScenario,
  edges: readonly RoutingEdge[],
  nodeIds: readonly string[],
): Pick<SimVisuals, "nodeStatus" | "edgeStatus"> {
  const routes = resolveScenarioRoutes(scenario.steps, edges);
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const participants = new Set<string>(scenario.steps.map((step) => step.nodeId));
  participants.add(scenario.entryNodeId);
  const scenarioEdges = new Set<string>();

  for (const route of routes) {
    if (!route) continue;
    for (const hop of route) {
      scenarioEdges.add(hop.edgeId);
      const edge = edgeById.get(hop.edgeId);
      if (edge) {
        participants.add(edge.source);
        participants.add(edge.target);
      }
    }
  }

  const nodeStatus: Record<string, NodeSimStatus> = {};
  for (const id of nodeIds) nodeStatus[id] = participants.has(id) ? "preview" : "off";

  const edgeStatus: Record<string, EdgeSimStatus> = {};
  for (const edge of edges) edgeStatus[edge.id] = scenarioEdges.has(edge.id) ? "preview" : "off";

  return { nodeStatus, edgeStatus };
}

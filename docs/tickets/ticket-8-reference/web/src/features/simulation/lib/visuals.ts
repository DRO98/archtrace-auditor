import type { ExecutionFlowScenario } from "@core/simulation";
import type { EnginePhase } from "./engine";
import type { RouteHop, RoutingEdge } from "./route";

export type NodeSimStatus = "active" | "done" | "upcoming" | "off";
export type EdgeSimStatus = "active" | "done" | "off";

export interface SimVisuals {
  /** Un valor por cada nodo del grafo. */
  nodeStatus: Record<string, NodeSimStatus>;
  /** Solo aristas con estado: `off` (ajenas al escenario), `done` o `active`. Las que faltan se ven normales. */
  edgeStatus: Record<string, EdgeSimStatus>;
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
 * - `active`: el nodo del paso en curso (solo mientras el paso se "procesa").
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
  for (const edge of edges) {
    if (!scenarioEdges.has(edge.id)) edgeStatus[edge.id] = "off";
  }
  for (let index = 0; index < state.stepIndex; index += 1) {
    for (const hop of routes[index] ?? []) edgeStatus[hop.edgeId] = "done";
  }
  if (state.phase === "travel") {
    const route = routes[state.stepIndex] ?? [];
    route.forEach((hop, hopIndex) => {
      if (hopIndex < state.hopIndex) edgeStatus[hop.edgeId] = "done";
    });
    const hop = route[state.hopIndex];
    if (hop) edgeStatus[hop.edgeId] = "active";
  }

  return { nodeStatus, edgeStatus };
}

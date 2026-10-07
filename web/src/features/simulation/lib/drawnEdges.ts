import type { CodeGraph } from "@core/graph";
import { layeredFlow } from "../../canvas/lib/flow";
import { layoutLayered } from "../../canvas/lib/layout";
import { prepareGraph } from "../../canvas/lib/subsystems";
import type { RoutingEdge } from "./route";

/** Aristas tal como se dibujan (ya orientadas) y el grafo visible (sin módulos ocultos). */
export function drawnGraph(graph: CodeGraph): { graph: CodeGraph; edges: RoutingEdge[] } {
  const prepared = prepareGraph(graph);
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  return {
    graph: prepared.graph,
    edges: flow.edges.map(({ id, source, target }) => ({ id, source, target })),
  };
}

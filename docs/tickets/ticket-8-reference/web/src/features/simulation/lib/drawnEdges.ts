import type { CodeGraph } from "@core/graph";
import { layeredFlow } from "../../canvas/lib/flow";
import { layoutLayered } from "../../canvas/lib/layout";
import { prepareGraph } from "../../canvas/lib/subsystems";
import type { RoutingEdge } from "./route";

/**
 * El grafo y las aristas TAL COMO SE DIBUJAN en el lienzo por capas:
 * - `graph`: solo los módulos visibles (`prepareGraph` oculta los aislados y promueve a tarjeta
 *   los sub-nodos que quedan en una capa anterior a su padre).
 * - `edges`: las aristas de `layeredFlow`, ya orientadas en el sentido del flujo. Los ids no cambian,
 *   pero `source`/`target` pueden estar invertidos respecto al import real (p. ej.
 *   `imports:src/rag/pipeline.py:src/rag/embeddings.py` se dibuja embeddings → pipeline).
 *
 * Los escenarios se validan y se enrutan contra esto, NO contra `graph.edges` ni contra `graphToFlow`.
 */
export function drawnGraph(graph: CodeGraph): { graph: CodeGraph; edges: RoutingEdge[] } {
  const prepared = prepareGraph(graph);
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  return {
    graph: prepared.graph,
    edges: flow.edges.map(({ id, source, target }) => ({ id, source, target })),
  };
}

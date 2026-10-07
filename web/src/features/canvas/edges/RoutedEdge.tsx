import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { EdgePacket } from "@/features/simulation/components/EdgePacket";
import { simEdgeStyle } from "@/features/simulation/components/simEdgeStyle";
import { useSimStore } from "@/features/simulation/store";
import { usePlaygroundStore } from "@/features/playground/store";
import { SupportEdge } from "./SupportEdge";
import { SystemEdge } from "./SystemEdge";
import { routedPath, type RoutedEdgeData } from "./path";
import { EDGE_STYLE } from "../theme";

export type { RoutedEdgeData } from "./path";
export { routedPath } from "./path";
export type RoutedFlowEdge = Edge<RoutedEdgeData, "routed">;

function RoutedEdgeComponent(props: EdgeProps<RoutedFlowEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style,
    markerEnd,
    markerStart,
    interactionWidth,
  } = props;
  // La traza del playground manda sobre la simulación mientras está en pantalla.
  const tracing = usePlaygroundStore((state) => state.status !== "idle");
  const traced = usePlaygroundStore((state) => state.edgeStatus[id]);
  const simulated = useSimStore((state) => state.edgeStatus[id] ?? state.previewEdgeStatus[id]);
  const simReversed = useSimStore((state) => state.edgeReversed[id] === true);
  const status = tracing ? traced : simulated;
  const reversed = !tracing && simReversed;
  const routed = routedPath({ x: sourceX, y: sourceY }, data?.points ?? [], { x: targetX, y: targetY });
  // Sin ruta calculada se dibuja en ángulos rectos con los codos a mitad de camino.
  const [fallback] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: EDGE_STYLE.cornerRadius });
  const path = routed ?? fallback;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
        style={simEdgeStyle(style, status, reversed)}
      />
      <EdgePacket edgeId={id} path={path} />
    </>
  );
}

export const RoutedEdge = memo(RoutedEdgeComponent);

export const edgeTypes = { routed: RoutedEdge, support: SupportEdge, system: SystemEdge };

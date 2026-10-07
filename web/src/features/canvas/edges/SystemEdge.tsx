import { memo } from "react";
import { BaseEdge, getSmoothStepPath, getStraightPath, type Edge, type EdgeProps } from "@xyflow/react";
import { EdgePacket } from "@/features/simulation/components/EdgePacket";
import { simEdgeStyle } from "@/features/simulation/components/simEdgeStyle";
import { useSimStore } from "@/features/simulation/store";
import { routedPath } from "./path";
import type { RoutedEdgeData } from "./path";
import { EDGE_STYLE } from "../theme";

export type SystemFlowEdge = Edge<RoutedEdgeData, "system">;

/**
 * Arista del mapa de sistema (Level 0): recta si hay tiro libre; si no, polilínea ortogonal que esquiva
 * otras tarjetas (`data.points` de `routeSystemEdges`). Se ilumina con «Simular flujo».
 */
function SystemEdgeComponent(props: EdgeProps<SystemFlowEdge>) {
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
    label,
    labelStyle,
    labelBgStyle,
    interactionWidth,
  } = props;
  const status = useSimStore((state) => state.edgeStatus[id] ?? state.previewEdgeStatus[id]);
  const reversed = useSimStore((state) => state.edgeReversed[id] === true);
  const points = data?.points ?? [];
  const routed = routedPath({ x: sourceX, y: sourceY }, points, { x: targetX, y: targetY });
  const [fallback, labelX, labelY] =
    points.length <= 2
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: EDGE_STYLE.cornerRadius,
        });
  const path = routed ?? fallback;
  const mid =
    points.length >= 2
      ? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 }
      : { x: labelX, y: labelY };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={simEdgeStyle(style, status, reversed)}
        label={label}
        labelX={mid.x}
        labelY={mid.y}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
      />
      <EdgePacket edgeId={id} path={path} />
    </>
  );
}

export const SystemEdge = memo(SystemEdgeComponent);

import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { EdgePacket } from "@/features/simulation/components/EdgePacket";
import { simEdgeStyle } from "@/features/simulation/components/simEdgeStyle";
import { useSimStore } from "@/features/simulation/store";

/** Arista discontinua padre → sub-nodo de apoyo (antes `smoothstep`). Admite el paquete de la simulación. */
function SupportEdgeComponent(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style } = props;
  const sim = useSimStore((state) => state.edgeStatus[id]);
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={simEdgeStyle(style, sim)} />
      <EdgePacket edgeId={id} path={path} />
    </>
  );
}

export const SupportEdge = memo(SupportEdgeComponent);

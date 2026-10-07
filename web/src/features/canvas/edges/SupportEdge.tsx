import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { EdgePacket } from "@/features/simulation/components/EdgePacket";
import { simEdgeStyle } from "@/features/simulation/components/simEdgeStyle";
import { useSimStore } from "@/features/simulation/store";
import { usePlaygroundStore } from "@/features/playground/store";
import { EDGE_STYLE } from "../theme";

/** Arista discontinua padre → sub-nodo de apoyo (antes `smoothstep`). Admite la etiqueta de la simulación. */
function SupportEdgeComponent(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style } = props;
  // La traza del playground manda sobre la simulación mientras está en pantalla.
  const tracing = usePlaygroundStore((state) => state.status !== "idle");
  const traced = usePlaygroundStore((state) => state.edgeStatus[id]);
  const simulated = useSimStore((state) => state.edgeStatus[id] ?? state.previewEdgeStatus[id]);
  const simReversed = useSimStore((state) => state.edgeReversed[id] === true);
  const sim = tracing ? traced : simulated;
  const reversed = !tracing && simReversed;
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: EDGE_STYLE.cornerRadius });
  return (
    <>
      <BaseEdge id={id} path={path} style={simEdgeStyle(style, sim, reversed)} />
      <EdgePacket edgeId={id} path={path} />
    </>
  );
}

export const SupportEdge = memo(SupportEdgeComponent);

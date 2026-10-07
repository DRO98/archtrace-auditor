"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { EdgeLabelRenderer } from "@xyflow/react";
import { useSimStore } from "../store";

/**
 * Etiqueta con el dato que sale del paso actual, fija a mitad de la primera arista activa.
 * El movimiento lo da el trazo discontinuo de la propia arista (`simEdgeStyle`), no un punto que la recorre.
 *
 * `path` es el mismo trazado que dibuja la arista: se mide para anclar la etiqueta a su punto medio.
 */
export function EdgePacket({ edgeId, path }: { edgeId: string; path: string }) {
  const shown = useSimStore((state) => state.packetEdgeId === edgeId && state.packetLabel !== "");
  const label = useSimStore((state) => state.packetLabel);
  const pathRef = useRef<SVGPathElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const measure = pathRef.current;
    if (!shown || !measure) return;
    const mid = measure.getPointAtLength(measure.getTotalLength() / 2);
    setPoint({ x: mid.x, y: mid.y });
  }, [shown, path]);

  if (!shown) return null;

  return (
    <>
      <path ref={pathRef} d={path} fill="none" stroke="none" pointerEvents="none" />
      {point ? (
        <EdgeLabelRenderer>
          <div
            title={label}
            style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
            className="nodrag nopan pointer-events-auto absolute left-0 top-0 max-w-[120px] truncate rounded-full bg-flow px-2 py-0.5 font-mono text-[10px] font-medium text-white shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

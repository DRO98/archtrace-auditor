"use client";

import { useEffect, useRef } from "react";
import { EdgeLabelRenderer } from "@xyflow/react";
import { getSimFrame, subscribeSimFrame, useSimStore } from "../store";

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/**
 * Paquete de datos que recorre UNA arista. Solo se monta en la arista activa, así que
 * los ~60 repintados por segundo son un círculo SVG y una etiqueta, movidos a mano
 * (sin pasar por React) a partir del fotograma del motor.
 *
 * `path` es el mismo trazado que dibuja la arista: así el paquete sigue exactamente la línea.
 */
export function EdgePacket({ edgeId, path }: { edgeId: string; path: string }) {
  const active = useSimStore((state) => state.edgeStatus[edgeId] === "active");
  const label = useSimStore((state) => state.packetLabel);
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const update = (): void => {
      const measure = pathRef.current;
      const frame = getSimFrame();
      if (!measure || frame.edgeId !== edgeId) return;
      const length = measure.getTotalLength();
      const eased = easeInOut(frame.progress);
      const point = measure.getPointAtLength((frame.reversed ? 1 - eased : eased) * length);
      dotRef.current?.setAttribute("cx", String(point.x));
      dotRef.current?.setAttribute("cy", String(point.y));
      if (chipRef.current) {
        chipRef.current.style.transform = `translate(-50%, -160%) translate(${point.x}px, ${point.y}px)`;
        chipRef.current.style.opacity = "1";
      }
    };
    update();
    return subscribeSimFrame(update);
  }, [active, edgeId, path]);

  if (!active) return null;

  return (
    <>
      <path ref={pathRef} d={path} fill="none" stroke="none" pointerEvents="none" />
      <circle
        ref={dotRef}
        r={7}
        className="fill-flow stroke-white"
        strokeWidth={2}
        pointerEvents="none"
        style={{ filter: "drop-shadow(0 0 6px rgba(124, 58, 237, 0.55))" }}
      />
      <EdgeLabelRenderer>
        <div
          ref={chipRef}
          style={{ opacity: 0 }}
          className="nodrag nopan pointer-events-none absolute left-0 top-0 max-w-56 truncate rounded-full bg-flow px-2.5 py-1 font-mono text-[11px] font-medium text-white shadow-md"
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

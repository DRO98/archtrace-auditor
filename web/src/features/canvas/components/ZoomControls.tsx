"use client";

import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { Eraser, Maximize2, Minus, Plus } from "lucide-react";
import { useMotionDuration } from "@/lib/motion";
import { clearHighlights } from "../lib/actions";
import { FIT_VIEW_OPTIONS, MINIMAP_HEIGHT, PANEL_MARGIN } from "../theme";

const BUTTON =
  "grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const percent = useStore((s) => Math.round(s.transform[2] * 100));
  const duration = useMotionDuration(200);

  return (
    <Panel
      position="bottom-left"
      style={{ marginBottom: PANEL_MARGIN + MINIMAP_HEIGHT + 10 }}
      className="flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-md"
    >
      <button type="button" className={BUTTON} title="Alejar" aria-label="Alejar" onClick={() => void zoomOut({ duration })}>
        <Minus className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="h-8 min-w-12 rounded-lg px-1 text-xs font-medium tabular-nums text-ink-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent"
        title="Restablecer zoom"
        onClick={() => void zoomTo(1, { duration })}
      >
        {percent}%
      </button>
      <button type="button" className={BUTTON} title="Acercar" aria-label="Acercar" onClick={() => void zoomIn({ duration })}>
        <Plus className="size-4" aria-hidden />
      </button>
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <button
        type="button"
        className={BUTTON}
        title="Centrar vista"
        aria-label="Centrar vista"
        onClick={() => void fitView({ ...FIT_VIEW_OPTIONS, duration })}
      >
        <Maximize2 className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={BUTTON}
        title="Limpiar resaltado (Esc)"
        aria-label="Limpiar resaltado"
        onClick={clearHighlights}
      >
        <Eraser className="size-4" aria-hidden />
      </button>
    </Panel>
  );
}

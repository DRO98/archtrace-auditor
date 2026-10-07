"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { Crosshair, X } from "lucide-react";
import { fitNode } from "@/features/canvas/lib/fitNode";
import { useCanvasStore } from "@/features/canvas/store";
import { FIT_VIEW_OPTIONS } from "@/features/canvas/theme";
import { useMotionDuration } from "@/lib/motion";
import { exitPresentation } from "./ShareButtons";

/**
 * Barra flotante del modo presentación: proyecto, nodo en foco y salida. Además encuadra el nodo
 * seleccionado cada vez que cambia (o todo el diagrama si no hay selección).
 */
export function PresentationBar({ projectName }: { projectName: string }) {
  const { fitView } = useReactFlow();
  const duration = useMotionDuration(800);
  const selectedModuleId = useCanvasStore((state) => state.selectedModuleId);
  const label = useCanvasStore((state) =>
    state.selectedModuleId ? state.indexes?.modulesById.get(state.selectedModuleId)?.label ?? null : null,
  );

  useEffect(() => {
    // Un frame de margen: al entrar, el lienzo acaba de ganar el ancho de los paneles ocultos.
    const frame = requestAnimationFrame(() => {
      if (selectedModuleId) {
        fitNode(fitView, selectedModuleId, duration);
        useCanvasStore.getState().spotlight(selectedModuleId);
      } else void fitView({ ...FIT_VIEW_OPTIONS, duration });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedModuleId, fitView, duration]);

  // Salir de pantalla completa (Esc del navegador) también sale del modo presentación.
  useEffect(() => {
    let wasFullscreen = Boolean(document.fullscreenElement);
    function onChange(): void {
      const now = Boolean(document.fullscreenElement);
      if (wasFullscreen && !now) useCanvasStore.getState().setPresentation(false);
      wasFullscreen = now;
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-4 rounded-2xl border border-line bg-white/95 px-5 py-2.5 shadow-lg backdrop-blur">
        <span className="truncate text-lg font-semibold text-ink">{projectName}</span>
        {label ? (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-base font-medium text-teal-700">
            <Crosshair className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
        ) : (
          <span className="hidden text-sm text-ink-3 sm:inline">Haz clic en un componente para enfocarlo</span>
        )}
        <button
          type="button"
          onClick={exitPresentation}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-neutral-100 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
          Salir <kbd className="font-mono text-xs text-ink-3">Esc</kbd>
        </button>
      </div>
    </div>
  );
}

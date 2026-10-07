"use client";

import { Zap } from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import { HEADER_BUTTON_PRIMARY } from "@/features/canvas/theme";
import { cn } from "@/lib/cn";
import { yieldCanvasToPlayground } from "../hooks/usePlaygroundTrace";
import { usePlaygroundStore } from "../store";

/** Botón "Probar en vivo" de la cabecera: abre o cierra el panel del playground. */
export function PlaygroundButton() {
  const open = usePlaygroundStore((state) => state.open);
  const running = usePlaygroundStore((state) => state.status === "running");
  // En el mapa de sistema no hay archivos que trazar: la prueba en vivo se lanza dentro de un servicio.
  const systemMap = useCanvasStore((state) => state.systemMapShown);
  const disabled = systemMap && !open;

  return (
    <button
      type="button"
      aria-expanded={open}
      disabled={disabled}
      title={disabled ? "Entra en un servicio para probar" : "Lanzar una consulta RAG real y ver su recorrido por la arquitectura"}
      onClick={() => {
        if (!open) yieldCanvasToPlayground();
        usePlaygroundStore.getState().setOpen(!open);
      }}
      className={cn(HEADER_BUTTON_PRIMARY, (open || running) && "ring-2 ring-teal-300 ring-offset-1")}
    >
      <Zap className={cn("size-4", running && "animate-pulse")} aria-hidden />
      Probar en vivo
    </button>
  );
}

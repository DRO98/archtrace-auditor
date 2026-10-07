"use client";

import { AlertTriangle, StickyNote } from "lucide-react";
import { useGitDiff } from "@/features/diff/store";
import type { NodeDiffStatus } from "@/features/diff/lib/gitDiff";
import { describeBreach } from "@/features/health/lib/sla";
import { useHealth } from "@/features/health/store";
import { cn } from "@/lib/cn";
import { useCanvasEdits } from "../edit/store";

/** Anillo del diff visual: añadido verde, modificado amarillo, eliminado rojo. */
export const DIFF_RING: Readonly<Record<NodeDiffStatus, string>> = {
  added: "ring-4 ring-emerald-500",
  modified: "ring-4 ring-amber-400",
  deleted: "ring-4 ring-rose-500 opacity-70",
};

const DIFF_BADGE: Readonly<Record<NodeDiffStatus, { label: string; className: string }>> = {
  added: { label: "Añadido", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  modified: { label: "Modificado", className: "border-amber-200 bg-amber-50 text-amber-800" },
  deleted: { label: "Eliminado", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

/** Estado del diff del nodo, solo mientras el diff está activo. */
export function useNodeDiff(id: string): NodeDiffStatus | undefined {
  return useGitDiff((state) => (state.active ? state.diff?.byNode[id] : undefined));
}

/** true si el nodo incumple el SLA según el Tracing Log. */
export function useNodeSlaBreach(id: string): boolean {
  return useHealth((state) => state.slaByNode[id] !== undefined);
}

/**
 * Indicadores de gobernanza sobre un nodo: estado en el diff de git, alerta de SLA (latencia > 1000 ms o
 * errores > 1 % en el Tracing Log) y número de notas de arquitectura.
 */
export function NodeOverlays({ id, compact = false }: { id: string; compact?: boolean }) {
  const diff = useNodeDiff(id);
  const sla = useHealth((state) => state.slaByNode[id]);
  const notes = useCanvasEdits((state) => state.notes[id]?.length ?? 0);

  return (
    <>
      {diff ? (
        <span
          className={cn(
            "pointer-events-none absolute -top-3 right-3 z-10 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            DIFF_BADGE[diff].className,
            compact && "right-0",
          )}
        >
          {DIFF_BADGE[diff].label}
        </span>
      ) : null}
      {sla ? (
        <span
          role="img"
          aria-label={`Alerta de SLA: ${describeBreach(sla)}`}
          title={`SLA: ${describeBreach(sla)}`}
          className={cn(
            "absolute -right-2.5 -top-2.5 z-10 grid size-6 place-items-center rounded-full text-white shadow ring-2 ring-white",
            sla.breaches.includes("errors") ? "bg-rose-600" : "bg-amber-500",
            !compact && "animate-pulse motion-reduce:animate-none",
          )}
        >
          <AlertTriangle className="size-3.5" aria-hidden />
        </span>
      ) : null}
      {notes > 0 ? (
        <span
          title={`${notes} ${notes === 1 ? "nota" : "notas"} de arquitectura · clic derecho para verlas`}
          className="absolute -right-2.5 top-7 z-10 inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border border-yellow-300 bg-yellow-100 px-1 text-[10px] font-semibold text-yellow-800 shadow-sm"
        >
          <StickyNote className="size-3" aria-hidden />
          {notes}
        </span>
      ) : null}
    </>
  );
}

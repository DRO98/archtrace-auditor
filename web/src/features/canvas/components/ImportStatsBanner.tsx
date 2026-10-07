"use client";

import { useState } from "react";
import { AlertTriangle, FileCode2, ScanSearch, X } from "lucide-react";
import { checkCopy } from "@/features/health/ArchitectureCheckPanel";
import { useHealth } from "@/features/health/store";
import { MAX_FILES } from "@/lib/github/importRepo";
import { cn } from "@/lib/cn";
import type { MemorySourceMeta } from "../lib/memoryGraphs";
import { useCanvasStore } from "../store";

/**
 * Qué parte del repo importado cubre el mapa. Si se quedaron fuentes fuera (tope de archivos,
 * tamaño o árbol truncado por GitHub), se dice claramente: el mapa no debe parecer más completo de lo que es.
 * También es la puerta al Architecture Check: tras importar, el siguiente paso es ver los hallazgos.
 */
export function ImportStatsBanner({ meta }: { meta: MemorySourceMeta }) {
  const [open, setOpen] = useState(true);
  const serious = useHealth((state) => state.findings.filter((item) => item.severity === "high" || item.severity === "medium").length);
  const omitted = useCanvasStore((state) => state.graph?.omitted?.count ?? 0);
  if (!open || meta.analyzed === undefined) return null;
  const overLimit = Math.max(0, (meta.skipped ?? 0) - (meta.tooLarge ?? 0));
  const tooLarge = meta.tooLarge ?? 0;
  const parts = meta.parts;
  const missingParts = parts ? parts.total - parts.included : 0;
  const partial = overLimit > 0 || tooLarge > 0 || meta.truncatedTree === true || missingParts > 0;
  const Icon = partial ? AlertTriangle : FileCode2;

  return (
    <section
      aria-label="Cobertura del import"
      className={cn(
        "w-full rounded-xl border bg-white/95 p-3 text-xs shadow-lg backdrop-blur",
        partial ? "border-amber-200 dark:border-amber-800" : "border-line",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", partial ? "text-amber-600" : "text-ink-3")} aria-hidden />
        <div className="min-w-0 flex-1 text-ink-2">
          <p className="font-semibold text-ink">
            {meta.analyzed} archivos analizados{partial ? " · mapa parcial" : ""}
          </p>
          {overLimit > 0 ? (
            <p className="mt-0.5">
              {overLimit} fuentes quedaron fuera del tope de {MAX_FILES}; se priorizaron entrypoints y carpetas de código.
            </p>
          ) : null}
          {parts && parts.total > 1 ? (
            <p className="mt-0.5">
              {missingParts > 0
                ? `${parts.included} de ${parts.total} carpetas de primer nivel entraron en el análisis.`
                : `Las ${parts.total} carpetas de primer nivel están representadas.`}
              {meta.context ? ` Infraestructura y nombres de las partes leídos de ${meta.context} archivo${meta.context === 1 ? "" : "s"} (compose, README).` : ""}
            </p>
          ) : null}
          {omitted > 0 ? (
            <p className="mt-0.5">
              Omitidos {omitted} archivo{omitted === 1 ? "" : "s"} sin rol en el mapa (tests, <span className="font-mono">__init__</span>,
              configuración, sin dependencias). Siguen en el repo.
            </p>
          ) : null}
          {tooLarge > 0 ? <p className="mt-0.5">{tooLarge} archivos demasiado grandes no se analizaron.</p> : null}
          {meta.truncatedTree ? <p className="mt-0.5">GitHub devolvió el árbol truncado: puede haber fuentes que no se llegaron a ver.</p> : null}
          <button
            type="button"
            onClick={() => useCanvasStore.getState().setPopover("check")}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-medium text-ink hover:bg-neutral-100"
          >
            <ScanSearch className="size-3.5" aria-hidden />
            {checkCopy().run(serious)}
          </button>
        </div>
        <button
          type="button"
          aria-label="Ocultar cobertura del import"
          onClick={() => setOpen(false)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-neutral-100 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </section>
  );
}

"use client";

import { catchError, type ErrorInfo } from "next/error";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";

interface FallbackProps {
  /** Qué parte de la app falló ("el lienzo", "el panel"): el resto sigue usable. */
  title: string;
  className?: string;
}

function SectionErrorFallback({ title, className }: FallbackProps, { error, reset }: ErrorInfo) {
  return (
    <div role="alert" className={cn("flex h-full items-center justify-center p-6", className)}>
      <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-4 shadow-md">
        <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          No se pudo mostrar {title}
        </p>
        <p className="mt-2 break-words font-mono text-xs text-ink-2">{error instanceof Error && error.message ? error.message : "Error desconocido"}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reintentar
        </button>
      </div>
    </div>
  );
}

/** Límite de error por sección: un fallo en el lienzo no se lleva por delante el panel ni la cabecera. */
export const SectionErrorBoundary = catchError(SectionErrorFallback);

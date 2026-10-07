"use client";

import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Lock } from "lucide-react";
import { DEMOS, demoByGraph } from "@/features/demos";
import { cn } from "@/lib/cn";
import { useCanvasEdits } from "../edit/store";
import { ARCHITECTURE_KINDS, ARCHITECTURE_KIND_INFO, type ArchitectureKind } from "../lib/architectureKind";
import { navigateToGraph } from "../lib/graphName";
import { useCanvasStore } from "../store";
import { useArchitectureKind } from "../lib/useArchitectureKind";

const OPTION =
  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-teal-500";

/**
 * Ejemplos de arquitectura (abren el pipeline de ejemplo) y, debajo, el estado de solo lectura del pipeline actual:
 * qué tipo se detecta. Ese tipo no cambia el grafo: solo decide el perfil de "Probar / Simular" y la plantilla de
 * "Exportar código". En una demo lo fija la demo; en un grafo real se puede cambiar a mano (se guarda con el proyecto).
 */
export function ArchitectureKindPanel() {
  const current = useCanvasEdits((state) => state.graphName);
  const isDemo = current !== null && demoByGraph(current) !== null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 p-2">
      <ul className="flex flex-col">
        {DEMOS.map((demo) => (
          <li key={demo.graphName}>
            <button
              type="button"
              onClick={() => {
                useCanvasStore.getState().setPopover(null);
                navigateToGraph(demo.graphName);
              }}
              aria-current={demo.graphName === current ? "page" : undefined}
              className={cn(OPTION, "items-center", demo.graphName === current && "bg-teal-50")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{demo.title}</span>
                <span className="block truncate text-xs text-ink-3">{demo.tagline}</span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="my-1 border-t border-line" />
      <PipelineKindStatus isDemo={isDemo} />
    </div>
  );
}

/** Solo lectura: cómo se detecta este pipeline y para qué sirve. El override vive plegado y solo en grafos reales. */
function PipelineKindStatus({ isDemo }: { isDemo: boolean }) {
  const { kind, manual } = useArchitectureKind();
  const [open, setOpen] = useState(manual);

  return (
    <div className="flex flex-col gap-1">
      <div className="mx-0.5 flex flex-col gap-0.5 rounded-lg bg-neutral-50 px-2.5 py-2">
        <p className="text-xs text-ink-2">
          {manual ? "Perfil de prueba fijado a mano:" : "Este pipeline se detecta como:"}{" "}
          <span className="font-semibold text-ink">{ARCHITECTURE_KIND_INFO[kind].label}</span>
        </p>
        <p className="text-[11px] text-ink-3">Sirve para «Probar / Simular» y «Exportar código»; no cambia el grafo.</p>
        {isDemo ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
            <Lock className="size-3 shrink-0" aria-hidden />
            Fijo por la demo.
          </p>
        ) : null}
      </div>
      {isDemo ? null : (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-1 self-start rounded px-2.5 py-1 text-[11px] text-ink-2 hover:bg-neutral-100 hover:text-ink"
          >
            Cambiar perfil de prueba…
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open ? <TestProfileChooser /> : null}
        </>
      )}
    </div>
  );
}

function TestProfileChooser() {
  const { kind, detected, manual } = useArchitectureKind();
  const choose = (next: ArchitectureKind | null): void => useCanvasEdits.getState().setArchitectureKind(next);

  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label="Perfil de prueba">
      <button type="button" role="radio" aria-checked={!manual} onClick={() => choose(null)} className={OPTION}>
        <span className="grid size-4 shrink-0 place-items-center pt-0.5">{manual ? null : <Check className="size-4 text-teal-700" aria-hidden />}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">Automático</span>
          <span className="block text-xs text-ink-3">Detectado: {ARCHITECTURE_KIND_INFO[detected].label}</span>
        </span>
      </button>
      <div className="my-1 border-t border-line" />
      {ARCHITECTURE_KINDS.map((item) => {
        const selected = manual && kind === item;
        return (
          <button key={item} type="button" role="radio" aria-checked={selected} onClick={() => choose(item)} className={cn(OPTION, selected && "bg-teal-50")}>
            <span className="grid size-4 shrink-0 place-items-center pt-0.5">{selected ? <Check className="size-4 text-teal-700" aria-hidden /> : null}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{ARCHITECTURE_KIND_INFO[item].label}</span>
              <span className="block text-xs text-ink-3">{ARCHITECTURE_KIND_INFO[item].description}</span>
            </span>
          </button>
        );
      })}
      <p className="px-2.5 pt-1 text-[11px] text-ink-3">Fija el perfil por defecto de «Probar / Simular» y la plantilla de «Exportar código».</p>
    </div>
  );
}

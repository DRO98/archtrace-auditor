"use client";

import { useState } from "react";
import { FlaskConical, Play, X, Zap } from "lucide-react";
import { yieldCanvasToPlayground } from "@/features/playground/hooks/usePlaygroundTrace";
import { usePlaygroundStore } from "@/features/playground/store";
import { startSimulation } from "@/features/simulation/lib/actions";
import { useSimStore } from "@/features/simulation/store";
import { exitDemo } from "../lib/navigation";
import type { DemoDefinition } from "../types";

/** Aviso flotante de demo: qué se está viendo y los dos siguientes pasos (simular y probar), sin API key. */
export function DemoBanner({ demo }: { demo: DemoDefinition }) {
  const [open, setOpen] = useState(true);
  const hasScenarios = useSimStore((state) => state.scenarios.length > 0);
  const simulating = useSimStore((state) => state.activeScenarioId !== null);
  const playgroundOpen = usePlaygroundStore((state) => state.open);
  if (!open || simulating || playgroundOpen) return null;

  return (
    <section
      aria-label={`Demo: ${demo.title}`}
      className="w-full overflow-hidden rounded-xl border border-teal-200 bg-white/95 shadow-lg shadow-teal-500/10 backdrop-blur dark:border-teal-800"
    >
      <div className="bg-linear-to-r from-teal-500/10 to-teal-500/10 p-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-600 text-white shadow-sm" aria-hidden>
            <FlaskConical className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">Demo en vivo</p>
            <h2 className="text-sm font-semibold text-ink">{demo.title}</h2>
            <p className="mt-0.5 text-xs text-ink-2">
              {demo.tagline}. Datos simulados: explora, simula y prueba sin configurar ninguna API key.
            </p>
          </div>
          <button
            type="button"
            aria-label="Ocultar aviso de demo"
            onClick={() => setOpen(false)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-teal-100 hover:text-teal-800"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasScenarios}
            onClick={() => startSimulation()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50"
          >
            <Play className="size-3.5" aria-hidden />
            Simular flujo
          </button>
          <button
            type="button"
            onClick={() => {
              yieldCanvasToPlayground();
              usePlaygroundStore.getState().setOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <Zap className="size-3.5" aria-hidden />
            Probar en vivo
          </button>
          <button
            type="button"
            onClick={exitDemo}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 hover:text-teal-900"
          >
            Salir de la demo
          </button>
        </div>
      </div>
    </section>
  );
}

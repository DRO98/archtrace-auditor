"use client";

import { Play, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { startSimulation, stopSimulation } from "../lib/actions";
import { useSimStore } from "../store";

/** Botón "Simular flujo" de la cabecera. Desactivado si el proyecto no tiene escenarios. */
export function SimulateButton() {
  const count = useSimStore((state) => state.scenarios.length);
  const error = useSimStore((state) => state.scenarioError);
  const active = useSimStore((state) => state.activeScenarioId !== null);
  const disabled = count === 0;

  const title = active
    ? "Detener la simulación"
    : disabled
      ? (error ?? "Este proyecto no tiene escenarios de simulación")
      : "Ver cómo viajan los datos por la arquitectura";

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={() => (active ? stopSimulation() : startSimulation())}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
          : "border-line text-ink-2 hover:bg-neutral-100 hover:text-ink",
      )}
    >
      {active ? <Square className="size-3.5" aria-hidden /> : <Play className="size-4" aria-hidden />}
      {active ? "Detener simulación" : "Simular flujo"}
    </button>
  );
}

"use client";

import { Play, Square } from "lucide-react";
import { HEADER_BUTTON_ACTIVE, HEADER_BUTTON_SECONDARY } from "@/features/canvas/theme";
import { useCanvasStore } from "@/features/canvas/store";
import { startSimulation, stopSimulation } from "../lib/actions";
import { useSimStore } from "../store";

/** Botón "Simular flujo". Con varios escenarios abre la pestaña Flujo para elegir; con uno solo arranca. */
export function SimulateButton() {
  const count = useSimStore((state) => state.scenarios.length);
  const error = useSimStore((state) => state.scenarioError);
  const active = useSimStore((state) => state.activeScenarioId !== null);
  const disabled = count === 0;

  const title = active
    ? "Detener la simulación"
    : disabled
      ? (error ?? "Este proyecto no tiene escenarios de simulación")
      : count > 1
        ? "Elegir un recorrido de datos"
        : "Ver cómo viajan los datos por la arquitectura";

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={() => {
        if (active) {
          stopSimulation();
          return;
        }
        if (count > 1) {
          const canvas = useCanvasStore.getState();
          canvas.setView("architecture");
          canvas.openDrawer(null, "flow");
          return;
        }
        startSimulation();
      }}
      className={active ? HEADER_BUTTON_ACTIVE : HEADER_BUTTON_SECONDARY}
    >
      {active ? <Square className="size-3.5" aria-hidden /> : <Play className="size-4" aria-hidden />}
      {active ? "Detener simulación" : count > 1 ? "Elegir flujo" : "Simular flujo"}
    </button>
  );
}

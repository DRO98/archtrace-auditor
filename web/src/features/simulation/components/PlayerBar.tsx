"use client";

import type { ReactNode } from "react";
import { Panel } from "@xyflow/react";
import { PanelRight, SkipBack, SkipForward, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCanvasStore } from "@/features/canvas/store";
import { stopSimulation, startSimulation } from "../lib/actions";
import { useActiveScenario, useSimStore } from "../store";

const ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

function Toggle({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(ICON_BUTTON, pressed && "bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-700")}
    >
      {children}
    </button>
  );
}

/**
 * Controles de la simulación, compactos en la esquina superior izquierda: no tapan el centro
 * del lienzo ni el bloque de zoom + minimapa (abajo a la izquierda). Se avanza solo con clics
 * (o ←/→), sin reproducción automática. Dos filas: escenario y detener; anterior, siguiente y "Paso 3 / 7".
 */
export function PlayerBar() {
  const scenario = useActiveScenario();
  const scenarios = useSimStore((state) => state.scenarios);
  const status = useSimStore((state) => state.status);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const drawerOpen = useCanvasStore((state) => state.drawer.open && state.drawer.tab === "flow");

  if (!scenario || status === "idle") return null;

  const sim = useSimStore.getState;
  const step = scenario.steps[stepIndex];
  const first = stepIndex === 0;
  const last = stepIndex >= scenario.steps.length - 1;

  return (
    <Panel position="top-left" className="top-4! left-4! m-0! z-50!">
      <div
        role="region"
        aria-label="Simulación de flujo"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
          if (event.key === "ArrowRight") sim().next();
          if (event.key === "ArrowLeft") sim().prev();
        }}
        className="flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 rounded-2xl border border-line bg-white/90 px-3 py-2.5 shadow-lg backdrop-blur-sm"
      >
        <div className="flex min-w-0 items-center gap-1">
          <select
            aria-label="Escenario"
            value={scenario.id}
            onChange={(event) => startSimulation(event.target.value)}
            className="h-8 min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-2 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Toggle
            pressed={drawerOpen}
            label="Panel de pasos"
            onClick={() => {
              const canvas = useCanvasStore.getState();
              if (drawerOpen) canvas.closeDrawer();
              else canvas.openDrawer(null, "flow");
            }}
          >
            <PanelRight className="size-4" aria-hidden />
          </Toggle>
          <button
            type="button"
            title="Detener simulación"
            aria-label="Detener simulación"
            onClick={stopSimulation}
            className={ICON_BUTTON}
          >
            <Square className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-1">
          <button
            id="sim-prev"
            type="button"
            title="Paso anterior (←)"
            aria-label="Paso anterior"
            disabled={first}
            onClick={() => sim().prev()}
            className={ICON_BUTTON}
          >
            <SkipBack className="size-4" aria-hidden />
          </button>
          <button
            id="sim-next"
            type="button"
            title="Siguiente paso (→)"
            aria-label="Siguiente paso"
            disabled={last}
            onClick={() => sim().next()}
            className={ICON_BUTTON}
          >
            <SkipForward className="size-4" aria-hidden />
          </button>
          <p className="ml-2 flex min-w-0 flex-1 items-baseline gap-1.5 text-xs text-ink-2">
            <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">
              Paso {stepIndex + 1} / {scenario.steps.length}
            </span>
            {step ? (
              <span className="min-w-0 truncate" title={step.title}>
                · {step.title}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </Panel>
  );
}

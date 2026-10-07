"use client";

import type { ReactNode } from "react";
import { Panel } from "@xyflow/react";
import { Code2, LocateFixed, PanelRight, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCanvasStore } from "@/features/canvas/store";
import { stopSimulation, startSimulation } from "../lib/actions";
import { SPEEDS, useActiveScenario, useSimElapsed, useSimStore } from "../store";

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
      className={cn(ICON_BUTTON, pressed && "bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-700")}
    >
      {children}
    </button>
  );
}

/**
 * Reproductor de la simulación (arriba al centro del lienzo: abajo ya están el IdeDock,
 * el minimapa y los controles de zoom). Aquí SÍ se muestra "Paso 3 / 7".
 */
export function PlayerBar() {
  const scenario = useActiveScenario();
  const scenarios = useSimStore((state) => state.scenarios);
  const status = useSimStore((state) => state.status);
  const speed = useSimStore((state) => state.speed);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const totalMs = useSimStore((state) => state.totalMs);
  const stepStarts = useSimStore((state) => state.stepStarts);
  const syncIde = useSimStore((state) => state.syncIde);
  const followCamera = useSimStore((state) => state.followCamera);
  const drawerOpen = useCanvasStore((state) => state.drawer.open && state.drawer.tab === "flow");
  const elapsed = useSimElapsed();

  if (!scenario || status === "idle") return null;

  const sim = useSimStore.getState;
  const step = scenario.steps[stepIndex];
  const finished = status === "finished";
  const playing = status === "playing";

  return (
    <Panel position="top-center" className="mt-4!">
      <div
        role="region"
        aria-label="Simulación de flujo"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
          if (event.key === "ArrowRight") sim().next();
          if (event.key === "ArrowLeft") sim().prev();
        }}
        className="flex w-[680px] min-w-[420px] max-w-[calc(100vw-31rem)] flex-col gap-2 rounded-2xl border border-line bg-white px-3 py-2.5 shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-1">
          <select
            aria-label="Escenario"
            value={scenario.id}
            onChange={(event) => startSimulation(event.target.value)}
            className="h-8 max-w-44 truncate rounded-lg border border-line bg-white px-2 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            title="Paso anterior (←)"
            aria-label="Paso anterior"
            onClick={() => sim().prev()}
            className={ICON_BUTTON}
          >
            <SkipBack className="size-4" aria-hidden />
          </button>
          <button
            id="sim-play"
            type="button"
            title={finished ? "Repetir (Espacio)" : playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
            aria-label={finished ? "Repetir" : playing ? "Pausar" : "Reproducir"}
            onClick={() => sim().toggle()}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {finished ? (
              <RotateCcw className="size-4" aria-hidden />
            ) : playing ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            title="Siguiente paso (→)"
            aria-label="Siguiente paso"
            disabled={finished}
            onClick={() => sim().next()}
            className={ICON_BUTTON}
          >
            <SkipForward className="size-4" aria-hidden />
          </button>

          <div role="group" aria-label="Velocidad" className="ml-1 flex rounded-lg bg-neutral-100 p-0.5">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={speed === value}
                onClick={() => sim().setSpeed(value)}
                className={cn(
                  "h-7 rounded-md px-2 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-accent",
                  speed === value ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink",
                )}
              >
                {value}×
              </button>
            ))}
          </div>

          <span className="flex-1" />
          <Toggle pressed={syncIde} label="Mostrar cada paso en el IDE" onClick={() => sim().toggleSyncIde()}>
            <Code2 className="size-4" aria-hidden />
          </Toggle>
          <Toggle pressed={followCamera} label="La cámara sigue el flujo" onClick={() => sim().toggleFollowCamera()}>
            <LocateFixed className="size-4" aria-hidden />
          </Toggle>
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

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="range"
              aria-label="Progreso de la simulación"
              min={0}
              max={totalMs}
              step={50}
              value={Math.min(elapsed, totalMs)}
              onChange={(event) => sim().seekTime(Number(event.target.value))}
              className="h-5 w-full cursor-pointer accent-flow"
            />
            {stepStarts.map((start, index) => (
              <span
                key={start}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  index <= stepIndex ? "bg-white/90" : "bg-neutral-300",
                )}
                style={{ left: `${totalMs > 0 ? (start / totalMs) * 100 : 0}%` }}
              />
            ))}
          </div>
          <p className="min-w-0 max-w-[16rem] shrink-0 truncate text-xs tabular-nums text-ink-2">
            <span className="font-semibold text-ink">
              Paso {stepIndex + 1} / {scenario.steps.length}
            </span>
            {step ? ` · ${step.title}` : ""}
          </p>
        </div>
      </div>
    </Panel>
  );
}

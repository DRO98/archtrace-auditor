"use client";

import { ArrowRight, ChevronRight, Clock, Layers, MessageSquare, Upload } from "lucide-react";
import type { ExecutionFlowScenario } from "@core/simulation";
import { cn } from "@/lib/cn";
import { useCanvasStore } from "@/features/canvas/store";
import { estimateSeconds } from "@/features/simulation/lib/stepView";
import { pipelineLabels, scenarioOperation, type ScenarioOperation } from "@/features/simulation/lib/scenarioCard";
import { useSimStore } from "@/features/simulation/store";
import { startSimulation } from "@/features/simulation/lib/actions";

const OPERATION: Record<
  ScenarioOperation,
  { label: string; badge: string; tile: string; Icon: typeof Upload }
> = {
  ingest: {
    label: "Ingestión / Escritura",
    badge: "bg-sky-50 text-emerald-800 ring-1 ring-sky-200",
    tile: "bg-emerald-50 text-emerald-700",
    Icon: Upload,
  },
  query: {
    label: "Consulta / Inferencia",
    badge: "bg-teal-50 text-orange-800 ring-1 ring-teal-200",
    tile: "bg-teal-50 text-teal-700",
    Icon: MessageSquare,
  },
};

const PIPELINE_CAP = 5;

function clearHover(scenarioId: string): void {
  if (useSimStore.getState().hoveredScenarioId === scenarioId) {
    useSimStore.getState().hoverScenario(null);
  }
}

function PipelinePreview({ labels }: { labels: readonly string[] }) {
  const shown = labels.length > PIPELINE_CAP ? labels.slice(0, PIPELINE_CAP - 1) : labels;
  const extra = labels.length - shown.length;
  const pills = extra > 0 ? [...shown, `+${extra}`] : shown;

  return (
    <div className="mt-3 border-t border-dashed border-neutral-200 pt-3">
      <ol className="flex flex-wrap items-center gap-y-1" aria-label="Recorrido del flujo">
        {pills.map((label, index) => (
          <li key={`${label}-${index}`} className="inline-flex items-center">
            {index > 0 ? <ChevronRight className="mx-0.5 size-3 shrink-0 text-neutral-300" aria-hidden /> : null}
            <span
              title={label}
              className="max-w-28 truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-ink-2"
            >
              {label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Tarjeta de un escenario en la pestaña Flujo. Al pasar el ratón, el lienzo resalta su recorrido. */
export function ScenarioCard({ scenario }: { scenario: ExecutionFlowScenario }) {
  const indexes = useCanvasStore((state) => state.indexes);
  const operation = scenarioOperation(scenario);
  const tone = OPERATION[operation];
  const Icon = tone.Icon;
  const labels = pipelineLabels(scenario, (id) => indexes?.modulesById.get(id)?.label ?? id);
  const seconds = estimateSeconds(scenario);

  return (
    <li
      onMouseEnter={() => useSimStore.getState().hoverScenario(scenario.id)}
      onMouseLeave={() => clearHover(scenario.id)}
      onFocus={() => useSimStore.getState().hoverScenario(scenario.id)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        clearHover(scenario.id);
      }}
      className="rounded-xl border border-line bg-white p-4 shadow-md transition-all hover:border-teal-200 hover:shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone.tile)} aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <h3 className="min-w-0 text-[15px] font-semibold leading-5 text-ink">{scenario.name}</h3>
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              tone.badge,
            )}
          >
            {tone.label}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm leading-6 text-ink-2">{scenario.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-ink-2">
          <Layers className="size-3 text-ink-3" aria-hidden />
          {scenario.steps.length} pasos
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-ink-2">
          <Clock className="size-3 text-ink-3" aria-hidden />≈ {seconds} s
        </span>
      </div>

      <PipelinePreview labels={labels} />

      <button
        type="button"
        onClick={() => startSimulation(scenario.id)}
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
      >
        Iniciar Simulación
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

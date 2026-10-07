"use client";

import { useMemo } from "react";
import { Play, Route } from "lucide-react";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { useCanvasStore } from "@/features/canvas/store";
import { startSimulation } from "@/features/simulation/lib/actions";
import { estimateSeconds, toStepViews } from "@/features/simulation/lib/stepView";
import { PayloadPair } from "@/features/simulation/components/PayloadPair";
import { useActiveScenario, useSimStore } from "@/features/simulation/store";
import { StepTimeline } from "./StepTimeline";

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-neutral-100 text-ink-3" aria-hidden>
        <Route className="size-5" />
      </span>
      <p className="max-w-64 text-sm text-ink-3">{text}</p>
    </div>
  );
}

/** Pestaña "Flujo" del panel lateral: los pasos numerados de la simulación, con su dato de entrada y de salida. */
export function FlowTab() {
  const scenario = useActiveScenario();
  const scenarios = useSimStore((state) => state.scenarios);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const indexes = useCanvasStore((state) => state.indexes);

  const views = useMemo(
    () => (scenario ? toStepViews(scenario, (id) => indexes?.modulesById.get(id)?.label ?? id) : []),
    [scenario, indexes],
  );

  if (!scenario) {
    if (scenarios.length === 0) return <EmptyState text="Este proyecto no tiene escenarios de simulación." />;
    return (
      <ul className="flex flex-col gap-3 p-4">
        {scenarios.map((item) => (
          <li key={item.id} className="rounded-xl border border-line bg-white p-4 shadow-md">
            <h3 className="text-[15px] font-semibold text-ink">{item.name}</h3>
            <p className="mt-1 text-sm leading-6 text-ink-2">{item.description}</p>
            <p className="mt-2 text-xs text-ink-3">
              {item.steps.length} pasos · ≈ {estimateSeconds(item)} s
            </p>
            <button
              type="button"
              onClick={() => startSimulation(item.id)}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Play className="size-3.5" aria-hidden />
              Simular
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-line p-4">
        <h3 className="text-[15px] font-semibold text-ink">{scenario.name}</h3>
        <p className="mt-1 text-sm leading-6 text-ink-2">{scenario.description}</p>
      </div>
      <StepTimeline
        label="Pasos de la simulación"
        steps={views}
        activeIndex={stepIndex}
        onSelect={(index) => useSimStore.getState().seekStep(index)}
        onPrev={() => useSimStore.getState().prev()}
        onNext={() => useSimStore.getState().next()}
        onOpenInIde={(index) => {
          const reference = scenario.steps[index]?.fileReference;
          if (!reference) return;
          syncEditorTo(
            { filePath: reference.path, line: reference.lineStart, endLine: reference.lineEnd },
            { allowDeepLink: true },
          );
        }}
        renderDetail={(index) => {
          const step = scenario.steps[index];
          return step ? <PayloadPair payload={step.mockPayload} /> : null;
        }}
      />
    </div>
  );
}

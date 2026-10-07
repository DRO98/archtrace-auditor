"use client";

import { useMemo } from "react";
import type { ExecutionFlowScenario } from "@core/simulation";
import { Route } from "lucide-react";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { useCanvasStore } from "@/features/canvas/store";
import { toStepViews } from "@/features/simulation/lib/stepView";
import { STEP_TITLE_SEPARATOR } from "@/features/simulation/lib/systemScenario";
import { FlowMetricsCard, StepMetricsInline } from "@/features/simulation/components/MetricsCards";
import { PayloadPair } from "@/features/simulation/components/PayloadPair";
import { useActiveScenario, useSimStore } from "@/features/simulation/store";
import { ScenarioCard } from "./ScenarioCard";
import { AskFlowCard } from "./AskFlowCard";
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

/** Nombre de un nodo que no es un módulo (un servicio del mapa de sistema): su título de paso sin el papel. */
function stepNodeLabel(scenario: ExecutionFlowScenario, nodeId: string): string {
  const title = scenario.steps.find((step) => step.nodeId === nodeId)?.title;
  return title ? (title.split(STEP_TITLE_SEPARATOR)[0] ?? title) : nodeId;
}

/** Pestaña "Flujo": tarjetas para elegir un escenario y, en marcha, los pasos con su entrada y salida. */
export function FlowTab() {
  const scenario = useActiveScenario();
  const scenarios = useSimStore((state) => state.scenarios);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const indexes = useCanvasStore((state) => state.indexes);

  const views = useMemo(
    () => (scenario ? toStepViews(scenario, (id) => indexes?.modulesById.get(id)?.label ?? stepNodeLabel(scenario, id)) : []),
    [scenario, indexes],
  );

  if (!scenario) {
    if (scenarios.length === 0) {
      return (
        <div className="flex h-full flex-col gap-3 p-4">
          <EmptyState text="Aún no hay recorridos. Pide uno a la IA o importa un grafo con mapa de sistema." />
          <ul className="flex flex-col gap-3">
            <AskFlowCard />
          </ul>
        </div>
      );
    }
    return (
      <ul className="flex flex-col gap-3 p-4">
        {scenarios.map((item) => (
          <ScenarioCard key={item.id} scenario={item} />
        ))}
        <AskFlowCard />
      </ul>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <div className="px-4 pt-3">
        <FlowMetricsCard scenario={scenario} />
      </div>
      <StepTimeline
        label="Pasos de la simulación"
        steps={views}
        activeIndex={stepIndex}
        showStepNav={false}
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
        renderConnectionAside={(index) => {
          const metrics = scenario.steps[index]?.metrics;
          return metrics ? <StepMetricsInline metrics={metrics} /> : null;
        }}
        renderDetail={(index) => {
          const step = scenario.steps[index];
          if (!step) return null;
          return (
            <div className="mt-3 flex w-full flex-col gap-2 border-t border-slate-100 pt-3">
              <PayloadPair payload={step.mockPayload} />
            </div>
          );
        }}
      />
    </div>
  );
}

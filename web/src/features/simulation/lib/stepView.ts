import type { ExecutionFlowScenario } from "@core/simulation";
import type { TimelineStep } from "@/features/drawer/StepTimeline";
import { summarizePayload } from "./payload";

/**
 * Pasos del escenario en el formato que pinta `StepTimeline` (panel lateral).
 * Los números de paso (1, 2, 3…) viven SOLO ahí y en la barra de reproducción:
 * nunca sobre las tarjetas del lienzo.
 */
export function toStepViews(
  scenario: ExecutionFlowScenario,
  labelOf: (nodeId: string) => string,
): TimelineStep[] {
  const last = scenario.steps.length - 1;
  return scenario.steps.map((step, index) => {
    const next = scenario.steps[index + 1];
    const sends = summarizePayload(step.mockPayload.output);
    let connectionReason: string;
    if (index === last || !next) connectionReason = `Devuelve ${sends}.`;
    else if (next.nodeId === step.nodeId) connectionReason = `Sigue dentro de «${labelOf(step.nodeId)}» con ${sends}.`;
    else connectionReason = `Envía ${sends} a «${labelOf(next.nodeId)}».`;

    const { path, lineStart, lineEnd, functionName } = step.fileReference;
    return {
      stepNumber: index + 1,
      title: step.title,
      summary: step.description,
      connectionReason,
      locationLabel: `${path} · L${lineStart}–${lineEnd} · ${functionName}`,
    };
  });
}

/** "≈ 10 s" de pasos a velocidad 1x, sin contar los viajes. Para las tarjetas de escenario. */
export function estimateSeconds(scenario: ExecutionFlowScenario, defaultStepMs = 2000): number {
  const total = scenario.steps.reduce((sum, step) => sum + (step.durationMs ?? defaultStepMs), 0);
  return Math.round(total / 1000);
}

import type { ExecutionFlowScenario } from "@core/simulation";
import type { RouteHop } from "./route";

export interface TimelineOptions {
  /** Duración de un paso a 1x si `durationMs` no está definido. */
  defaultStepMs: number;
  /** Duración de cada salto del paquete por una arista, a 1x. 0 = sin animación de viaje. */
  travelMs: number;
  /** Duración del salto directo cuando no hay ruta. 0 = sin pausa. */
  jumpMs: number;
}

export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions = {
  defaultStepMs: 2000,
  travelMs: 700,
  jumpMs: 250,
};

export type Segment =
  | { kind: "process"; stepIndex: number; start: number; end: number }
  | {
      kind: "travel";
      fromStep: number;
      toStep: number;
      hopIndex: number;
      hop: RouteHop;
      start: number;
      end: number;
    }
  | { kind: "jump"; fromStep: number; toStep: number; start: number; end: number };

export interface Timeline {
  segments: readonly Segment[];
  /** Instante (ms a 1x) en que empieza cada paso. */
  stepStarts: readonly number[];
  totalMs: number;
}

/**
 * Línea de tiempo lineal a 1x: [paso 0][viaje 0→1][paso 1][viaje 1→2]…[paso N].
 * `routes[i]` es la ruta de la transición i → i+1 (ver `resolveScenarioRoutes`).
 * Los tramos de duración 0 se omiten.
 */
export function buildTimeline(
  scenario: ExecutionFlowScenario,
  routes: ReadonlyArray<readonly RouteHop[] | null>,
  options: TimelineOptions = DEFAULT_TIMELINE_OPTIONS,
): Timeline {
  const segments: Segment[] = [];
  const stepStarts: number[] = [];
  let cursor = 0;
  const last = scenario.steps.length - 1;

  scenario.steps.forEach((step, index) => {
    stepStarts.push(cursor);
    const duration = Math.max(0, step.durationMs ?? options.defaultStepMs);
    if (duration > 0) {
      segments.push({ kind: "process", stepIndex: index, start: cursor, end: cursor + duration });
      cursor += duration;
    }
    if (index === last) return;

    const route = routes[index] ?? null;
    if (route === null) {
      if (options.jumpMs > 0) {
        segments.push({
          kind: "jump",
          fromStep: index,
          toStep: index + 1,
          start: cursor,
          end: cursor + options.jumpMs,
        });
        cursor += options.jumpMs;
      }
      return;
    }
    if (options.travelMs <= 0) return;
    route.forEach((hop, hopIndex) => {
      segments.push({
        kind: "travel",
        fromStep: index,
        toStep: index + 1,
        hopIndex,
        hop,
        start: cursor,
        end: cursor + options.travelMs,
      });
      cursor += options.travelMs;
    });
  });

  return { segments, stepStarts, totalMs: cursor };
}

/** Segmento en el instante `t` y progreso 0..1 dentro de él. En `t >= totalMs`, el último con progreso 1. */
export function locate(
  timeline: Timeline,
  t: number,
): { segmentIndex: number; progress: number } {
  const { segments, totalMs } = timeline;
  if (segments.length === 0) return { segmentIndex: -1, progress: 0 };
  if (t >= totalMs) return { segmentIndex: segments.length - 1, progress: 1 };

  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const segment = segments[middle];
    if (segment && segment.start <= t) low = middle;
    else high = middle - 1;
  }
  const found = segments[low];
  if (!found) return { segmentIndex: -1, progress: 0 };
  const length = found.end - found.start;
  const progress = length > 0 ? Math.min(1, Math.max(0, (t - found.start) / length)) : 1;
  return { segmentIndex: low, progress };
}

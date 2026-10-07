import type { PlaygroundSseEvent } from "@core/playground";
import type { DemoPlayground } from "../types";

/** Tiempo en pantalla de cada etapa: las latencias reales van de 1 ms a 3 s; se comprimen a un rango legible. */
const MIN_VISIBLE_MS = 450;
const MAX_VISIBLE_MS = 1400;
const GAP_MS = 120;

export interface TimedEvent {
  /** Espera antes de emitir el evento. */
  waitMs: number;
  event: PlaygroundSseEvent;
}

/** La misma secuencia de eventos que emitiría `/api/playground/run`, con sus pausas. */
export function demoTimeline(demo: DemoPlayground): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (const item of demo.stages) {
    events.push({ waitMs: GAP_MS, event: { type: "stage_start", stage: item.stage, nodeId: item.nodeId, label: item.label } });
    events.push({
      waitMs: Math.min(MAX_VISIBLE_MS, Math.max(MIN_VISIBLE_MS, item.latencyMs / 2)),
      event: { type: "stage_done", stage: item.stage, nodeId: item.nodeId, latencyMs: item.latencyMs, detail: item.detail },
    });
  }
  events.push({
    waitMs: GAP_MS,
    event: {
      type: "result",
      answer: demo.answer,
      chunks: [...demo.chunks],
      usage: demo.usage,
      costUsd: 0,
      provider: "demo",
      model: demo.model,
    },
  });
  events.push({ waitMs: 0, event: { type: "done" } });
  return events;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reproduce la traza simulada evento a evento. Rechaza si `signal` se aborta. */
export async function replayDemo(demo: DemoPlayground, signal: AbortSignal, emit: (event: PlaygroundSseEvent) => void): Promise<void> {
  for (const { waitMs, event } of demoTimeline(demo)) {
    if (waitMs > 0) await wait(waitMs, signal);
    emit(event);
  }
}

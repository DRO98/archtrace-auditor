import type { TraceModuleRef, TraceProfileId, TraceSseEvent } from "@core/trace";
import type { TraceGraphEdge } from "@/lib/trace/graphWalk";

/** Lo que el lienzo presta a un runner: el grafo, el punto de entrada y el canal de eventos. */
export interface TraceRunContext<E> {
  modules: readonly TraceModuleRef[];
  /** Aristas semánticas (con `kind`), no las dibujadas. */
  edges: readonly TraceGraphEdge[];
  /** Nodo elegido por el usuario; null = el runner decide (sistema completo / entrada por defecto). */
  entryNodeId: string | null;
  signal: AbortSignal;
  emit: (event: E) => void;
  /** Pausa visual entre etapas (inyectable en tests). Rechaza si `signal` se aborta. */
  pause?: (ms: number) => Promise<void>;
}

/**
 * Un perfil de "Probar / Simular". Cada runner emite la misma familia de eventos (`TraceBaseEvent`) que
 * el lienzo sabe pintar; RAG añade `llm_delta` y su propio `result`.
 */
export interface TraceRunner<I, E = TraceSseEvent> {
  profile: TraceProfileId;
  run(input: I, context: TraceRunContext<E>): Promise<void>;
}

/** Espera `ms` o rechaza al abortar. */
export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
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

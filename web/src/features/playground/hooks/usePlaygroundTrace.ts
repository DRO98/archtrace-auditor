"use client";

import { useCanvasStore } from "@/features/canvas/store";
import { stopSimulation } from "@/features/simulation/lib/actions";
import { useSimStore } from "@/features/simulation/store";
import { eventRunner, httpRunner, ragRunner } from "@/features/trace/runners";
import { providerLabel } from "@/lib/ai/catalog";
import { useProviderStatus } from "@/lib/ai/providerStatus";
import { playgroundContext, playgroundPricing, playgroundSelection, usePlaygroundStore } from "../store";

// Vive fuera de React: cerrar el panel no debe dejar una consulta huérfana sin forma de cancelarla.
let current: AbortController | null = null;

/** Detiene lo que pueda pelear por el pintado del lienzo: simulación y modo impacto. */
export function yieldCanvasToPlayground(): void {
  if (useSimStore.getState().activeScenarioId) stopSimulation();
  useCanvasStore.getState().clearImpact();
}

/** Abre "Probar en vivo" con `nodeId` como punto de entrada (acción del nodo o del panel de detalles). */
export function probeFromNode(nodeId: string): void {
  if (usePlaygroundStore.getState().status !== "running") yieldCanvasToPlayground();
  useCanvasStore.getState().setView("architecture");
  usePlaygroundStore.getState().openFrom(nodeId);
}

/** Payload de los perfiles genéricos: JSON si se puede leer, texto tal cual si no. */
export function parsePayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/** true si el panel tiene lo necesario para lanzar el perfil actual. */
export function canRunProfile(state: { profile: string; question: string; documentText: string }): boolean {
  if (state.profile === "rag") return state.question.trim().length > 0 && state.documentText.trim().length > 0;
  return true;
}

/**
 * Lanza la prueba del perfil elegido y vuelca cada evento en el store. Una prueba nueva cancela la anterior.
 * RAG va al servidor por SSE (o se reproduce en el navegador en una demo); HTTP y Evento recorren el grafo
 * en el navegador (HTTP puede además llamar a una URL real).
 */
export async function runPlayground(): Promise<void> {
  const store = usePlaygroundStore.getState();
  if (!canRunProfile(store)) return;
  const blocked = store.profile === "rag" && !store.demo ? blockedReason(store.provider) : null;
  if (blocked) {
    store.begin();
    usePlaygroundStore.getState().fail(blocked);
    return;
  }

  current?.abort();
  const controller = new AbortController();
  current = controller;
  yieldCanvasToPlayground();
  store.begin();

  const { modules, graphEdges = [] } = playgroundContext();
  const emit = (event: Parameters<typeof store.apply>[0]) => usePlaygroundStore.getState().apply(event);
  const base = { modules, edges: graphEdges, entryNodeId: store.entry?.nodeId ?? null, signal: controller.signal, emit };

  try {
    if (store.profile === "rag") {
      await ragRunner.run(
        {
          question: store.question.trim(),
          documentText: store.documentText,
          ai: playgroundSelection(),
          pricing: playgroundPricing(),
          demo: store.demo,
        },
        base,
      );
    } else {
      const runner = store.profile === "http" ? httpRunner : eventRunner;
      await runner.run(
        {
          payload: parsePayload(store.payload),
          url: store.profile === "http" ? store.targetUrl : undefined,
          method: store.httpMethod,
        },
        base,
      );
    }
    if (usePlaygroundStore.getState().status === "running") {
      usePlaygroundStore.getState().fail("La conexión se cortó antes de terminar la prueba.");
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    usePlaygroundStore
      .getState()
      .fail(error instanceof Error && error.message ? `No se pudo contactar con el servidor (${error.message}).` : "No se pudo contactar con el servidor.");
  } finally {
    if (current === controller) current = null;
  }
}

/** Cancela la consulta en curso y quita la traza del lienzo. */
export function cancelPlayground(): void {
  current?.abort();
  current = null;
  usePlaygroundStore.getState().clear();
}

/** Mensaje si el vault ya sabe que la clave del proveedor elegido no sirve (evita una llamada condenada a fallar). */
function blockedReason(provider: Parameters<typeof providerLabel>[0]): string | null {
  const check = useProviderStatus.getState().checks[provider];
  const name = providerLabel(provider);
  switch (check.status) {
    case "auth_error":
      return `La API key de ${name} no es válida (Error de autenticación). Corrígela en API & Integración.`;
    case "quota":
      return check.message ?? `Tu clave de ${name} se ha quedado sin saldo o ha agotado su cuota.`;
    case "unconfigured":
      return `${name} no tiene API key configurada. Añádela en API & Integración.`;
    default:
      return null;
  }
}

/** Acceso cómodo desde componentes. */
export function usePlaygroundTrace() {
  const status = usePlaygroundStore((state) => state.status);
  return { status, running: status === "running", run: runPlayground, cancel: cancelPlayground };
}

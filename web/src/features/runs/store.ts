"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { MAX_RUNS, RUN_LOG_STORAGE_KEY, aggregateRuns, appendRun, parseRuns, type RunAggregate, type RunRecord } from "./lib/runLog";

interface RunLogState {
  /** Más reciente primero. */
  runs: RunRecord[];
  hydrated: boolean;
  hydrate: () => void;
  record: (run: RunRecord) => void;
  remove: (id: string) => void;
  /** Sin `graphName` borra todo el historial. */
  clear: (graphName?: string) => void;
}

function persist(runs: readonly RunRecord[]): void {
  try {
    window.localStorage.setItem(RUN_LOG_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // Cuota llena o almacenamiento bloqueado: el historial sigue en memoria esta sesión.
  }
}

function readStored(): RunRecord[] {
  try {
    return parseRuns(window.localStorage.getItem(RUN_LOG_STORAGE_KEY));
  } catch {
    return [];
  }
}

/**
 * Historial de ejecuciones del playground, en `localStorage` (vive en el navegador del usuario, como
 * las claves BYOK). Se hidrata en el cliente tras montar para no desincronizar el render del servidor.
 */
export const useRunLog = create<RunLogState>((set, get) => ({
  runs: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ runs: readStored(), hydrated: true });
    // Otra pestaña registró o borró ejecuciones.
    window.addEventListener("storage", (event) => {
      if (event.key === RUN_LOG_STORAGE_KEY) set({ runs: parseRuns(event.newValue) });
    });
  },
  record: (run) => {
    const base = get().hydrated ? get().runs : readStored();
    const runs = appendRun(base, run, MAX_RUNS);
    persist(runs);
    set({ runs, hydrated: true });
  },
  remove: (id) => {
    const runs = get().runs.filter((run) => run.id !== id);
    persist(runs);
    set({ runs });
  },
  clear: (graphName) => {
    const runs = graphName === undefined ? [] : get().runs.filter((run) => run.graphName !== graphName);
    persist(runs);
    set({ runs });
  },
}));

/** Ejecuciones (todas o de un pipeline), hidratando el store al montar. */
export function useRuns(graphName?: string | null): RunRecord[] {
  const runs = useRunLog((state) => state.runs);
  useEffect(() => useRunLog.getState().hydrate(), []);
  return useMemo(() => (graphName ? runs.filter((run) => run.graphName === graphName) : runs), [runs, graphName]);
}

/** Métricas agregadas por pipeline (nombre del grafo → agregado). */
export function useRunAggregates(): ReadonlyMap<string, RunAggregate> {
  const runs = useRuns();
  return useMemo(() => {
    const byGraph = new Map<string, RunRecord[]>();
    for (const run of runs) byGraph.set(run.graphName, [...(byGraph.get(run.graphName) ?? []), run]);
    return new Map([...byGraph].map(([name, list]) => [name, aggregateRuns(list)]));
  }, [runs]);
}

"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { useCanvasStore } from "@/features/canvas/store";
import { useLessonStore } from "@/features/lesson/store";
import { useRuns } from "@/features/runs/store";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { uiLanguage } from "@/lib/i18n/lang";
import { architectureCheck, type Finding } from "./lib/architectureCheck";
import { detectDrift, type DriftReport } from "./lib/drift";
import { nodeHealth, slaAlerts, type NodeHealth } from "./lib/sla";

interface HealthState {
  /** Nodos que incumplen el SLA (solo esos), por id. */
  slaByNode: Readonly<Record<string, NodeHealth>>;
  alerts: readonly NodeHealth[];
  drift: DriftReport | null;
  /** Architecture Check: hallazgos del grafo + drift, ordenados por gravedad. */
  findings: readonly Finding[];
  /** Cuándo se calcularon los hallazgos y cuánto tardó (el re-scan lo enseña). */
  checkedAt: number | null;
  checkMs: number | null;
}

export const useHealth = create<HealthState>(() => ({ slaByNode: {}, alerts: [], drift: null, findings: [], checkedAt: null, checkMs: null }));

/** Recalcula el Architecture Check con el grafo que hay en memoria (instantáneo: no hay red ni LLM). */
export function runArchitectureCheck(): void {
  const graph = useCanvasStore.getState().graph;
  const started = performance.now();
  const findings = graph ? architectureCheck(graph, { drift: useHealth.getState().drift, lang: uiLanguage() }) : [];
  useHealth.setState({ findings, checkedAt: Date.now(), checkMs: Math.round(performance.now() - started) });
}

/** Al volver a la ventana (tras editar en el IDE) se relee el mapa del proyecto, como mucho cada `FOCUS_RESCAN_MS`. */
const FOCUS_RESCAN_MS = 15_000;

/**
 * Sin interfaz: recalcula las alertas del lienzo abierto cuando cambian sus ejecuciones (Tracing Log), el
 * grafo o el mapa del proyecto que indexó el IDE, y con ellos el Architecture Check.
 */
export function useHealthSync(graphName: string | null): void {
  const runs = useRuns(graphName);
  const graph = useCanvasStore((state) => state.graph);
  const projectMap = useLessonStore((state) => state.projectMap);
  const connected = useTeacherStatus() === "open";

  useEffect(() => {
    const alerts = slaAlerts(nodeHealth(runs));
    useHealth.setState({ alerts, slaByNode: Object.fromEntries(alerts.map((item) => [item.nodeId, item])) });
  }, [runs]);

  useEffect(() => {
    useHealth.setState({ drift: graph ? detectDrift(graph, projectMap) : null });
    runArchitectureCheck();
  }, [graph, projectMap]);

  const hasMap = projectMap !== null;
  useEffect(() => {
    // Solo con el IDE conectado y un mapa ya pedido: sin mapa no hay drift de código que actualizar.
    if (!connected || !hasMap) return;
    let last = Date.now();
    function onFocus(): void {
      if (Date.now() - last < FOCUS_RESCAN_MS) return;
      last = Date.now();
      // Silencioso: si el IDE no responde, el badge se queda con el último mapa bueno.
      useLessonStore.getState().refreshMap({ quiet: true }).catch(() => undefined);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [connected, hasMap]);
}

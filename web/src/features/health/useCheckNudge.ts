"use client";

import { useEffect } from "react";
import type { CodeGraph } from "@core/graph";
import { useCanvasStore } from "@/features/canvas/store";
import { architectureCheck } from "./lib/architectureCheck";

const NUDGE_KEY_PREFIX = "teacher:check-nudged:";

/** Solo una vez por grafo y pestaña: F5 conserva `sessionStorage`, así que recargar no vuelve a abrir el popover. */
function claimNudge(graphName: string): boolean {
  try {
    const key = `${NUDGE_KEY_PREFIX}${graphName}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    // Sin sessionStorage (modo privado estricto): mejor no abrir nada que abrirlo en cada recarga.
    return false;
  }
}

/**
 * Nudge post-import: la primera vez que se abre un repo importado con hallazgos `high`/`medium`, abre el popover
 * del Architecture Check para que el primer minuto enseñe mapa + hallazgos sin tener que cazar el icono de la rail.
 * Calcula los hallazgos del grafo recibido (instantáneo) en vez de leer el store, que aún puede tener los del grafo anterior.
 */
export function useCheckNudge(graphName: string, graph: CodeGraph, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const relevant = architectureCheck(graph).some((finding) => finding.severity === "high" || finding.severity === "medium");
    if (!relevant || !claimNudge(graphName)) return;
    const canvas = useCanvasStore.getState();
    // Abrir un popover saca del historial: el nudge no debe hacerlo sin que el usuario lo pida.
    if (canvas.popover === null && canvas.view === "architecture") canvas.setPopover("check");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir el grafo, no en cada parche del IDE
  }, [graphName, enabled]);
}

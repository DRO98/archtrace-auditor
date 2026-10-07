"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { useMotionDuration } from "@/lib/motion";
import {
  STEP_VIEW_DURATION_MS,
  centerStepNode,
  measureRightOverlap,
  stepViewPadding,
} from "@/features/canvas/lib/fitNode";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { useCanvasStore } from "@/features/canvas/store";
import { useActiveScenario, useSimStore } from "./store";

/**
 * Sin interfaz. Vive dentro de <ReactFlowProvider> y se encarga de:
 *  1. Parar la simulación cuando deja de tener sentido (modo impacto).
 *  2. Al llegar a cada paso: desplazar la cámara al nodo (zoom fijo) y llevar el IDE al código.
 *  3. Atajos de teclado (←, →) y el anuncio para lectores de pantalla.
 * No hay reloj: la simulación solo avanza con clics.
 */
export function SimulationBridge() {
  const scenario = useActiveScenario();
  const status = useSimStore((state) => state.status);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const phase = useSimStore((state) => state.phase);
  const impactMode = useCanvasStore((state) => state.impactAnalysisMode);
  // Al abrir o cerrar la columna derecha el lienzo cambia de ancho: se vuelve a centrar con el tamaño nuevo.
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const pane = useStore((state) => state.domNode);
  const { setCenter, getInternalNode } = useReactFlow();
  const duration = useMotionDuration(STEP_VIEW_DURATION_MS);
  const lastKey = useRef("");
  const lastStepKey = useRef("");

  // 1. Contexto
  useEffect(() => {
    if (impactMode && status !== "idle") useSimStore.getState().stop();
  }, [impactMode, status]);

  // 2. Cámara e IDE al llegar a cada paso
  useEffect(() => {
    if (!scenario) {
      lastKey.current = "";
      lastStepKey.current = "";
      return;
    }
    if (phase !== "process") return;
    if (paneWidth === 0 || paneHeight === 0) return;
    const padding = stepViewPadding({ rightOverlap: measureRightOverlap(pane), stepBarOpen: status !== "idle" });
    const key = `${scenario.id}:${stepIndex}:${paneWidth}x${paneHeight}:${padding.right}:${padding.top}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const step = scenario.steps[stepIndex];
    if (!step) return;

    centerStepNode(setCenter, getInternalNode, step.nodeId, { duration, padding });
    // El IDE solo se mueve al cambiar de paso, no porque el lienzo cambie de tamaño.
    const stepKey = `${scenario.id}:${stepIndex}`;
    if (lastStepKey.current === stepKey) return;
    lastStepKey.current = stepKey;
    const { path, lineStart, lineEnd } = step.fileReference;
    syncEditorTo({ filePath: path, line: lineStart, endLine: lineEnd }, { allowDeepLink: false });
  }, [scenario, stepIndex, phase, status, paneWidth, paneHeight, pane, setCenter, getInternalNode, duration]);

  // 3. Teclado
  useEffect(() => {
    if (!scenario) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, button, a, aside, [role=tab], [contenteditable=true], .react-flow__node")
      ) {
        return;
      }
      const sim = useSimStore.getState();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        sim.next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        sim.prev();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [scenario]);

  return (
    <p className="sr-only" aria-live="polite">
      {scenario && phase === "process" && scenario.steps[stepIndex]
        ? `Paso ${stepIndex + 1} de ${scenario.steps.length}: ${scenario.steps[stepIndex]?.title ?? ""}`
        : ""}
    </p>
  );
}

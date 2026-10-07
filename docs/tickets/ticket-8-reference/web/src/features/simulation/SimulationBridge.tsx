"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { useMotionDuration } from "@/lib/motion";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { useCanvasStore } from "@/features/canvas/store";
import { CARD_HEIGHT, CARD_WIDTH } from "@/features/canvas/theme";
import { useActiveScenario, useSimStore } from "./store";

const NAV_MIN_GAP_MS = 250;
const COMFORT_MARGIN = 0.15;

/**
 * Sin interfaz. Vive dentro de <ReactFlowProvider> y se encarga de:
 *  1. El bucle requestAnimationFrame (solo mientras se reproduce).
 *  2. Pausar/parar la simulación cuando deja de tener sentido (otra vista, modo impacto).
 *  3. Al empezar cada paso: llevar la cámara al nodo y el IDE al código (si están activados).
 *  4. Atajos de teclado (Espacio, ←, →) y el anuncio para lectores de pantalla.
 */
export function SimulationBridge() {
  const scenario = useActiveScenario();
  const status = useSimStore((state) => state.status);
  const stepIndex = useSimStore((state) => state.stepIndex);
  const phase = useSimStore((state) => state.phase);
  const syncIde = useSimStore((state) => state.syncIde);
  const followCamera = useSimStore((state) => state.followCamera);
  const view = useCanvasStore((state) => state.view);
  const impactMode = useCanvasStore((state) => state.impactAnalysisMode);
  const { getInternalNode, getViewport, setCenter } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const duration = useMotionDuration(400);
  const lastKey = useRef("");
  const lastNavigation = useRef(0);

  // 1. Reloj
  useEffect(() => {
    if (status !== "playing") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = now - last;
      last = now;
      useSimStore.getState().advance(dt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [status]);

  // 2. Contexto
  useEffect(() => {
    if (view !== "architecture" && status === "playing") useSimStore.getState().pause();
  }, [view, status]);
  useEffect(() => {
    if (impactMode && status !== "idle") useSimStore.getState().stop();
  }, [impactMode, status]);

  // 3. Cámara e IDE al empezar cada paso
  useEffect(() => {
    if (!scenario) {
      lastKey.current = "";
      return;
    }
    if (phase !== "process") return;
    const key = `${scenario.id}:${stepIndex}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const step = scenario.steps[stepIndex];
    if (!step) return;

    if (followCamera) {
      const node = getInternalNode(step.nodeId);
      if (node) {
        const { x, y } = node.internals.positionAbsolute;
        const w = node.measured.width ?? CARD_WIDTH;
        const h = node.measured.height ?? CARD_HEIGHT;
        const viewport = getViewport();
        const left = x * viewport.zoom + viewport.x;
        const top = y * viewport.zoom + viewport.y;
        const marginX = width * COMFORT_MARGIN;
        const marginY = height * COMFORT_MARGIN;
        const visible =
          left >= marginX &&
          top >= marginY &&
          left + w * viewport.zoom <= width - marginX &&
          top + h * viewport.zoom <= height - marginY;
        // Solo se mueve la cámara si el nodo se sale de la zona cómoda; el zoom no cambia.
        if (!visible) void setCenter(x + w / 2, y + h / 2, { zoom: viewport.zoom, duration });
      }
    }

    if (syncIde) {
      const now = performance.now();
      const fast = useSimStore.getState().status === "playing" && now - lastNavigation.current < NAV_MIN_GAP_MS;
      if (!fast) {
        lastNavigation.current = now;
        const { path, lineStart, lineEnd } = step.fileReference;
        syncEditorTo({ filePath: path, line: lineStart, endLine: lineEnd }, { allowDeepLink: false });
      }
    }
  }, [scenario, stepIndex, phase, followCamera, syncIde, getInternalNode, getViewport, setCenter, width, height, duration]);

  // 4. Teclado
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
      if (event.key === " ") {
        event.preventDefault();
        sim.toggle();
      } else if (event.key === "ArrowRight") {
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

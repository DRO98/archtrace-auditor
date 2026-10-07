"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/store";
import { FIT_NODE_DURATION_MS } from "@/features/canvas/lib/fitNode";
import { useSimStore } from "@/features/simulation/store";
import { useMotionDuration } from "@/lib/motion";
import { resolveStageNodes } from "@/lib/rag/stageNodes";
import { defaultEntry, walkGraph } from "@/lib/trace/graphWalk";
import { cancelPlayground } from "./hooks/usePlaygroundTrace";
import { playgroundContext, usePlaygroundStore } from "./store";

/** Espera a que la columna derecha cambie de ancho (panel minimizado ↔ desplegado) antes de encuadrar. */
const RESIZE_SETTLE_MS = 80;

/** Nodos que la corrida va a recorrer: el punto de entrada y el nodo de cada etapa. */
function expectedTraceNodes(): string[] {
  const { entry, demo, profile } = usePlaygroundStore.getState();
  const { modules, graphEdges = [] } = playgroundContext();
  if (profile !== "rag") {
    const start = entry?.nodeId ?? defaultEntry(profile, modules, graphEdges);
    return start ? walkGraph(profile, start, graphEdges).map((hop) => hop.nodeId) : [];
  }
  const stageNodes = demo ? demo.stages.map((item) => item.nodeId) : Object.values(resolveStageNodes(modules));
  const ids = new Set<string>();
  if (entry) ids.add(entry.nodeId);
  for (const id of stageNodes) if (id) ids.add(id);
  return [...ids];
}

/**
 * Sin interfaz. Vive dentro de <ReactFlowProvider>:
 *  1. Playground, simulación y modo impacto pintan lo mismo: si arranca uno de los otros, la traza se retira.
 *  2. Al lanzar una consulta (el panel se minimiza) encuadra el recorrido esperado para que la traza
 *     se vea entera; al abrirse los resultados encuadra los nodos recorridos.
 *  3. Columna derecha única: abrir el playground cierra los detalles del módulo (y los devuelve al
 *     cerrarlo); abrir los detalles cierra el playground.
 */
export function PlaygroundBridge() {
  const scenarioActive = useSimStore((state) => state.activeScenarioId !== null);
  const impactMode = useCanvasStore((state) => state.impactAnalysisMode);
  const resultsOpen = usePlaygroundStore((state) => state.resultsOpen);
  const { fitView } = useReactFlow();
  const duration = useMotionDuration(FIT_NODE_DURATION_MS);

  useEffect(() => {
    if (!scenarioActive && !impactMode) return;
    if (usePlaygroundStore.getState().status !== "idle") cancelPlayground();
  }, [scenarioActive, impactMode]);

  useEffect(() => {
    let restoreDrawer = false;
    const offPlayground = usePlaygroundStore.subscribe((state, prev) => {
      if (state.open === prev.open) return;
      const canvas = useCanvasStore.getState();
      if (state.open) {
        restoreDrawer = canvas.drawer.open;
        if (restoreDrawer) canvas.closeDrawer();
      } else if (restoreDrawer) {
        restoreDrawer = false;
        canvas.openDrawer(null, canvas.drawer.tab);
      }
    });
    const offCanvas = useCanvasStore.subscribe((state, prev) => {
      if (!state.drawer.open || prev.drawer.open) return;
      restoreDrawer = false;
      if (usePlaygroundStore.getState().open) usePlaygroundStore.getState().setOpen(false);
    });
    return () => {
      offPlayground();
      offCanvas();
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const off = usePlaygroundStore.subscribe((state, prev) => {
      if (state.status !== "running" || prev.status === "running") return;
      const ids = expectedTraceNodes();
      if (ids.length === 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void fitView({ nodes: ids.map((id) => ({ id })), padding: "12%", maxZoom: 1, duration });
      }, RESIZE_SETTLE_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [fitView, duration]);

  useEffect(() => {
    if (!resultsOpen) return;
    const ids = Object.keys(usePlaygroundStore.getState().nodeStatus);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      void fitView({
        nodes: ids.map((id) => ({ id })),
        padding: "8%",
        maxZoom: 1,
        duration,
      });
    }, RESIZE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [resultsOpen, fitView, duration]);

  return null;
}

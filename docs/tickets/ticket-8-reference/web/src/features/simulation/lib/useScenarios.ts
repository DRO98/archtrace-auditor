"use client";

import { useEffect } from "react";
import type { CodeGraph } from "@core/graph";
import { graphNameFromLocation } from "@/features/canvas/lib/graphName";
import { useSimStore } from "../store";
import type { RoutingEdge } from "./route";
import { parseScenarioFile } from "./scenario";

/**
 * Carga `/scenarios/<grafo>.json` y lo valida contra el grafo que se ve en pantalla
 * (`graph` = el que se dibuja, sin módulos ocultos; `edges` = las aristas dibujadas).
 * Que el archivo no exista es normal (el proyecto no tiene escenarios): el botón queda desactivado.
 */
export function useScenarios(graph: CodeGraph, edges: readonly RoutingEdge[]): void {
  useEffect(() => {
    let cancelled = false;
    const name = graphNameFromLocation();

    async function load(): Promise<void> {
      const { setScenarios } = useSimStore.getState();
      try {
        const response = await fetch(`/scenarios/${name}.json`);
        if (!response.ok) {
          if (!cancelled) setScenarios([], null);
          return;
        }
        const parsed = parseScenarioFile((await response.json()) as unknown, graph, edges);
        if (cancelled) return;
        if (!parsed.ok) {
          console.warn(`[teacher] escenarios inválidos en /scenarios/${name}.json:\n${parsed.errors.join("\n")}`);
          setScenarios([], parsed.errors.slice(0, 2).join(" · "));
          return;
        }
        setScenarios(parsed.file.scenarios, null);
      } catch {
        if (!cancelled) setScenarios([], null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [graph, edges]);
}

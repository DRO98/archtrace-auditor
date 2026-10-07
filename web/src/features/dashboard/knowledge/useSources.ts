"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CodeGraph } from "@core/graph";
import { PROJECT_GRAPH } from "@/features/canvas/lib/graphName";
import {
  hydrateMemoryGraphs,
  listMemorySources,
  serverMemorySources,
  subscribeMemoryGraphs,
  type MemorySourceMeta,
} from "@/features/canvas/lib/memoryGraphs";

export type SourceKind = "repo" | "github" | "local";

/** Un pipeline del catálogo: el repo del proyecto (servido en `/graphs`) o uno importado en este navegador. */
export interface KnowledgeSource {
  name: string;
  label: string;
  kind: SourceKind;
  /** null mientras carga o si el proyecto local aún no tiene grafo generado. */
  graph: CodeGraph | null;
  status: "ready" | "loading" | "missing";
  meta: MemorySourceMeta | null;
}

type ProjectState = { status: "loading" } | { status: "ready"; graph: CodeGraph } | { status: "missing" };

let projectRequest: Promise<ProjectState> | null = null;

function isCodeGraph(value: unknown): value is CodeGraph {
  return typeof value === "object" && value !== null && "modules" in value && Array.isArray(value.modules) && "edges" in value;
}

/** El grafo del repositorio local se pide una vez por pestaña. */
function loadProjectGraph(): Promise<ProjectState> {
  projectRequest ??= fetch(`/graphs/${PROJECT_GRAPH}.json`)
    .then(async (response): Promise<ProjectState> => {
      if (!response.ok) return { status: "missing" };
      const body: unknown = await response.json();
      return isCodeGraph(body) ? { status: "ready", graph: body } : { status: "missing" };
    })
    .catch((): ProjectState => ({ status: "missing" }));
  return projectRequest;
}

export function useProjectGraph(): ProjectState {
  const [state, setState] = useState<ProjectState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    void loadProjectGraph().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function useMemorySources() {
  // Las fuentes guardadas en IndexedDB aparecen en cuanto se leen (la lista es reactiva).
  useEffect(() => void hydrateMemoryGraphs(), []);
  return useSyncExternalStore(subscribeMemoryGraphs, listMemorySources, serverMemorySources);
}

/** Todas las fuentes, la del proyecto primero y luego las importadas (más recientes arriba). */
export function useKnowledgeSources(): KnowledgeSource[] {
  const project = useProjectGraph();
  const imported = useMemorySources();
  return useMemo(() => {
    const repo: KnowledgeSource = {
      name: PROJECT_GRAPH,
      label: PROJECT_GRAPH,
      kind: "repo",
      graph: project.status === "ready" ? project.graph : null,
      status: project.status,
      meta: null,
    };
    return [
      repo,
      ...imported.map((source): KnowledgeSource => ({
        name: source.name,
        label: source.meta.label,
        kind: source.meta.kind,
        graph: source.graph,
        status: "ready",
        meta: source.meta,
      })),
    ];
  }, [project, imported]);
}

"use client";

import { create } from "zustand";
import type { GitDiffPayload, GitFileChange, GitRefsPayload } from "@core/protocol";
import { useCanvasStore } from "@/features/canvas/store";
import { fetchGitDiff, fetchGitRefs } from "@/hooks/useTeacherSocket";
import { diffGraph, type GraphDiff } from "./lib/gitDiff";

interface DiffState {
  /** true mientras el lienzo pinta el diff. */
  active: boolean;
  loading: boolean;
  error: string | null;
  refs: GitRefsPayload | null;
  base: string;
  /** null = árbol de trabajo (cambios sin commitear incluidos). */
  head: string | null;
  changes: GitFileChange[];
  diff: GraphDiff | null;
  loadRefs: () => Promise<void>;
  setBase: (base: string) => void;
  setHead: (head: string | null) => void;
  compare: () => Promise<void>;
  /** Deja de pintar el diff (conserva la selección de refs). */
  clear: () => void;
}

const EMPTY_DIFF: GraphDiff = { byNode: {}, deletedOutside: [], changedOutside: [] };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo consultar git en el IDE.";
}

/**
 * Diff visual de git: la extensión lista los archivos cambiados entre dos refs (o contra el árbol de trabajo)
 * y aquí se proyectan sobre los módulos del lienzo. Si el grafo cambia, el diff se recalcula con los mismos cambios.
 */
export const useGitDiff = create<DiffState>((set, get) => ({
  active: false,
  loading: false,
  error: null,
  refs: null,
  base: "HEAD",
  head: null,
  changes: [],
  diff: null,
  loadRefs: async () => {
    set({ loading: true, error: null });
    try {
      const refs = await fetchGitRefs();
      set({ refs, loading: false, error: refs.error ?? null });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },
  setBase: (base) => set({ base }),
  setHead: (head) => set({ head }),
  compare: async () => {
    const { base, head } = get();
    set({ loading: true, error: null });
    let result: GitDiffPayload;
    try {
      result = await fetchGitDiff(base, head);
    } catch (error) {
      set({ loading: false, error: describeError(error) });
      return;
    }
    if (result.error) {
      set({ loading: false, error: result.error });
      return;
    }
    const graph = useCanvasStore.getState().graph;
    set({ loading: false, active: true, changes: result.files, diff: graph ? diffGraph(graph, result.files) : EMPTY_DIFF });
  },
  clear: () => set({ active: false, diff: null, changes: [], error: null }),
}));

// El grafo cambió (reconstrucción parcial, cambio de pipeline): se reproyectan los mismos cambios.
useCanvasStore.subscribe((state, previous) => {
  if (state.graph === previous.graph) return;
  const { active, changes } = useGitDiff.getState();
  if (!active) return;
  useGitDiff.setState({ diff: state.graph ? diffGraph(state.graph, changes) : EMPTY_DIFF });
});

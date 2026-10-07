"use client";

import { useMemo } from "react";
import { useCanvasEdits } from "../edit/store";
import { useCanvasStore } from "../store";
import { detectArchitectureKind, type ArchitectureKind } from "./architectureKind";

export interface ResolvedArchitectureKind {
  kind: ArchitectureKind;
  detected: ArchitectureKind;
  /** true si el usuario lo fijó a mano (se guarda con el proyecto). */
  manual: boolean;
}

/** Tipo de arquitectura del grafo abierto: el elegido a mano o, si no, el detectado. */
export function useArchitectureKind(): ResolvedArchitectureKind {
  const graph = useCanvasStore((state) => state.graph);
  const manual = useCanvasEdits((state) => state.architectureKind);
  const detected = useMemo(() => (graph ? detectArchitectureKind(graph) : "generic"), [graph]);
  return { kind: manual ?? detected, detected, manual: manual !== null };
}

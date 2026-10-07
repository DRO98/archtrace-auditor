import type { TraceModuleRef, TraceStageDef } from "@core/trace";

/**
 * Módulo del grafo que representa la etapa, o null si ninguno encaja (la UI lo tolera).
 * Para cada token se mira primero nombre de archivo + etiqueta y solo después la ruta entera:
 * así "llm" elige "LLM Service" y no el primer archivo de la carpeta `llm/`. Si ningún token
 * encaja, se prueba por rol.
 */
export function resolveStageNodeFor(stage: Pick<TraceStageDef, "tokens" | "roles">, modules: readonly TraceModuleRef[]): string | null {
  const candidates = modules.map((item) => ({
    id: item.id,
    role: item.role,
    name: `${item.filePath.split(/[\\/]/).pop() ?? ""} ${item.label}`.toLowerCase(),
    path: item.filePath.toLowerCase(),
  }));
  for (const token of stage.tokens) {
    const hit = candidates.find((item) => item.name.includes(token)) ?? candidates.find((item) => item.path.includes(token));
    if (hit) return hit.id;
  }
  for (const role of stage.roles ?? []) {
    const hit = candidates.find((item) => item.role === role);
    if (hit) return hit.id;
  }
  return null;
}

/** Nodo de cada etapa del catálogo (`null` si ninguno encaja). */
export function resolveStageNodesFor<S extends string>(
  stages: readonly (Pick<TraceStageDef, "tokens" | "roles"> & { id: S })[],
  modules: readonly TraceModuleRef[],
): Record<S, string | null> {
  const nodes = {} as Record<S, string | null>;
  for (const stage of stages) nodes[stage.id] = resolveStageNodeFor(stage, modules);
  return nodes;
}

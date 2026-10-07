export const DEFAULT_GRAPH = "macro_rag_project";

/** Nombre del grafo a cargar: `?graph=<nombre>` (solo a-z, 0-9, `_` y `-`) o el del sandbox. */
export function graphNameFromLocation(): string {
  const raw = new URLSearchParams(window.location.search).get("graph");
  if (raw && /^[a-z0-9_-]+$/.test(raw)) return raw;
  return DEFAULT_GRAPH;
}

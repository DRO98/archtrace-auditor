import { sharedDataFromHash, shortHash } from "@/features/share/lib/shareState";

/**
 * Grafo del repositorio del proyecto (servido en `public/graphs/`). No es un "por defecto" de IA: la
 * entrada a la app es el hub de Pipelines, donde se elige o detecta el tipo de arquitectura.
 */
export const PROJECT_GRAPH = "macro_rag_project";

/** Ruta del editor: `/dashboard/pipeline/<nombre>` (el nombre del grafo es el `[id]` del segmento). */
export const PIPELINE_BASE_PATH = "/dashboard/pipeline";

/** Se emite en `window` cuando la app cambia de grafo sin recargar (además de `popstate` al navegar atrás/adelante). */
export const GRAPH_CHANGE_EVENT = "teacher:graph-change";

/** Prefijo del grafo que viene codificado en `#data=` (enlace compartido). */
export const SHARED_GRAPH_PREFIX = "shared-";

const GRAPH_NAME_PATTERN = /^[a-z0-9_-]+$/;

let lastHash = "";
let lastSharedName = "";

export function isGraphName(value: string | null | undefined): value is string {
  return typeof value === "string" && GRAPH_NAME_PATTERN.test(value);
}

export function pipelineHref(name: string): string {
  return `${PIPELINE_BASE_PATH}/${name}`;
}

/**
 * Nombre del grafo a cargar: un enlace compartido (`#data=…`) manda; si no, el `[id]` de
 * `/dashboard/pipeline/[id]` (solo a-z, 0-9, `_` y `-`) o el del repositorio del proyecto.
 */
export function graphNameFromPath(pathname: string, hash: string): string {
  const data = sharedDataFromHash(hash);
  if (data) {
    // Se llama en cada render (useSyncExternalStore): se memoiza el hash del último enlace.
    if (hash !== lastHash) {
      lastHash = hash;
      lastSharedName = `${SHARED_GRAPH_PREFIX}${shortHash(data)}`;
    }
    return lastSharedName;
  }
  const prefix = `${PIPELINE_BASE_PATH}/`;
  if (pathname.startsWith(prefix)) {
    const raw = decodeURIComponent(pathname.slice(prefix.length).split("/")[0] ?? "");
    if (isGraphName(raw)) return raw;
  }
  return PROJECT_GRAPH;
}

export function graphNameFromLocation(): string {
  return graphNameFromPath(window.location.pathname, window.location.hash);
}

/**
 * Cambia de grafo desde dentro del editor sin recargar ni remontar: `pushState` a
 * `/dashboard/pipeline/<nombre>` (Next.js lo sincroniza con `usePathname`) y avisa a quien carga el grafo.
 * Fuera del editor hay que navegar con el router a `pipelineHref(nombre)`.
 */
export function navigateToGraph(name: string): void {
  if (name === graphNameFromLocation()) return;
  // Salir de un enlace compartido: el `#data=` dejaría de mandar sobre la ruta.
  window.history.pushState(null, "", pipelineHref(name));
  window.dispatchEvent(new Event(GRAPH_CHANGE_EVENT));
}

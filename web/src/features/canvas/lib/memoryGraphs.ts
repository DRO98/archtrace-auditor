import type { CodeGraph } from "@core/graph";
import { deleteStoredGraph, listStoredGraphs, putStoredGraph, touchStoredGraph } from "./graphStore";

/**
 * Grafos importados (repos de GitHub y carpetas locales). Viven en memoria y se copian en IndexedDB de este
 * navegador (`graphStore`) para sobrevivir a una recarga. Nunca van a ningún servidor, y lo que se guarda es el
 * grafo (rutas, clases, funciones e imports), no el código fuente.
 */

/** Prefijo de los grafos importados de GitHub en `/dashboard/pipeline/<nombre>`. */
export const GITHUB_GRAPH_PREFIX = "gh-";
/** Prefijo de los grafos construidos desde una carpeta local (arrastrar y soltar). */
export const LOCAL_GRAPH_PREFIX = "local-";

export type MemorySourceKind = "github" | "local";

/** Metadatos de un grafo importado (GitHub o carpeta local) guardado en este navegador. */
export interface MemorySourceMeta {
  kind: MemorySourceKind;
  /** `owner/repo` o nombre de la carpeta. */
  label: string;
  importedAt: number;
  /** Rama o commit analizado (GitHub). */
  ref?: string;
  isPrivate?: boolean;
  /** Rutas sensibles excluidas antes de leerse (secretos, `.env`, `node_modules`…). */
  sensitive?: number;
  /** Fuentes que no entraron por tamaño o por el tope de archivos. */
  skipped?: number;
  /** Fuentes analizadas (las que forman el grafo). */
  analyzed?: number;
  /** De `skipped`, las que se descartaron por superar `MAX_FILE_BYTES`. */
  tooLarge?: number;
  /** GitHub devolvió el árbol truncado: puede haber fuentes que ni se llegaron a ver. */
  truncatedTree?: boolean;
  /** docker-compose y README leídos para infraestructura y nombres de las partes. */
  context?: number;
  /** Carpetas de primer nivel con código que entraron en el análisis, de las que hay. */
  parts?: { included: number; total: number };
}

export interface MemorySource {
  name: string;
  graph: CodeGraph;
  meta: MemorySourceMeta;
}

const sources = new Map<string, MemorySource>();
const listeners = new Set<() => void>();
let snapshot: readonly MemorySource[] = [];
const EMPTY: readonly MemorySource[] = [];

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function githubGraphName(owner: string, repo: string): string {
  return `${GITHUB_GRAPH_PREFIX}${slugify(`${owner}-${repo}`) || "repo"}`;
}

export function localGraphName(folder: string): string {
  return `${LOCAL_GRAPH_PREFIX}${slugify(folder) || "carpeta"}`;
}

function emit(): void {
  snapshot = [...sources.values()].sort((left, right) => right.meta.importedAt - left.meta.importedAt);
  for (const listener of listeners) listener();
}

export function registerMemoryGraph(name: string, graph: CodeGraph, meta?: Partial<MemorySourceMeta>): void {
  const kind: MemorySourceKind = meta?.kind ?? (name.startsWith(LOCAL_GRAPH_PREFIX) ? "local" : "github");
  const source: MemorySource = { name, graph, meta: { kind, label: graph.projectName || name, importedAt: Date.now(), ...meta } };
  sources.set(name, source);
  emit();
  void putStoredGraph({ name, graph: source.graph, meta: source.meta, savedAt: Date.now() });
}

export function removeMemoryGraph(name: string): void {
  if (sources.delete(name)) emit();
  void deleteStoredGraph(name);
}

let hydration: Promise<void> | null = null;

function isStoredSource(value: { graph: unknown; meta: unknown }): value is { graph: CodeGraph; meta: MemorySourceMeta } {
  const graph = value.graph as Partial<CodeGraph> | null;
  const meta = value.meta as Partial<MemorySourceMeta> | null;
  return Array.isArray(graph?.modules) && Array.isArray(graph?.edges) && typeof meta?.label === "string" && typeof meta?.importedAt === "number";
}

/** Recupera de IndexedDB los grafos guardados en sesiones anteriores. Una sola vez por pestaña; nunca falla. */
export function hydrateMemoryGraphs(): Promise<void> {
  hydration ??= listStoredGraphs()
    .then((entries) => {
      let added = false;
      for (const entry of entries) {
        if (sources.has(entry.name) || !isMemoryGraphName(entry.name) || !isStoredSource(entry)) continue;
        sources.set(entry.name, { name: entry.name, graph: entry.graph, meta: entry.meta });
        added = true;
      }
      if (added) emit();
    })
    .catch(() => undefined);
  return hydration;
}

/** Abrir un grafo lo protege del desalojo (LRU) de IndexedDB. */
export function touchMemoryGraph(name: string): void {
  void touchStoredGraph(name);
}

export function memoryGraph(name: string): CodeGraph | undefined {
  return sources.get(name)?.graph;
}

export function memorySourceMeta(name: string): MemorySourceMeta | undefined {
  return sources.get(name)?.meta;
}

export function isMemoryGraphName(name: string): boolean {
  return name.startsWith(GITHUB_GRAPH_PREFIX) || name.startsWith(LOCAL_GRAPH_PREFIX);
}

/** Para `useSyncExternalStore`: la lista es estable entre cambios. */
export function subscribeMemoryGraphs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listMemorySources(): readonly MemorySource[] {
  return snapshot;
}

export function serverMemorySources(): readonly MemorySource[] {
  return EMPTY;
}

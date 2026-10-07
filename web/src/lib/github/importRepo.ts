import type { CodeGraph } from "@core/graph";
import { selectTopSources } from "@core/rankSources";
import { fetchBlobText, fetchRepoTree, type RepoRef, type TreeEntry } from "./client";
import { buildGraphFromSources, isSourcePath, selectContextFiles } from "./buildGraph";
import { sensitiveReason } from "./sensitiveFilter";

/** Tope de archivos y de tamaño: protege la cuota de la API y la memoria de la pestaña. */
export const MAX_FILES = 400;
export const MAX_FILE_BYTES = 256 * 1024;
const CONCURRENCY = 6;

export interface ImportProgress {
  phase: "tree" | "files" | "graph";
  done: number;
  total: number;
}

export interface ImportStats {
  ref: string;
  isPrivate: boolean;
  analyzed: number;
  /** Rutas descartadas por el filtro de secretos (no se descargaron). */
  sensitive: number;
  tooLarge: number;
  /** Archivos fuente que no entraron por `MAX_FILES`. */
  skipped: number;
  truncatedTree: boolean;
  /** docker-compose y README leídos para infraestructura y nombres de las partes (no cuentan en `analyzed`). */
  context: number;
  /** Carpetas de primer nivel con código: cuántas entraron en el análisis de las que hay. */
  parts: { included: number; total: number };
}

export interface FileSelection<T> {
  selected: T[];
  /** docker-compose y README: se leen aparte del tope de fuentes. */
  context: T[];
  sensitive: number;
  tooLarge: number;
  skipped: number;
  parts: { included: number; total: number };
}

/** Carpeta de primer nivel de una ruta ("" si está en la raíz). */
function topFolder(path: string): string {
  return path.includes("/") ? (path.split("/")[0] ?? "") : "";
}

/**
 * Qué se lee: fuentes que pasan el filtro de secretos y el tope de tamaño. Si sobran, entran las mejor puntuadas
 * por `rankSources` (entrypoints, `src/`, cupo mínimo por paquete). Aparte van los archivos de contexto.
 */
export function selectEntries<T extends { path: string; size: number }>(files: readonly T[]): FileSelection<T> {
  let sensitive = 0;
  let tooLarge = 0;
  const sources: T[] = [];
  const candidates: T[] = [];
  for (const file of files) {
    if (sensitiveReason(file.path) !== null) {
      sensitive += 1;
      continue;
    }
    if (file.size <= MAX_FILE_BYTES) candidates.push(file);
    if (!isSourcePath(file.path)) continue;
    if (file.size > MAX_FILE_BYTES) {
      tooLarge += 1;
      continue;
    }
    sources.push(file);
  }
  const { selected, skipped } = selectTopSources(sources, MAX_FILES);
  const allParts = new Set(sources.map((file) => topFolder(file.path)).filter((part) => part.length > 0));
  const includedParts = new Set(selected.map((file) => topFolder(file.path)).filter((part) => part.length > 0));
  return {
    selected,
    context: selectContextFiles(candidates),
    sensitive,
    tooLarge,
    skipped,
    parts: { included: includedParts.size, total: allParts.size },
  };
}

export function selectFiles(files: readonly TreeEntry[]): FileSelection<TreeEntry> {
  return selectEntries(files);
}

/**
 * Importa un repo de GitHub íntegramente en el navegador: árbol → filtro → blobs → grafo.
 * El código fuente solo existe en memoria durante esta función; lo que sobrevive es el grafo
 * (rutas, nombres de bloques e imports), no el contenido de los archivos.
 */
export async function importGithubRepo(
  repo: RepoRef,
  token: string,
  options: { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void } = {},
): Promise<{ graph: CodeGraph; stats: ImportStats }> {
  const { signal, onProgress } = options;
  onProgress?.({ phase: "tree", done: 0, total: 1 });
  const tree = await fetchRepoTree(repo, token, signal);
  const { selected, context, sensitive, tooLarge, skipped, parts } = selectFiles(tree.files);
  if (selected.length === 0) throw new Error("El repositorio no contiene archivos Python, JS o TS que analizar.");

  const toFetch = [...selected, ...context];
  const sources = new Map<string, string>();
  let done = 0;
  let cursor = 0;
  onProgress?.({ phase: "files", done, total: toFetch.length });
  async function worker(): Promise<void> {
    while (cursor < toFetch.length) {
      const file = toFetch[cursor];
      cursor += 1;
      if (!file) continue;
      sources.set(file.path, await fetchBlobText(repo, file.sha, token, signal));
      done += 1;
      onProgress?.({ phase: "files", done, total: toFetch.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  onProgress?.({ phase: "graph", done: 0, total: 1 });
  const graph = buildGraphFromSources(`${repo.owner}/${repo.repo}`, sources);
  sources.clear();
  return {
    graph,
    stats: {
      ref: tree.ref,
      isPrivate: tree.isPrivate,
      analyzed: selected.length,
      sensitive,
      tooLarge,
      skipped,
      truncatedTree: tree.truncated,
      context: context.length,
      parts,
    },
  };
}

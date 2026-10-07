import type { CodeGraph } from "@core/graph";
import { buildGraphFromSources } from "@/lib/github/buildGraph";
import { selectEntries } from "@/lib/github/importRepo";
import { sensitiveReason } from "@/lib/github/sensitiveFilter";

/** Un archivo elegido por el usuario con su ruta relativa a la carpeta soltada. */
export interface LocalEntry {
  path: string;
  file: File;
}

export interface LocalImportStats {
  analyzed: number;
  sensitive: number;
  /** Fuentes que no entraron por `MAX_FILES`. */
  skipped: number;
  tooLarge: number;
  /** docker-compose y README leídos aparte del tope de fuentes. */
  context: number;
  parts: { included: number; total: number };
}

/** `<input webkitdirectory>` o selección de archivos sueltos. */
export function entriesFromFileList(files: FileList | readonly File[]): LocalEntry[] {
  return Array.from(files, (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/**
 * Recorre lo soltado (carpetas incluidas). Las carpetas excluidas (`node_modules`, `.git`, secretos…)
 * no se recorren: su contenido nunca llega a leerse.
 */
export async function entriesFromDataTransfer(items: DataTransferItemList): Promise<{ entries: LocalEntry[]; sensitive: number }> {
  const roots = Array.from(items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const entries: LocalEntry[] = [];
  let sensitive = 0;

  async function walk(entry: FileSystemEntry, path: string): Promise<void> {
    if (sensitiveReason(path) !== null) {
      sensitive += 1;
      return;
    }
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // `readEntries` devuelve lotes (~100 en Chrome): se lee hasta vaciarlo.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}/${child.name}`);
    }
  }

  for (const root of roots) await walk(root, root.name);
  return { entries, sensitive };
}

/** Si todo cuelga de una misma carpeta raíz, se quita: los grupos del lienzo salen de las subcarpetas. */
function stripCommonRoot(entries: readonly LocalEntry[]): { root: string | null; entries: LocalEntry[] } {
  const first = entries[0]?.path.split("/")[0];
  const shared = first !== undefined && entries.every((entry) => entry.path.includes("/") && entry.path.split("/")[0] === first);
  if (!shared) return { root: null, entries: [...entries] };
  return { root: first, entries: entries.map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) })) };
}

/**
 * Construye el grafo de una carpeta local sin salir del navegador: filtro de secretos → lectura → grafo.
 * El texto de los archivos solo existe durante esta función.
 */
export async function importLocalEntries(
  input: readonly LocalEntry[],
  preExcluded = 0,
): Promise<{ graph: CodeGraph; projectName: string; stats: LocalImportStats }> {
  const { root, entries } = stripCommonRoot(input);
  const selection = selectEntries(entries.map((entry) => ({ ...entry, size: entry.file.size })));
  const { selected: files, context, skipped, tooLarge } = selection;
  const sensitive = preExcluded + selection.sensitive;
  if (files.length === 0) throw new Error("No hay archivos Python, JS o TS que analizar en lo que has soltado.");

  const sources = new Map<string, string>();
  for (const entry of [...files, ...context]) sources.set(entry.path, await entry.file.text());
  const projectName = root ?? "carpeta-local";
  const graph = buildGraphFromSources(projectName, sources);
  sources.clear();
  return { graph, projectName, stats: { analyzed: files.length, sensitive, skipped, tooLarge, context: context.length, parts: selection.parts } };
}

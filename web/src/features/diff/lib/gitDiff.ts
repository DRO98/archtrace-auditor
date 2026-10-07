import type { CodeGraph } from "@core/graph";
import type { GitFileChange } from "@core/protocol";
import { sameSourceFile } from "@/features/canvas/lib/sourceSync";

/** Estado de un nodo en el diff visual: añadido (verde), modificado (amarillo) o eliminado (rojo). */
export type NodeDiffStatus = "added" | "modified" | "deleted";

export interface GraphDiff {
  byNode: Record<string, NodeDiffStatus>;
  /** Archivos eliminados que el lienzo ya no dibuja (se listan aparte). */
  deletedOutside: string[];
  /** Archivos añadidos o modificados sin módulo en el lienzo. */
  changedOutside: string[];
}

function toStatus(change: GitFileChange): NodeDiffStatus {
  if (change.status === "added") return "added";
  if (change.status === "deleted") return "deleted";
  return "modified";
}

/**
 * Proyecta los cambios de git (entre dos refs, o de un ref al árbol de trabajo) sobre los módulos del
 * lienzo. Un renombrado cuenta como modificado en su ruta nueva, y como eliminado en la vieja si el
 * lienzo aún tiene un módulo con ella.
 */
export function diffGraph(graph: CodeGraph, changes: readonly GitFileChange[]): GraphDiff {
  const byNode: Record<string, NodeDiffStatus> = {};
  const deletedOutside: string[] = [];
  const changedOutside: string[] = [];
  const moduleFor = (path: string) => graph.modules.find((item) => sameSourceFile(path, item.filePath));

  for (const change of changes) {
    const status = toStatus(change);
    const owner = moduleFor(change.path);
    if (owner) byNode[owner.id] = status;
    else if (status === "deleted") deletedOutside.push(change.path);
    else changedOutside.push(change.path);

    if (change.status === "renamed" && change.previousPath) {
      const previous = moduleFor(change.previousPath);
      if (previous && previous.id !== owner?.id) byNode[previous.id] = "deleted";
    }
  }
  return { byNode, deletedOutside: deletedOutside.sort(), changedOutside: changedOutside.sort() };
}

export function diffCounts(diff: GraphDiff): Record<NodeDiffStatus, number> {
  const counts: Record<NodeDiffStatus, number> = { added: 0, modified: 0, deleted: diff.deletedOutside.length };
  for (const status of Object.values(diff.byNode)) counts[status] += 1;
  return counts;
}

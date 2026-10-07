import type { CodeGraph, ModuleRole } from "@core/graph";
import type { ProjectMap } from "@core/projectMap";
import { roleForPath } from "@/features/canvas/lib/architecture";
import { sameSourceFile } from "@/features/canvas/lib/sourceSync";
import { prepareGraph } from "@/features/canvas/lib/subsystems";
import { isCanvasComponent } from "@/features/canvas/edit/components";
import { isInfraModuleId } from "@/lib/scan/composeScan";

/**
 * Drift de arquitectura: diferencias entre lo que dice el código y lo que muestra el lienzo.
 * - `unmapped`: archivos fuente que el IDE indexó y ningún módulo del lienzo representa.
 * - `stale`: módulos del lienzo cuyo archivo ya no existe en el workspace.
 * - `disconnected`: módulos sin ninguna conexión (el lienzo los oculta, así que nadie los ve).
 * Los que parecen endpoints (rol api/rpc por ruta o por el grafo) se marcan: son los más graves de perder.
 */
export type DriftKind = "unmapped" | "stale" | "disconnected";

export interface DriftItem {
  kind: DriftKind;
  /** Ruta del archivo (unmapped) o id del módulo (stale, disconnected). */
  id: string;
  label: string;
  filePath: string;
  endpoint: boolean;
}

export interface DriftReport {
  items: DriftItem[];
  /** false si no había mapa del IDE: solo se pudo comprobar `disconnected`. */
  checkedSource: boolean;
}

const ENDPOINT_ROLES: ReadonlySet<ModuleRole> = new Set(["api", "rpc"]);
/** Archivos que no son arquitectura: tests, configuración de herramientas y declaraciones. */
const IGNORED = /(^|\/)(tests?|__tests__|spec|__mocks__|node_modules|dist|build)\/|\.(test|spec)\.[a-z]+$|(^|\/)(conftest|setup|vite\.config|next\.config|eslint\.config|jest\.config)\.[a-z]+$|\.d\.ts$|(^|\/)__init__\.py$/;

export function detectDrift(graph: CodeGraph, map: ProjectMap | null): DriftReport {
  const items: DriftItem[] = [];
  const real = graph.modules.filter((item) => !isCanvasComponent(item.id));

  for (const hidden of prepareGraph({ ...graph, modules: real }).hidden) {
    if (isInfraModuleId(hidden.id)) continue;
    const role = hidden.role ?? roleForPath(hidden.filePath);
    items.push({ kind: "disconnected", id: hidden.id, label: hidden.label, filePath: hidden.filePath, endpoint: ENDPOINT_ROLES.has(role) });
  }

  if (map) {
    // El grafo puede abarcar solo una parte del workspace (p. ej. `sandbox/src`): se compara dentro de
    // las carpetas de primer nivel que cubre, traducidas a rutas del IDE con el prefijo del workspace.
    const matched = real.flatMap((item) => {
      const file = map.files.find((entry) => sameSourceFile(entry.filePath, item.filePath));
      return file && file.filePath.endsWith(item.filePath) ? [{ item, prefix: file.filePath.slice(0, -item.filePath.length) }] : [];
    });
    const prefix = matched[0]?.prefix ?? "";
    const tops = new Set(real.map((item) => (item.filePath.includes("/") ? `${item.filePath.split("/")[0]}/` : "")));
    const inScope = (path: string): boolean =>
      matched.length === 0 || (path.startsWith(prefix) && [...tops].some((top) => path.slice(prefix.length).startsWith(top)));

    // Lo que el mapa omitió a propósito (tests, `__init__`, huérfanos) no es «sin mapear».
    const omitted = graph.omitted?.paths ?? [];
    for (const file of map.files) {
      if (IGNORED.test(file.filePath) || !inScope(file.filePath)) continue;
      if (omitted.some((path) => sameSourceFile(file.filePath, path))) continue;
      if (real.some((item) => sameSourceFile(file.filePath, item.filePath))) continue;
      if (file.symbols.length === 0) continue; // Archivos vacíos o solo con constantes: no son módulos.
      const role = roleForPath(file.filePath);
      items.push({
        kind: "unmapped",
        id: file.filePath,
        label: file.filePath.split("/").pop() ?? file.filePath,
        filePath: file.filePath,
        endpoint: ENDPOINT_ROLES.has(role),
      });
    }

    // Si el mapa se truncó, faltar en él no significa haber desaparecido.
    if (!map.truncated) {
      for (const item of real) {
        if (isInfraModuleId(item.id)) continue;
        if (map.files.some((file) => sameSourceFile(file.filePath, item.filePath))) continue;
        const role = item.role ?? roleForPath(item.filePath);
        items.push({ kind: "stale", id: item.id, label: item.label, filePath: item.filePath, endpoint: ENDPOINT_ROLES.has(role) });
      }
    }
  }

  items.sort((left, right) => Number(right.endpoint) - Number(left.endpoint) || left.kind.localeCompare(right.kind) || left.filePath.localeCompare(right.filePath));
  return { items, checkedSource: map !== null };
}

export const DRIFT_KIND_LABEL: Readonly<Record<DriftKind, string>> = {
  unmapped: "Sin mapear en el lienzo",
  stale: "Ya no existe en el código",
  disconnected: "Sin conexiones (oculto)",
};

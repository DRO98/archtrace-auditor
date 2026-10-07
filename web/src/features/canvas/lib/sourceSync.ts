import type { CodeGraph, CodeModule, CodeSubBlock, ModuleEdge, ModuleGroup } from "@core/graph";
import type { MapFile, ProjectMap } from "@core/projectMap";
import { deriveSubtitle, humanizeLabel, inferRole } from "./architecture";

/**
 * El grafo guarda rutas relativas a la raíz del proyecto analizado ("src/rag/chunker.py") y el IDE las
 * manda relativas al workspace, que puede ser una carpeta superior ("sandbox/src/rag/chunker.py").
 * Dos rutas son el mismo archivo si coinciden o si una termina en "/" + la otra.
 */
export function sameSourceFile(left: string, right: string): boolean {
  if (left === right) return true;
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/** Módulos del grafo cuyos archivos aparecen entre los cambiados. */
export function affectedModules(graph: CodeGraph, changedPaths: readonly string[]): CodeModule[] {
  return graph.modules.filter((item) => changedPaths.some((changed) => sameSourceFile(changed, item.filePath)));
}

export function findMapFile(map: ProjectMap, filePath: string): MapFile | null {
  return map.files.find((file) => sameSourceFile(file.filePath, filePath)) ?? null;
}

/**
 * Traduce los símbolos que indexó el IDE a sub-bloques del módulo, con el mismo formato de id que
 * `build-sandbox-graph` (`<filePath>::<nombre cualificado>`). Conserva los resúmenes de los bloques
 * que siguen existiendo con el mismo nombre.
 */
export function symbolsToSubBlocks(codeModule: CodeModule, file: MapFile): CodeSubBlock[] {
  const summaries = new Map(
    codeModule.subBlocks.flatMap((block) => (block.summary ? [[block.name, block.summary] as const] : [])),
  );
  const nameById = new Map(file.symbols.map((symbol) => [symbol.id, symbol.qualifiedName]));
  return file.symbols.map((symbol) => {
    const block: CodeSubBlock = {
      id: `${codeModule.filePath}::${symbol.qualifiedName}`,
      kind: symbol.kind,
      name: symbol.qualifiedName,
      range: { startLine: symbol.range.startLine, endLine: symbol.range.endLine },
    };
    const parentName = symbol.parentId ? nameById.get(symbol.parentId) : undefined;
    if (parentName) block.parentId = `${codeModule.filePath}::${parentName}`;
    const summary = summaries.get(symbol.qualifiedName);
    if (summary) block.summary = summary;
    return block;
  });
}

function sameBlocks(left: readonly CodeSubBlock[], right: readonly CodeSubBlock[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((block, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      block.id === other.id &&
      block.kind === other.kind &&
      block.range.startLine === other.range.startLine &&
      block.range.endLine === other.range.endLine &&
      block.parentId === other.parentId
    );
  });
}

/**
 * Sub-bloques nuevos de los módulos afectados, solo los que cambiaron. Un archivo borrado o que el IDE
 * no indexó no se toca: mejor un rango viejo que un módulo vacío.
 */
export function subBlockPatches(
  graph: CodeGraph,
  map: ProjectMap,
  changedPaths: readonly string[],
): Map<string, CodeSubBlock[]> {
  const patches = new Map<string, CodeSubBlock[]>();
  for (const codeModule of affectedModules(graph, changedPaths)) {
    const file = findMapFile(map, codeModule.filePath);
    if (!file) continue;
    const next = symbolsToSubBlocks(codeModule, file);
    if (!sameBlocks(codeModule.subBlocks, next)) patches.set(codeModule.id, next);
  }
  return patches;
}

export interface PartialRebuild {
  graph: CodeGraph;
  /** Módulos con sub-bloques nuevos. */
  patched: string[];
  /** Módulos añadidos (archivos nuevos que el IDE ya indexó). */
  added: string[];
  addedEdges: string[];
  removedEdges: string[];
}

/**
 * Prefijo que separa las rutas del IDE (relativas al workspace) de las del grafo (relativas al proyecto
 * analizado): "sandbox/" si el grafo dice `src/a.py` y el IDE `sandbox/src/a.py`. null si no se puede
 * deducir de ningún módulo conocido.
 */
function workspacePrefix(graph: CodeGraph, map: ProjectMap): string | null {
  for (const codeModule of graph.modules) {
    const file = findMapFile(map, codeModule.filePath);
    if (!file) continue;
    if (file.filePath === codeModule.filePath) return "";
    if (file.filePath.endsWith(`/${codeModule.filePath}`)) return file.filePath.slice(0, -codeModule.filePath.length);
    return null; // El grafo es más largo que el IDE: no se puede traducir con fiabilidad.
  }
  return null;
}

const GROUP_COLORS: readonly ModuleGroup["color"][] = ["sky", "violet", "emerald", "amber", "rose"];

function groupFor(filePath: string, groups: ModuleGroup[]): string {
  const dirs = filePath.split("/").slice(0, -1);
  // Reutiliza un grupo existente si alguna carpeta de la ruta ya lo es; si no, crea uno con la primera significativa.
  const existing = dirs.find((dir) => groups.some((group) => group.id === dir));
  if (existing) return existing;
  const id = dirs.find((dir) => !["src", "app", "lib", "packages"].includes(dir)) ?? dirs[0] ?? "root";
  if (!groups.some((group) => group.id === id)) {
    groups.push({ id, label: id, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] ?? "zinc" });
  }
  return id;
}

/**
 * Reconstrucción parcial tras `SOURCE_FILES_CHANGED`, con el mapa que indexó el IDE:
 * 1. Sub-bloques de los módulos tocados (como `subBlockPatches`).
 * 2. Archivos nuevos que el IDE ya conoce → módulos nuevos (rol por ruta, grupo por carpeta).
 * 3. Aristas: se añaden `imports` que el mapa declara y `calls` resueltas entre símbolos de módulos
 *    distintos (solo si no hay ya una arista entre ambos). Se quita un `imports` de un módulo tocado
 *    solo si el mapa conoce ambos archivos y ninguno importa al otro (así se respetan las aristas
 *    curadas dibujadas "al revés" del import). `calls` y `data-flow` curadas nunca se quitan.
 * Devuelve null si no cambia nada.
 */
export function rebuildFromMap(graph: CodeGraph, map: ProjectMap, changedPaths: readonly string[]): PartialRebuild | null {
  const patches = subBlockPatches(graph, map, changedPaths);
  const groups = [...graph.groups];
  let modules = graph.modules.map((item) => {
    const subBlocks = patches.get(item.id);
    return subBlocks ? { ...item, subBlocks } : item;
  });

  const added: string[] = [];
  const prefix = workspacePrefix(graph, map);
  if (prefix !== null) {
    for (const changed of changedPaths) {
      if (modules.some((item) => sameSourceFile(changed, item.filePath))) continue;
      const file = findMapFile(map, changed);
      if (!file || !file.filePath.startsWith(prefix)) continue;
      const filePath = file.filePath.slice(prefix.length);
      if (modules.some((item) => item.id === filePath)) continue;
      const fileName = filePath.split("/").pop() ?? filePath;
      const draft: CodeModule = {
        id: filePath,
        label: humanizeLabel(fileName),
        filePath,
        groupId: groupFor(filePath, groups),
        language: file.language,
        subBlocks: [],
      };
      draft.subBlocks = symbolsToSubBlocks(draft, file);
      const codeModule: CodeModule = { ...draft, role: inferRole(draft), subtitle: deriveSubtitle(draft) };
      if (file.doc) codeModule.summary = file.doc;
      modules = [...modules, codeModule];
      added.push(filePath);
    }
  }

  // Ruta del IDE → id de módulo del grafo, y símbolo del IDE → módulo que lo contiene.
  const moduleOfPath = (path: string): string | undefined => modules.find((item) => sameSourceFile(path, item.filePath))?.id;
  const moduleOfSymbol = new Map<string, string>();
  for (const file of map.files) {
    const owner = moduleOfPath(file.filePath);
    if (owner) for (const symbol of file.symbols) moduleOfSymbol.set(symbol.id, owner);
  }
  const importsOf = (moduleId: string): Set<string> | null => {
    const codeModule = modules.find((item) => item.id === moduleId);
    const file = codeModule ? findMapFile(map, codeModule.filePath) : null;
    if (!file) return null;
    return new Set(file.imports.map(moduleOfPath).filter((id): id is string => id !== undefined));
  };

  const touched = new Set([...affectedModules({ ...graph, modules }, changedPaths).map((item) => item.id), ...added]);
  const connected = (left: string, right: string, edges: readonly ModuleEdge[]) =>
    edges.some((edge) => (edge.source === left && edge.target === right) || (edge.source === right && edge.target === left));

  const removedEdges: string[] = [];
  let edges = graph.edges.filter((edge) => {
    if (edge.kind !== "imports" || (!touched.has(edge.source) && !touched.has(edge.target))) return true;
    const fromSource = importsOf(edge.source);
    const fromTarget = importsOf(edge.target);
    if (!fromSource || !fromTarget) return true;
    if (fromSource.has(edge.target) || fromTarget.has(edge.source)) return true;
    // Solo el importador tocado decide: si ninguno de los dos extremos cambió, la arista no se revisa.
    if (!touched.has(edge.source)) return true;
    removedEdges.push(edge.id);
    return false;
  });

  const addedEdges: string[] = [];
  for (const moduleId of touched) {
    for (const target of importsOf(moduleId) ?? []) {
      if (target === moduleId || connected(moduleId, target, edges)) continue;
      const edge: ModuleEdge = { id: `imports:${moduleId}:${target}`, source: moduleId, target, kind: "imports", label: "imports" };
      edges = [...edges, edge];
      addedEdges.push(edge.id);
    }
    const codeModule = modules.find((item) => item.id === moduleId);
    const file = codeModule ? findMapFile(map, codeModule.filePath) : null;
    const callTargets = new Set(
      [...(file?.symbols.flatMap((symbol) => symbol.calls) ?? []), ...(file?.moduleScope.calls ?? [])]
        .map((call) => moduleOfSymbol.get(call.target))
        .filter((id): id is string => id !== undefined && id !== moduleId),
    );
    for (const target of callTargets) {
      if (connected(moduleId, target, edges)) continue;
      const edge: ModuleEdge = { id: `calls:${moduleId}:${target}`, source: moduleId, target, kind: "calls", label: "calls" };
      edges = [...edges, edge];
      addedEdges.push(edge.id);
    }
  }

  if (patches.size === 0 && added.length === 0 && addedEdges.length === 0 && removedEdges.length === 0) return null;
  return {
    graph: { ...graph, groups, modules, edges },
    patched: [...patches.keys()],
    added,
    addedEdges,
    removedEdges,
  };
}

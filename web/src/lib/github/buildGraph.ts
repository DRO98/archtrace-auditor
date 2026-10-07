import type { CodeGraph, CodeModule, CodeSubBlock, GroupColor, ModuleGroup } from "@core/graph";
import { deriveSubtitle, humanizeLabel, inferRole } from "@/features/canvas/lib/architecture";
import { resolveImports, scanPythonSource } from "@/lib/scan/pyScan";
import { resolveScriptImports, scanScriptSource } from "@/lib/scan/jsScan";
import { POLY_EXTENSIONS, polyLanguageOf, protoServices, resolvePolyImports, scanPolySource } from "@/lib/scan/polyScan";
import { detectSemantics, refineRole, semanticEdges, techLabel, type ModuleSemantics } from "@/lib/scan/semantics";
import { INFRA_GROUP, infraEdgesByTech, isComposePath, scanCompose } from "@/lib/scan/composeScan";
import { pruneNonArchitectural } from "@/features/canvas/lib/architectureSkeleton";
import { humanizePart, isReadmePath, readmePartDescriptions, readmeSummary, shortPartLabel } from "@/lib/scan/readmeParts";

/** Extensiones que se analizan. El resto del repo no se descarga. */
export const SOURCE_EXTENSIONS = [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ...Object.keys(POLY_EXTENSIONS)] as const;

export function isSourcePath(path: string): boolean {
  if (path.endsWith(".d.ts") || /\.min\.js$/.test(path)) return false;
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Archivos de contexto que no se analizan como código pero explican la arquitectura: docker-compose (infra y
 * conexiones entre servicios) y los README de la raíz y de las carpetas de primer nivel (nombres de las partes).
 */
export function isContextPath(path: string): boolean {
  return isComposePath(path) || isReadmePath(path);
}

/** Tope de archivos de contexto por import: los más cercanos a la raíz primero. */
export const MAX_CONTEXT_FILES = 16;

export function selectContextFiles<T extends { path: string }>(items: readonly T[]): T[] {
  return items
    .filter((item) => isContextPath(item.path))
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.length - right.path.length || left.path.localeCompare(right.path))
    .slice(0, MAX_CONTEXT_FILES);
}

function languageOf(path: string): string {
  if (path.endsWith(".py")) return "python";
  const poly = polyLanguageOf(path);
  if (poly) return poly;
  return /\.tsx?$/.test(path) ? "typescript" : "javascript";
}

const GROUP_COLORS: readonly GroupColor[] = ["sky", "violet", "emerald", "amber", "rose"];
/** Carpetas contenedoras que no aportan como grupo: se usa la siguiente. */
const WRAPPER_DIRS: ReadonlySet<string> = new Set(["src", "app", "lib", "packages"]);

/** Contenedores de monorepo: el grupo es el paquete que cuelga de ellos (`apps/web/...` → `web`). */
const MONOREPO_CONTAINERS: ReadonlySet<string> = new Set(["apps", "services", "libs", "modules"]);

function groupIdFor(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  if (dirs.length >= 2 && MONOREPO_CONTAINERS.has(dirs[0] ?? "") && !WRAPPER_DIRS.has(dirs[1] ?? "")) return dirs[1] ?? "root";
  const meaningful = dirs.find((dir) => !WRAPPER_DIRS.has(dir));
  return meaningful ?? dirs[0] ?? "root";
}

function subBlocksFor(path: string, source: string): CodeSubBlock[] {
  const poly = polyLanguageOf(path);
  if (poly) {
    return scanPolySource(source, poly).map((block) => {
      const sub: CodeSubBlock = {
        id: `${path}::${block.name}`,
        kind: block.kind,
        name: block.name,
        range: { startLine: block.startLine, endLine: block.endLine },
      };
      if (block.parentName) sub.parentId = `${path}::${block.parentName}`;
      return sub;
    });
  }
  if (path.endsWith(".py")) {
    return scanPythonSource(source).map((block) => {
      const sub: CodeSubBlock = {
        id: `${path}::${block.name}`,
        kind: block.kind,
        name: block.name,
        range: { startLine: block.startLine, endLine: block.endLine },
      };
      if (block.parentName) sub.parentId = `${path}::${block.parentName}`;
      return sub;
    });
  }
  return scanScriptSource(source).map((block) => ({
    id: `${path}::${block.name}`,
    kind: block.kind,
    name: block.name,
    range: { startLine: block.startLine, endLine: block.endLine },
  }));
}

function importsOf(filePath: string, source: string, known: ReadonlySet<string>): string[] {
  const poly = polyLanguageOf(filePath);
  if (poly) return resolvePolyImports(source, filePath, known, poly);
  return filePath.endsWith(".py") ? resolveImports(source, filePath, known) : resolveScriptImports(source, filePath, known);
}

/**
 * Construye el grafo de arquitectura a partir de fuentes ya descargadas, todo en memoria.
 * Capa y subsistema se dejan sin fijar: el lienzo los infiere por rol y ruta.
 *
 * Además de los imports, detecta evidencia semántica en el código (`detectSemantics`): clientes de
 * Kafka/RabbitMQ/Flink/gRPC/BD refinan el rol, y productor → consumidor de un mismo topic o cliente →
 * servidor gRPC se conectan con aristas `data-flow` y `calls`.
 */
export function buildGraphFromSources(projectName: string, sources: ReadonlyMap<string, string>): CodeGraph {
  const files = [...sources.keys()].filter(isSourcePath).sort((left, right) => left.localeCompare(right));
  const known = new Set(files);

  const semantics = new Map<string, ModuleSemantics>();
  for (const filePath of files) {
    if (polyLanguageOf(filePath) !== "protobuf") semantics.set(filePath, detectSemantics(sources.get(filePath) ?? ""));
  }

  const modules: CodeModule[] = files.map((filePath) => {
    const fileName = filePath.split("/").pop() ?? filePath;
    const scanned: CodeModule = {
      id: filePath,
      label: fileName,
      filePath,
      groupId: groupIdFor(filePath),
      language: languageOf(filePath),
      subBlocks: subBlocksFor(filePath, sources.get(filePath) ?? ""),
    };
    const found = semantics.get(filePath);
    const role = polyLanguageOf(filePath) === "protobuf" ? "rpc" : found ? refineRole(inferRole(scanned), found) : inferRole(scanned);
    const codeModule: CodeModule = { ...scanned, label: humanizeLabel(fileName), role, subtitle: deriveSubtitle(scanned) };
    if (found && found.tech.length > 0) {
      codeModule.tech = found.tech;
      codeModule.summary = `Usa ${found.tech.map(techLabel).join(", ")}`;
    }
    return codeModule;
  });

  // Infraestructura del compose: módulos `infra:<tech>` y aristas servicio → servicio / código → servicio.
  const composeFiles = new Map([...sources].filter(([path]) => isComposePath(path)));
  const compose = scanCompose(composeFiles, known);
  for (const item of modules) {
    const service = compose.serviceOf.get(item.id);
    if (service) item.service = service;
  }
  disambiguateLabels(modules, compose.modules);
  modules.push(...compose.modules);

  const edges: CodeGraph["edges"] = [];
  const seen = new Set<string>();
  const addImport = (source: string, target: string, label = "imports"): void => {
    const id = `imports:${source}:${target}`;
    if (target === source || seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, kind: "imports", label });
  };
  for (const filePath of files) {
    for (const target of importsOf(filePath, sources.get(filePath) ?? "", known)) addImport(filePath, target);
  }

  // Contratos gRPC: quien sirve o llama a un servicio se enlaza con el `.proto` que lo declara.
  const protoOf = new Map<string, string>();
  for (const filePath of files) {
    if (polyLanguageOf(filePath) !== "protobuf") continue;
    for (const service of protoServices(sources.get(filePath) ?? "")) protoOf.set(service, filePath);
  }
  for (const [filePath, found] of semantics) {
    for (const service of [...found.serves, ...found.callsServices]) {
      const proto = protoOf.get(service);
      if (proto) addImport(filePath, proto, "contrato gRPC");
    }
  }
  const techByModule = new Map([...semantics].map(([id, found]) => [id, found.tech]));
  for (const edge of [...semanticEdges(semantics), ...compose.edges, ...infraEdgesByTech(techByModule, compose)]) {
    if (seen.has(edge.id)) continue;
    seen.add(edge.id);
    edges.push(edge);
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));

  const groupIds = [...new Set(modules.map((item) => item.groupId))].sort((left, right) => left.localeCompare(right));
  const describe = groupDescriber(sources, new Set(files.map((path) => path.split("/")[0] ?? "")));
  const groups: ModuleGroup[] = groupIds.map((id, index) => ({
    id,
    ...describe(id),
    color: GROUP_COLORS[index % GROUP_COLORS.length] ?? "zinc",
  }));

  // El mapa de producto no carga con tests, `__init__`, configs ni huérfanos (ver `pruneNonArchitectural`).
  return pruneNonArchitectural({ version: 1, projectName, groups, modules, edges });
}

/** Nombres de archivo que no dicen nada solos: varios `app.py` en el mapa serían «App», «App», «App». */
const GENERIC_STEMS: ReadonlySet<string> = new Set(["app", "main", "index", "init", "server", "mod", "lib", "routes", "router", "config", "settings", "utils", "types"]);
const LABEL_WRAPPERS: ReadonlySet<string> = new Set(["src", "app", "lib", "source"]);

/**
 * Un nombre por cosa en el mapa: `acceso/app.py` → «Acceso App» (no otro «App») y `bff/servicios/airflow.py` →
 * «Cliente Airflow» (no un segundo «Airflow» junto al servicio del compose).
 */
function disambiguateLabels(modules: CodeModule[], infra: readonly CodeModule[]): void {
  const infraLabels = new Set(infra.flatMap((item) => [item.label.toLowerCase(), ...(item.tech ?? [])]));
  for (const item of modules) {
    const lower = item.label.toLowerCase();
    if (infraLabels.has(lower)) {
      item.label = `Cliente ${item.label}`;
      continue;
    }
    if (!GENERIC_STEMS.has(lower)) continue;
    const parent = item.filePath.split("/").slice(0, -1).reverse().find((dir) => !LABEL_WRAPPERS.has(dir.toLowerCase()));
    if (parent) item.label = `${humanizePart(parent)} ${item.label}`;
  }
}

/**
 * Nombre y descripción de cada grupo. Las carpetas de primer nivel toman el título corto de la tabla del README
 * raíz («Chatbot RAG: LangChain…» → «Chatbot RAG») o su nombre humanizado (`parte1_gestos` → «Gestos»); la
 * descripción sale de esa tabla o del primer párrafo del README de la carpeta.
 */
function groupDescriber(sources: ReadonlyMap<string, string>, topFolders: ReadonlySet<string>): (id: string) => { label: string; summary?: string } {
  const rootReadme = [...sources].find(([path]) => isReadmePath(path) && !path.includes("/"))?.[1];
  const table = rootReadme ? readmePartDescriptions(rootReadme, topFolders) : new Map<string, string>();
  return (id) => {
    if (id === INFRA_GROUP) return { label: "Infraestructura", summary: "Servicios declarados en docker-compose" };
    if (!topFolders.has(id)) return { label: id };
    const folderReadme = [...sources].find(([path]) => isReadmePath(path) && path.split("/")[0] === id && path.includes("/"))?.[1];
    const summary = table.get(id) ?? (folderReadme ? readmeSummary(folderReadme) : null);
    const label = (summary ? shortPartLabel(summary) : null) ?? humanizePart(id);
    return summary ? { label, summary } : { label };
  };
}

import dagre, { type NodeLabel } from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import type { CodeModule, GroupColor, ModuleGroup, ModuleRole } from "@core/graph";
import { INFRA_GROUP, isInfraModuleId } from "@/lib/scan/composeScan";
import { humanizePart } from "@/lib/scan/readmeParts";
import { facetsOf } from "./abstractions";
import { filterNoise, isArchitectureModule, skeletonBlocks, type SystemNodeKind } from "./architectureSkeleton";
import { techLabel } from "@/lib/scan/semantics";
import { EDGE_STYLE, GROUP_STYLES } from "../theme";
import { inferRole } from "./architecture";
import { routeSystemEdges } from "./edgeRouting";
import { edgeMarker, mainEdgeStyle, SUBSYSTEM_NODE_PREFIX, type FlowResult, type SubsystemFlowNode } from "./flow";
import type { GraphPosition } from "./layout";
import type { PreparedGraph } from "./subsystems";

/**
 * Level 0 (zoom semántico): el lienzo abre con 4–8 bloques de arquitectura en vez de todos los módulos.
 *
 * - Monorepo multiparte (`parte1_gestos/`, `parte2_plataforma/`, `apps/web`…): un bloque por parte de primer
 *   nivel, con el nombre humano del grupo (README o carpeta humanizada) y la infraestructura del compose en su
 *   propio bloque. Las partes de más de `LEVEL0_SPLIT_SIZE` módulos se parten por subcarpeta mientras quepan.
 * - Resto: un bloque por subsistema visible (caja de `prepareGraph`) o, para lo que no cae en ninguno, la carpeta
 *   del módulo (`groupId`).
 *
 * Lo que sobra por encima de `LEVEL0_MAX_BLOCKS` se funde en «Otros». Click en un bloque → Level 1 filtrado a sus
 * módulos (`focusPrepared`).
 */

export const LEVEL0_MAX_BLOCKS = 8;
/** Por debajo de este número de módulos el detalle ya se lee de un vistazo: se salta Level 0. */
export const LEVEL0_MIN_MODULES = 12;
export const OTHER_BLOCK_ID = "other";
/** Nodo compacto tipo C4/Mermaid: icono + nombre + una tecnología (ver `SubsystemNode`). */
export const LEVEL0_NODE_WIDTH = 232;
export const LEVEL0_NODE_HEIGHT = 84;
/** Un bloque de parte con más módulos que esto se parte por subcarpeta (si queda sitio en el tope). */
export const LEVEL0_SPLIT_SIZE = 15;

/** Una carpeta con más de esta fracción de los módulos se parte por su siguiente subcarpeta. */
const DOMINANT_SHARE = 0.5;
const SAMPLE_SIZE = 3;
/** Partes de primer nivel que no son arquitectura: van a «Otros». */
const PERIPHERAL_PARTS: ReadonlySet<string> = new Set([
  "test", "tests", "__tests__", "spec", "e2e", "scripts", "tools", "docs", "doc", "examples", "example", "samples",
  "benchmarks", "bench", "fixtures", "notebooks", ".github",
]);
/** Contenedores de monorepo: la parte es `<contenedor>/<paquete>`. */
const PART_CONTAINERS: ReadonlySet<string> = new Set(["apps", "packages", "services", "libs", "modules"]);
/** Carpetas que envuelven código sin darle nombre: al partir un bloque se mira la siguiente. */
const WRAPPER_DIRS: ReadonlySet<string> = new Set(["src", "app", "lib", "source", "main", "python", "java"]);
/** El modo por partes necesita al menos este número de partes con ≥ 2 módulos que cubran esta fracción del grafo. */
const MIN_PARTS = 2;
const MIN_PART_COVERAGE = 0.6;
const PART_COLORS: readonly GroupColor[] = ["sky", "violet", "emerald", "amber", "rose"];

export interface Level0Block {
  id: string;
  label: string;
  color: GroupColor;
  /** Módulos principales y sus sub-nodos. */
  moduleIds: string[];
  /** Solo tarjetas principales (lo que se cuenta en la UI). */
  size: number;
  /** Etiquetas de los módulos más conectados, para la línea secundaria del bloque. */
  sample: string[];
  /** Rol dominante entre sus módulos. */
  role: ModuleRole;
  /** Tecnologías de sus módulos, de la más a la menos frecuente (nombres para mostrar). */
  tech: string[];
  /** Las mismas como ids (`mongodb`, `fastapi`…): de ahí sale el logo del nodo. */
  techIds: string[];
  /** Qué es la parte (README), si se sabe. */
  summary?: string;
  /** Qué representa: servicio de infra, app del compose, parte del repo o agrupación por carpeta/subsistema. */
  kind: SystemNodeKind | "group";
  /** Módulo que es el bloque (entrada del servicio o módulo infra): en un nodo hoja, el click lo selecciona. */
  primaryModuleId?: string;
  /** Abstracciones del bloque en el esqueleto («API», «Agente / LLM»…): lo que se ve al acercarse y al entrar. */
  facets: string[];
}

/** Nodo hoja: solo infraestructura (MongoDB, Prometheus · Grafana). No tiene detalle que abrir. */
export function isLeafBlock(block: Pick<Level0Block, "moduleIds">): boolean {
  return block.moduleIds.length > 0 && block.moduleIds.every(isInfraModuleId);
}

export interface Level0Edge {
  id: string;
  source: string;
  target: string;
  /** Aristas entre módulos que agrega. */
  weight: number;
}

export interface Level0Graph {
  blocks: Level0Block[];
  edges: Level0Edge[];
  blockOf: ReadonlyMap<string, string>;
  /** `system`: esqueleto de servicios (compose); `blocks`: partes del repo, subsistemas o carpetas. */
  style: "system" | "blocks";
}

interface RawBlock {
  id: string;
  label: string;
  color: GroupColor;
  principals: CodeModule[];
  summary?: string;
  /** Ruta de la carpeta que representa (modo partes): de ahí se parte por subcarpeta. */
  prefix?: string;
  kind?: SystemNodeKind;
  role?: ModuleRole;
  primaryModuleId?: string;
}

/** Subcarpeta inmediatamente debajo de la carpeta del grupo (`api/users/x.ts` con grupo `api` → `users`). */
function childFolder(item: CodeModule): string | null {
  const dirs = item.filePath.split("/").slice(0, -1);
  const at = dirs.indexOf(item.groupId);
  return at >= 0 ? (dirs[at + 1] ?? null) : null;
}

function rawBlocks(prepared: PreparedGraph): RawBlock[] {
  const { graph, subsystemOf } = prepared;
  const subsystems = new Map(prepared.subsystems.map((item) => [item.id, item]));
  const groups = new Map(graph.groups.map((item) => [item.id, item]));
  const principals = graph.modules.filter((item) => item.supportOf === undefined);

  const folderCount = new Map<string, number>();
  for (const item of principals) {
    if (!subsystemOf.has(item.id)) folderCount.set(item.groupId, (folderCount.get(item.groupId) ?? 0) + 1);
  }
  const dominant = new Set(
    [...folderCount].filter(([, count]) => count > principals.length * DOMINANT_SHARE && count >= LEVEL0_MIN_MODULES).map(([id]) => id),
  );

  const blocks = new Map<string, RawBlock>();
  const add = (id: string, label: string, color: GroupColor, item: CodeModule) => {
    const block = blocks.get(id) ?? { id, label, color, principals: [] };
    block.principals.push(item);
    blocks.set(id, block);
  };
  for (const item of principals) {
    const subsystem = subsystems.get(subsystemOf.get(item.id) ?? "");
    if (subsystem) {
      add(`sub:${subsystem.id}`, subsystem.label, subsystem.color, item);
      continue;
    }
    const group = groups.get(item.groupId);
    const label = group?.label ?? item.groupId;
    const color = group?.color ?? "zinc";
    const child = dominant.has(item.groupId) ? childFolder(item) : null;
    if (child) add(`group:${item.groupId}/${child}`, `${label}/${child}`, color, item);
    else add(`group:${item.groupId}`, label, color, item);
  }
  return [...blocks.values()];
}

/** Parte de primer nivel de un módulo: `infra` (compose), `apps/web`, `parte1_gestos` o "" (raíz). */
export function partOf(item: Pick<CodeModule, "id" | "filePath">): string {
  if (isInfraModuleId(item.id)) return INFRA_GROUP;
  const dirs = item.filePath.split("/").slice(0, -1);
  const first = dirs[0];
  if (first === undefined) return "";
  if (PART_CONTAINERS.has(first) && dirs.length >= 2) return `${first}/${dirs[1]}`;
  return first;
}

function isArchitecturePart(part: string): boolean {
  return part !== "" && part !== INFRA_GROUP && !PERIPHERAL_PARTS.has(part.toLowerCase());
}

/**
 * Partes del monorepo si el grafo las tiene: ≥ 2 carpetas de primer nivel (no periféricas) con ≥ 2 módulos
 * que juntas cubren la mayoría del código. Un repo con todo bajo `src/` no es multiparte.
 */
export function detectParts(principals: readonly CodeModule[]): string[] | null {
  const counts = new Map<string, number>();
  let code = 0;
  for (const item of principals) {
    const part = partOf(item);
    if (part === INFRA_GROUP) continue;
    code += 1;
    if (isArchitecturePart(part)) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  const parts = [...counts].filter(([, count]) => count >= 2);
  const covered = parts.reduce((total, [, count]) => total + count, 0);
  if (parts.length < MIN_PARTS || code === 0 || covered / code < MIN_PART_COVERAGE) return null;
  // Las de un solo módulo también son partes (p. ej. `integracion/`): `fitPartBlocks` decide si merecen bloque.
  return [...counts.keys()].sort();
}

/** Grupo del grafo que describe una parte (`apps/web` → grupo `web`). */
function groupForPart(part: string, groups: ReadonlyMap<string, ModuleGroup>): ModuleGroup | undefined {
  return groups.get(part) ?? groups.get(part.split("/").pop() ?? part);
}

function partLabel(part: string, group: ModuleGroup | undefined): string {
  if (group && group.label !== group.id) return group.label;
  if (part === INFRA_GROUP) return "Infraestructura";
  return humanizePart(part.split("/").pop() ?? part);
}

/** Subcarpeta con nombre propio debajo de `prefix` (saltando `src/`, `app/`…), o null si cuelga directamente. */
function childUnder(item: CodeModule, prefix: string): string | null {
  if (!item.filePath.startsWith(`${prefix}/`)) return null;
  const rest = item.filePath.slice(prefix.length + 1).split("/").slice(0, -1);
  let path = prefix;
  for (const dir of rest) {
    path = `${path}/${dir}`;
    if (!WRAPPER_DIRS.has(dir.toLowerCase())) return path;
  }
  return null;
}

/**
 * Parte un bloque grande por subcarpeta en como mucho `room` bloques: las subcarpetas más grandes van aparte y el
 * resto (más los archivos sueltos) queda en un bloque con el nombre de la parte. null si no hay reparto útil.
 * Si todo cuelga de una sola subcarpeta (`web/`), se baja un nivel antes de partir.
 */
function splitBlock(block: RawBlock, room: number, depth = 0): RawBlock[] | null {
  const prefix = block.prefix;
  if (!prefix || room < 2 || depth > 4) return null;
  const byChild = new Map<string, CodeModule[]>();
  const loose: CodeModule[] = [];
  for (const item of block.principals) {
    const child = childUnder(item, prefix);
    if (child) byChild.set(child, [...(byChild.get(child) ?? []), item]);
    else loose.push(item);
  }
  const buckets = [...byChild].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const only = buckets[0];
  if (buckets.length === 1 && loose.length === 0 && only) return splitBlock({ ...block, prefix: only[0] }, room, depth + 1);

  const big = buckets.filter(([, items]) => items.length >= 2);
  const needsRest = loose.length > 0 || big.length < buckets.length;
  const separate = big.slice(0, needsRest || big.length > room ? room - 1 : room);
  if (separate.length === 0 || (separate.length === 1 && !needsRest && big.length === 1)) return null;

  const kept = new Set(separate.map(([child]) => child));
  const rest = [...loose, ...buckets.filter(([child]) => !kept.has(child)).flatMap(([, items]) => items)];
  const pieces: RawBlock[] = separate.map(([child, items]) => {
    const piece: RawBlock = {
      id: `${block.id}/${child.slice(prefix.length + 1)}`,
      label: `${block.label} · ${humanizePart(child.split("/").pop() ?? child)}`,
      color: block.color,
      principals: items,
      prefix: child,
    };
    if (block.summary) piece.summary = block.summary;
    return piece;
  });
  if (rest.length > 0) {
    // Si el resto es casi todo una subcarpeta (`bff/` + un script suelto), se nombra por ella.
    const restChildren = buckets.filter(([child]) => !kept.has(child));
    const dominant = restChildren[0];
    const label = dominant && dominant[1].length >= rest.length * 0.75 ? `${block.label} · ${humanizePart(dominant[0].split("/").pop() ?? dominant[0])}` : block.label;
    const remainder: RawBlock = { id: `${block.id}/*`, label, color: block.color, principals: rest };
    if (block.summary) remainder.summary = block.summary;
    pieces.push(remainder);
  }
  return pieces.length >= 2 ? pieces : null;
}

/** Bloques por parte del monorepo (ver `detectParts`); lo periférico y la raíz se devuelven aparte para «Otros». */
function partBlocks(prepared: PreparedGraph, parts: readonly string[]): { blocks: RawBlock[]; spill: CodeModule[] } {
  const groups = new Map(prepared.graph.groups.map((item) => [item.id, item]));
  const principals = prepared.graph.modules.filter((item) => item.supportOf === undefined);
  const known = new Set([...parts, INFRA_GROUP]);
  const byPart = new Map<string, CodeModule[]>();
  const spill: CodeModule[] = [];
  for (const item of principals) {
    const part = partOf(item);
    if (known.has(part)) byPart.set(part, [...(byPart.get(part) ?? []), item]);
    else spill.push(item);
  }
  const blocks = [...byPart].map(([part, items], index): RawBlock => {
    const group = groupForPart(part, groups);
    const block: RawBlock = {
      id: `part:${part}`,
      label: partLabel(part, group),
      color: part === INFRA_GROUP ? "zinc" : (group?.color ?? PART_COLORS[index % PART_COLORS.length] ?? "zinc"),
      principals: items,
    };
    if (part !== INFRA_GROUP) block.prefix = part;
    if (group?.summary) block.summary = group.summary;
    return block;
  });
  return { blocks, spill };
}

/**
 * Tope de `LEVEL0_MAX_BLOCKS` en modo partes: las más pequeñas (y las de un solo módulo sin descripción) van a
 * «Otros»; después, mientras quede sitio, la parte más grande por encima de `LEVEL0_SPLIT_SIZE` se parte.
 */
function fitPartBlocks({ blocks, spill }: { blocks: RawBlock[]; spill: CodeModule[] }): RawBlock[] {
  const bySize = (left: RawBlock, right: RawBlock) => right.principals.length - left.principals.length || left.label.localeCompare(right.label);
  const tiny = (block: RawBlock) => block.principals.length < 2 && !block.summary && block.id !== `part:${INFRA_GROUP}`;
  let kept = [...blocks].sort(bySize).filter((block) => !tiny(block));
  const others = [...spill, ...blocks.filter(tiny).flatMap((block) => block.principals)];
  const cap = () => LEVEL0_MAX_BLOCKS - (others.length > 0 ? 1 : 0);
  while (kept.length > cap()) {
    const dropped = kept.pop();
    if (dropped) others.push(...dropped.principals);
  }

  const unsplittable = new Set<string>();
  for (;;) {
    const target = kept.filter((block) => block.principals.length > LEVEL0_SPLIT_SIZE && !unsplittable.has(block.id)).sort(bySize)[0];
    // El bloque partido deja su hueco: caben `room` piezas en su lugar.
    const room = cap() - kept.length + 1;
    if (!target || room < 2) break;
    const pieces = splitBlock(target, room);
    if (!pieces) {
      unsplittable.add(target.id);
      continue;
    }
    kept = kept.flatMap((block) => (block === target ? pieces : [block]));
    for (const piece of pieces) if (!piece.prefix) unsplittable.add(piece.id);
  }

  kept.sort(bySize);
  return others.length > 0 ? [...kept, { id: OTHER_BLOCK_ID, label: "Otros", color: "zinc", principals: others }] : kept;
}

/** Más grandes primero; «Otros» absorbe los bloques de un solo módulo y lo que no cabe en el tope. */
function mergeBlocks(raw: RawBlock[]): RawBlock[] {
  const sorted = [...raw].sort((left, right) => right.principals.length - left.principals.length || left.label.localeCompare(right.label));
  const singletons = sorted.filter((block) => block.principals.length === 1);
  let kept = singletons.length >= 2 && sorted.length - singletons.length >= 2 ? sorted.filter((block) => block.principals.length > 1) : sorted;
  let spill = sorted.filter((block) => !kept.includes(block));
  const room = spill.length > 0 ? LEVEL0_MAX_BLOCKS - 1 : LEVEL0_MAX_BLOCKS;
  if (kept.length > room) {
    spill = [...spill, ...kept.slice(LEVEL0_MAX_BLOCKS - 1)];
    kept = kept.slice(0, LEVEL0_MAX_BLOCKS - 1);
  }
  if (spill.length === 0) return kept;
  return [...kept, { id: OTHER_BLOCK_ID, label: "Otros", color: "zinc", principals: spill.flatMap((block) => block.principals) }];
}

function dominantRole(items: readonly CodeModule[]): ModuleRole {
  const counts = new Map<ModuleRole, number>();
  for (const item of items) {
    const role = item.role ?? inferRole(item);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best: ModuleRole = "code";
  let bestCount = 0;
  for (const [role, count] of counts) {
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

/** Nombres de archivo que no dicen nada solos («Index · Index»): se les antepone la carpeta. */
const GENERIC_LABELS: ReadonlySet<string> = new Set(["index", "init", "main", "app", "mod", "lib", "page", "layout", "route", "routes", "types", "utils", "server", "config", "settings"]);

/** Etiqueta para la muestra de un bloque: «Captura App» en vez de «App». */
export function sampleLabel(item: Pick<CodeModule, "label" | "filePath">): string {
  const plainLabel = item.label.replace(/^_+|_+$/g, "").toLowerCase();
  if (!GENERIC_LABELS.has(plainLabel)) return item.label;
  const parent = item.filePath.split("/").slice(0, -1).reverse().find((dir) => !WRAPPER_DIRS.has(dir.toLowerCase()));
  return parent ? `${humanizePart(parent)} ${item.label}` : item.label;
}

/** Tests, `__init__` y configuración dicen poco de un bloque: van al final de la muestra. */
function isWeakSample(item: Pick<CodeModule, "filePath">): boolean {
  return /(^|\/)(tests?|__tests__|spec)\/|(^|\/)(test_[^/]*|[^/]*\.(test|spec)\.[a-z]+|__init__\.py|[^/]*\.config\.[a-z]+)$/i.test(item.filePath);
}

/**
 * Tecnologías de un bloque (ids de `detectSemantics`), de la más a la menos frecuente. Las del módulo que *es* el
 * bloque van primero: el nodo Prometheus · Grafana es ante todo Prometheus.
 */
function blockTechIds(items: readonly CodeModule[], primaryModuleId?: string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const tech of item.tech ?? []) counts.set(tech, (counts.get(tech) ?? 0) + 1);
  const primary = items.find((item) => item.id === primaryModuleId)?.tech ?? [];
  const rest = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([tech]) => tech);
  return [...new Set([...primary, ...rest])];
}

export function buildLevel0(prepared: PreparedGraph): Level0Graph {
  const { graph } = prepared;
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const skeleton = skeletonBlocks(prepared);
  const parts = skeleton ? null : detectParts(graph.modules.filter((item) => item.supportOf === undefined));
  const merged: RawBlock[] = skeleton
    ? skeleton.map(({ modules, ...block }) => ({ ...block, principals: modules }))
    : parts
      ? fitPartBlocks(partBlocks(prepared, parts))
      : mergeBlocks(rawBlocks(prepared));
  const blockOf = new Map<string, string>();
  for (const block of merged) for (const item of block.principals) blockOf.set(item.id, block.id);
  for (const item of graph.modules) {
    if (item.supportOf === undefined) continue;
    const owner = blockOf.get(item.supportOf);
    if (owner) blockOf.set(item.id, owner);
  }

  const moduleIds = new Map<string, string[]>();
  for (const item of graph.modules) {
    const id = blockOf.get(item.id);
    if (id) moduleIds.set(id, [...(moduleIds.get(id) ?? []), item.id]);
  }

  const blocks = merged.map((block): Level0Block => {
    const ranked = [...block.principals].sort(
      (left, right) =>
        Number(isWeakSample(left)) - Number(isWeakSample(right)) ||
        (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) ||
        left.label.localeCompare(right.label),
    );
    const meaningful = ranked.filter(isArchitectureModule);
    const techIds = blockTechIds(block.principals, block.primaryModuleId);
    const level0Block: Level0Block = {
      id: block.id,
      label: block.label,
      color: block.color,
      moduleIds: moduleIds.get(block.id) ?? [],
      // En el esqueleto se cuentan solo los módulos con peso arquitectónico (sin `__init__`, tests ni configs).
      size: skeleton ? Math.max(1, meaningful.length) : block.principals.length,
      sample: [...new Set((meaningful.length > 0 ? meaningful : ranked).map(sampleLabel))].slice(0, SAMPLE_SIZE),
      role: block.role ?? dominantRole(block.principals),
      tech: [...new Set(techIds.map(techLabel))],
      techIds,
      kind: block.kind ?? "group",
      facets: skeleton ? facetsOf(block.principals).map((facet) => facet.label) : [],
    };
    if (block.summary) level0Block.summary = block.summary;
    if (block.primaryModuleId) level0Block.primaryModuleId = block.primaryModuleId;
    return level0Block;
  });

  const weights = new Map<string, Level0Edge>();
  for (const edge of graph.edges) {
    const source = blockOf.get(edge.source);
    const target = blockOf.get(edge.target);
    if (!source || !target || source === target) continue;
    const id = `level0:${source}→${target}`;
    const current = weights.get(id);
    if (current) current.weight += 1;
    else weights.set(id, { id, source, target, weight: 1 });
  }
  const edges = [...weights.values()].sort((left, right) => left.id.localeCompare(right.id));
  return { blocks, edges, blockOf, style: skeleton ? "system" : "blocks" };
}

/** Level 0 solo tiene sentido con un grafo mediano que se reparte en al menos dos bloques. */
export function shouldUseLevel0(prepared: PreparedGraph, level0: Level0Graph): boolean {
  const principals = prepared.graph.modules.filter((item) => item.supportOf === undefined).length;
  return principals >= LEVEL0_MIN_MODULES && level0.blocks.length >= 2;
}

/** Posiciones de los bloques (esquina superior izquierda), izquierda → derecha siguiendo las dependencias. */
/**
 * Columnas del diagrama de sistema, en el orden en que viaja el dato (como el Mermaid de un README):
 * entrada → API de ingesta → cola → procesado → almacenamiento → API de lectura → consumidores (bots, LLM) → observabilidad.
 */
export const SYSTEM_LAYER = { entry: 0, ingest: 1, queue: 2, process: 3, store: 4, api: 5, consumers: 6, observability: 7 } as const;

const INFRA_LAYER: Partial<Record<ModuleRole, number>> = {
  broker: SYSTEM_LAYER.queue,
  stream: SYSTEM_LAYER.process,
  pipeline: SYSTEM_LAYER.process,
  database: SYSTEM_LAYER.store,
  cache: SYSTEM_LAYER.store,
  "ai-model": SYSTEM_LAYER.consumers,
  util: SYSTEM_LAYER.observability,
  api: SYSTEM_LAYER.ingest,
  rpc: SYSTEM_LAYER.ingest,
};

/**
 * Columna de cada nodo del esqueleto. La infra va por rol; una app que escribe en la cola es ingesta; una API que lee
 * del almacenamiento es la API de lectura; lo que nadie llama y alimenta la ingesta (gestos, simulador, BFF) es
 * entrada; el resto (chatbots) son consumidores.
 */
export function systemLayers(level0: Pick<Level0Graph, "blocks" | "edges">): Map<string, number> {
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const out = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const edge of level0.edges) {
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const roleOf = (id: string) => byId.get(id)?.role;
  const layers = new Map<string, number>();
  for (const block of level0.blocks) {
    if (block.kind === "infra") layers.set(block.id, INFRA_LAYER[block.role] ?? SYSTEM_LAYER.store);
    else if ((out.get(block.id) ?? []).some((id) => roleOf(id) === "broker")) layers.set(block.id, SYSTEM_LAYER.ingest);
  }
  for (const block of level0.blocks) {
    if (layers.has(block.id)) continue;
    const feedsIngest = (out.get(block.id) ?? []).some((id) => layers.get(id) === SYSTEM_LAYER.ingest);
    if (block.kind === "part" || ((incoming.get(block.id) ?? 0) === 0 && feedsIngest)) layers.set(block.id, SYSTEM_LAYER.entry);
    else if (block.role === "api" || block.role === "rpc") layers.set(block.id, SYSTEM_LAYER.api);
    else layers.set(block.id, SYSTEM_LAYER.consumers);
  }
  return layers;
}

const SYSTEM_COLUMN_GAP = 110;
const SYSTEM_ROW_GAP = 36;
const ORDER_SWEEPS = 4;

/**
 * Posiciones del esqueleto: una columna por capa (sin huecos) y, dentro de cada una, orden por baricentro de los
 * vecinos (varias pasadas) para cruzar pocas flechas. Determinista: empates por nombre.
 */
/** Alto de una fila de abstracción en un nodo desplegado (vista «Arquitectura»). */
export const FACET_ROW_HEIGHT = 22;

/** Alto del nodo: compacto en «Sistema»; en «Arquitectura», además, una fila por abstracción del servicio. */
export function level0NodeHeight(block: Pick<Level0Block, "facets">, expanded = false): number {
  return expanded && block.facets.length > 0 ? LEVEL0_NODE_HEIGHT + block.facets.length * FACET_ROW_HEIGHT + 10 : LEVEL0_NODE_HEIGHT;
}

function layoutSystem(level0: Level0Graph, expanded: boolean): Map<string, GraphPosition> {
  const layers = systemLayers(level0);
  const used = [...new Set(layers.values())].sort((left, right) => left - right);
  const columnOf = new Map([...layers].map(([id, layer]) => [id, used.indexOf(layer)]));
  const columns: string[][] = used.map(() => []);
  for (const block of [...level0.blocks].sort((left, right) => left.label.localeCompare(right.label))) columns[columnOf.get(block.id) ?? 0]?.push(block.id);

  const neighbours = new Map<string, string[]>();
  for (const edge of level0.edges) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  const rank = new Map<string, number>();
  const refresh = () => columns.forEach((column) => column.forEach((id, index) => rank.set(id, index - (column.length - 1) / 2)));
  refresh();
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep += 1) {
    for (const column of columns) {
      const score = new Map(
        column.map((id) => {
          const around = (neighbours.get(id) ?? []).filter((other) => columnOf.get(other) !== columnOf.get(id)).map((other) => rank.get(other) ?? 0);
          return [id, around.length > 0 ? around.reduce((total, value) => total + value, 0) / around.length : (rank.get(id) ?? 0)];
        }),
      );
      column.sort((left, right) => (score.get(left) ?? 0) - (score.get(right) ?? 0) || left.localeCompare(right));
    }
    refresh();
  }

  // Cada columna se apila con la altura real de sus nodos y se centra en vertical.
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const heightOf = (id: string) => {
    const block = byId.get(id);
    return block ? level0NodeHeight(block, expanded) : LEVEL0_NODE_HEIGHT;
  };
  const positions = new Map<string, GraphPosition>();
  columns.forEach((column, index) => {
    const total = column.reduce((sum, id) => sum + heightOf(id), 0) + SYSTEM_ROW_GAP * Math.max(0, column.length - 1);
    let y = -total / 2;
    for (const id of column) {
      positions.set(id, { x: index * (LEVEL0_NODE_WIDTH + SYSTEM_COLUMN_GAP), y });
      y += heightOf(id) + SYSTEM_ROW_GAP;
    }
  });
  return positions;
}

/** `expanded`: vista «Arquitectura» del mapa de sistema (cada servicio desplegado en sus abstracciones). */
export function layoutLevel0(level0: Level0Graph, options: { expanded?: boolean } = {}): Map<string, GraphPosition> {
  if (level0.style === "system") return layoutSystem(level0, options.expanded === true);
  const laid = new dagre.graphlib.Graph<Record<string, unknown>, NodeLabel, Record<string, unknown>>();
  laid.setDefaultEdgeLabel(() => ({}));
  laid.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120, marginx: 24, marginy: 24 });
  for (const block of level0.blocks) laid.setNode(block.id, { width: LEVEL0_NODE_WIDTH, height: LEVEL0_NODE_HEIGHT });
  for (const edge of level0.edges) laid.setEdge(edge.source, edge.target, { weight: edge.weight });
  dagre.layout(laid);
  const positions = new Map<string, GraphPosition>();
  for (const block of level0.blocks) {
    const node = laid.node(block.id);
    positions.set(block.id, { x: (node?.x ?? 0) - LEVEL0_NODE_WIDTH / 2, y: (node?.y ?? 0) - LEVEL0_NODE_HEIGHT / 2 });
  }
  return positions;
}

/**
 * Level 1 de un bloque: el mismo `PreparedGraph` recortado a sus módulos y a las aristas internas, sin ruido
 * (`filterNoise`: `__init__`, tests, configs). Los servicios de infraestructura con los que habla (MongoDB,
 * Redpanda…) entran también, para que se vea cómo se engancha el bloque al resto del sistema.
 * Los aislados ya los quitó `prepareGraph` sobre el grafo completo: aquí no se vuelve a filtrar,
 * así que un módulo que solo habla con otros bloques sigue apareciendo.
 */
export function focusPrepared(prepared: PreparedGraph, block: Level0Block): PreparedGraph {
  const own = new Set(block.moduleIds);
  const keep = new Set(own);
  for (const edge of prepared.graph.edges) {
    if (own.has(edge.source) && isInfraModuleId(edge.target)) keep.add(edge.target);
    else if (own.has(edge.target) && isInfraModuleId(edge.source)) keep.add(edge.source);
  }
  const modules = prepared.graph.modules.filter((item) => keep.has(item.id));
  const edges = prepared.graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  const subsystemOf = new Map([...prepared.subsystemOf].filter(([id]) => keep.has(id)));
  const used = new Set(subsystemOf.values());
  return filterNoise({
    graph: { ...prepared.graph, modules, edges },
    layerOf: prepared.layerOf,
    subsystemOf,
    subsystems: prepared.subsystems.filter((item) => used.has(item.id)),
    hidden: prepared.hidden,
  });
}

/** Nodos (bloques clicables) y aristas agregadas de Level 0. El grosor del cable crece con las dependencias que resume. */
export function level0Flow(level0: Level0Graph, positions: ReadonlyMap<string, GraphPosition>, options: { expanded?: boolean } = {}): FlowResult {
  const expanded = options.expanded === true && level0.style === "system";
  // En el esqueleto la flecha sigue al dato (columna menor → mayor): «Chatbot usa API acceso» se dibuja API acceso → Chatbot.
  const layers = level0.style === "system" ? systemLayers(level0) : null;
  const colorOf = new Map(level0.blocks.map((block) => [block.id, GROUP_STYLES[block.color].hex]));
  const nodes: SubsystemFlowNode[] = level0.blocks.map((block) => ({
    id: `${SUBSYSTEM_NODE_PREFIX}${block.id}`,
    type: "subsystem",
    position: positions.get(block.id) ?? { x: 0, y: 0 },
    width: LEVEL0_NODE_WIDTH,
    height: level0NodeHeight(block, expanded),
    data: {
      label: block.label,
      color: block.color,
      level0: {
        blockId: block.id,
        expanded,
        size: block.size,
        sample: block.sample,
        tech: block.tech,
        techIds: block.techIds,
        kind: block.kind,
        role: block.role,
        ...(block.summary ? { summary: block.summary } : {}),
        facets: block.facets,
        ...(block.primaryModuleId ? { logoModuleId: block.primaryModuleId } : {}),
        ...(block.primaryModuleId && isLeafBlock(block) ? { primaryModuleId: block.primaryModuleId } : {}),
      },
    },
  }));
  const edges: Edge[] = level0.edges.map((edge) => {
    const flipped = layers !== null && (layers.get(edge.source) ?? 0) > (layers.get(edge.target) ?? 0);
    const source = flipped ? edge.target : edge.source;
    const target = flipped ? edge.source : edge.target;
    const color = colorOf.get(source) ?? EDGE_STYLE.neutral;
    return {
      id: edge.id,
      source: `${SUBSYSTEM_NODE_PREFIX}${source}`,
      target: `${SUBSYSTEM_NODE_PREFIX}${target}`,
      type: "system",
      // En el esqueleto de sistema el grosor ya dice el peso: sin números, como un diagrama de pizarra.
      ...(level0.style === "blocks"
        ? { label: String(edge.weight), labelStyle: { fontSize: 11, fill: "#525252" }, labelBgStyle: { fill: "#ffffff" } }
        : {}),
      markerEnd: edgeMarker(color),
      style: { ...mainEdgeStyle(color), strokeWidth: EDGE_STYLE.width + Math.min(4, Math.log2(edge.weight)) },
    };
  });
  // Rectas si hay tiro libre; si no, polilínea que esquiva otras tarjetas (evita las Bezier que cruzan nodos).
  const routes = routeSystemEdges(
    nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? LEVEL0_NODE_WIDTH,
      height: node.height ?? LEVEL0_NODE_HEIGHT,
    })),
    edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  );
  for (const edge of edges) {
    const points = routes.get(edge.id);
    if (points) edge.data = { points };
  }
  return { nodes, edges, hiddenEdges: 0 };
}

/** Umbrales del zoom semántico: por debajo de 0.7 solo nombres; por encima de 1.2, los módulos clave de cada nodo. */
export const RESOLUTION_ZOOM = { detail: 0.7, modules: 1.2 } as const;
/** Acercarse hasta aquí sobre un bloque de Level 0 entra en él (el zoom máximo del lienzo es 1.5). */
export const AUTO_DRILL_ZOOM = 1.45;

export function archResolutionFor(zoom: number): 0 | 1 | 2 {
  if (zoom < RESOLUTION_ZOOM.detail) return 0;
  return zoom > RESOLUTION_ZOOM.modules ? 2 : 1;
}

export interface BlockNeighbour {
  block: Level0Block;
  /** `out`: el bloque abierto depende de él / le envía datos; `in`: al revés. */
  direction: "in" | "out";
  weight: number;
}

/** Bloques de Level 0 conectados con `blockId`, los de más dependencias primero. */
export function blockNeighbours(level0: Level0Graph, blockId: string): BlockNeighbour[] {
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  const found: BlockNeighbour[] = [];
  for (const edge of level0.edges) {
    const other = edge.source === blockId ? edge.target : edge.target === blockId ? edge.source : null;
    const block = other ? byId.get(other) : undefined;
    if (block) found.push({ block, direction: edge.source === blockId ? "out" : "in", weight: edge.weight });
  }
  return found.sort((left, right) => right.weight - left.weight || left.block.label.localeCompare(right.block.label));
}

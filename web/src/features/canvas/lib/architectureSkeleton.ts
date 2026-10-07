import type { CodeGraph, CodeModule, GroupColor, ModuleEdge, ModuleRole } from "@core/graph";
import { isInfraModuleId } from "@/lib/scan/composeScan";
import { humanizePart } from "@/lib/scan/readmeParts";
import type { PreparedGraph } from "./subsystems";

/**
 * Esqueleto de sistema para Level 0: el diagrama que dibujaría alguien en una pizarra (Captura → Redpanda → Spark →
 * MongoDB → API acceso → chatbots), no las carpetas del monorepo.
 *
 * - Un nodo por servicio de infraestructura del compose (`infra:*`).
 * - Un nodo por app del compose (el archivo que arranca `uvicorn`, `chainlit`…): posee los módulos que importa
 *   (BFS por imports) y los de su carpeta. Capas de UI (SPA, BFF, portal) no entran: son periferia del flujo.
 * - El código que ejecuta un runtime de infra (jobs de Spark, DAGs de Airflow) cuelga de ese nodo.
 * - Las partes del repo sin ningún servicio desplegado (p. ej. gestos, que corre fuera del compose) quedan como un
 *   nodo de app; scripts, tests y el front no entran en el esqueleto.
 *
 * Todo sale del grafo ya construido (compose + imports + semántica): sin LLM.
 */

export type SystemNodeKind = "infra" | "service" | "part";

export interface SkeletonBlock {
  id: string;
  label: string;
  color: GroupColor;
  kind: SystemNodeKind;
  role: ModuleRole;
  modules: CodeModule[];
  summary?: string;
  /** Módulo que representa el nodo (la entrada del servicio o el módulo infra). */
  primaryModuleId?: string;
}

/** Servicios de arranque: preparan algo y terminan; no son parte del diagrama. */
const SETUP_SERVICE = /(^|[-_])(init|setup|migrate|migrations|seed|bootstrap|modelo|model-pull)$/i;
/**
 * Capas de presentación (SPA, BFF, portal): no son el flujo de datos del sistema. El mapa enseña captura →
 * cola → procesado → stores → APIs → chatbots; el front es periferia.
 */
const UI_SERVICE = /(^|[-_])(frontend|front|portal|bff|webui|web-ui|spa|static)([-_]|$)|^(web|ui)$/i;
/** Etiquetas/carpetas de UI aunque el README las humanice («Portal corporativo web», `parte4_frontend`). */
const UI_SURFACE =
  /\b(portal|frontend|front[-_]?end|\bbff\b|corporativo|\bspa\b|interfaz|landing|web\s*app|panel\s*web|explorador\s*web)\b/i;

/** true si la carpeta o su etiqueta son capa de presentación (no arquitectura de datos). */
export function isUiSurface(folder: string, label?: string): boolean {
  const stem = folder.replace(/^(parte?|part|fase|phase|step|paso|modulo|module)[-_ ]?\d+[a-z]?[-_ ]*/i, "").replace(/^\d+[-_ ]+/, "");
  if (UI_SERVICE.test(folder) || UI_SERVICE.test(stem) || (label !== undefined && UI_SERVICE.test(label))) return true;
  if (PERIPHERAL_FOLDERS.has(folder.toLowerCase()) || PERIPHERAL_FOLDERS.has(stem.toLowerCase())) return true;
  return UI_SURFACE.test(`${folder} ${stem} ${label ?? ""}`);
}
/** Infra que ejecuta código del repo: sus jobs/DAGs se ven dentro de su nodo. */
const RUNTIME_ROLES: ReadonlySet<ModuleRole> = new Set(["stream", "pipeline"]);
const PERIPHERAL_FOLDERS: ReadonlySet<string> = new Set([
  "test", "tests", "__tests__", "spec", "e2e", "scripts", "tools", "docs", "doc", "examples", "example", "samples",
  "benchmarks", "bench", "fixtures", "notebooks", ".github", "data",
  "portal", "frontend", "front", "bff", "web", "ui", "spa",
]);
/** Una parte sin servicio necesita al menos estos módulos con peso arquitectónico para ganarse un nodo. */
const MIN_PART_MODULES = 3;
/** Etiquetas que solo pone el compose (`scanCompose`): delatan la entrada de un servicio en grafos sin `service`. */
const COMPOSE_EDGE_LABELS: ReadonlySet<string> = new Set(["HTTP", "depends_on"]);
/** Nombres de archivo de entrada: si varios servicios arrancan en la misma carpeta, manda este. */
const ENTRY_STEMS: ReadonlySet<string> = new Set(["app", "main", "server", "index", "__main__", "api"]);
const WRAPPER_DIRS: ReadonlySet<string> = new Set(["src", "app", "lib", "source"]);

export const ROLE_COLOR: Readonly<Partial<Record<ModuleRole, GroupColor>>> = {
  api: "sky",
  rpc: "sky",
  ui: "sky",
  app: "sky",
  database: "emerald",
  cache: "emerald",
  broker: "rose",
  stream: "amber",
  pipeline: "amber",
  "ai-model": "violet",
  prompt: "violet",
  util: "zinc",
};

/** Ruido para la arquitectura: `__init__`, tests, configuración de herramientas, stories, declaraciones de tipos. */
const NOISE_PATH =
  /(^|\/)(__init__\.py|conftest\.py|setup\.py)$|(^|\/)(tests?|__tests__|spec|e2e|__mocks__|fixtures|__fixtures__)\/|(^|\/)test_[^/]*$|\.(test|spec|stories)\.[a-z]+$|(^|\/)[^/]*\.config\.[cm]?[jt]s$|\.d\.ts$/i;

/** true si el módulo explica la arquitectura (no es `__init__`, test ni config). Los módulos infra siempre cuentan. */
export function isArchitectureModule(item: Pick<CodeModule, "id" | "filePath">): boolean {
  return isInfraModuleId(item.id) || !NOISE_PATH.test(item.filePath);
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

function topFolder(path: string): string {
  return path.includes("/") ? (path.split("/")[0] ?? "") : "";
}

function stemOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "").toLowerCase();
}

interface Entry {
  item: CodeModule;
  service: string;
}

/**
 * Entradas de servicio: los módulos que el compose marcó con `service`. En grafos importados antes de existir ese
 * campo, las que tocan una arista que solo emite el compose (`HTTP`, `depends_on`), con el nombre de su carpeta.
 */
function serviceEntries(principals: readonly CodeModule[], edges: readonly ModuleEdge[]): Entry[] {
  const tagged = principals.filter((item) => item.service !== undefined && !isInfraModuleId(item.id));
  const found: Entry[] = tagged.map((item) => ({ item, service: item.service ?? item.label }));
  if (found.length === 0) {
    const touched = new Set<string>();
    for (const edge of edges) {
      if (!edge.label || !COMPOSE_EDGE_LABELS.has(edge.label)) continue;
      touched.add(edge.source);
      touched.add(edge.target);
    }
    for (const item of principals) {
      if (!touched.has(item.id) || isInfraModuleId(item.id)) continue;
      const dirs = item.filePath.split("/").slice(0, -1).filter((dir) => !WRAPPER_DIRS.has(dir.toLowerCase()));
      found.push({ item, service: dirs[dirs.length - 1] ?? stemOf(item.filePath) });
    }
  }
  return found
    .filter((entry) => !SETUP_SERVICE.test(entry.service) && !isUiSurface(entry.service) && entry.item.role !== "ui")
    .sort((left, right) => left.item.id.localeCompare(right.item.id));
}

/** «acceso» (api) → «API acceso»; «chatbot-rag» → «Chatbot RAG»; «frontend» → «Frontend». */
export function serviceLabel(service: string, role: ModuleRole | undefined): string {
  const human = humanizePart(service);
  if ((role === "api" || role === "rpc") && !/(api|front|web|ui|portal|gateway|bff)/i.test(service)) {
    return `API ${human.charAt(0).toLowerCase()}${human.slice(1)}`;
  }
  return human;
}

/**
 * Bloques del esqueleto, o null si el grafo no describe un sistema desplegable (sin compose, o sin ningún servicio
 * con código): entonces Level 0 sigue agrupando por partes o subsistemas.
 */
export function skeletonBlocks(prepared: PreparedGraph): SkeletonBlock[] | null {
  const { graph } = prepared;
  const principals = graph.modules.filter((item) => item.supportOf === undefined);
  const infra = principals.filter((item) => isInfraModuleId(item.id));
  const allEntries = serviceEntries(principals, graph.edges);
  if (allEntries.length === 0 || infra.length + allEntries.length < 3) return null;

  // Un servicio lógico por carpeta: `chatbot-rag` (app.py) y `rag-indexar` (indexar.py) son el mismo nodo.
  const byDir = new Map<string, Entry[]>();
  for (const entry of allEntries) byDir.set(dirOf(entry.item.filePath), [...(byDir.get(dirOf(entry.item.filePath)) ?? []), entry]);
  const leads: Entry[] = [];
  const leadOf = new Map<string, Entry>();
  for (const group of byDir.values()) {
    const lead = group.find((entry) => ENTRY_STEMS.has(stemOf(entry.item.filePath))) ?? group[0]!;
    leads.push(lead);
    for (const entry of group) leadOf.set(entry.item.id, lead);
  }
  leads.sort((left, right) => left.item.id.localeCompare(right.item.id));
  const entries = allEntries.map((entry) => entry.item);

  const byId = new Map(principals.map((item) => [item.id, item]));
  const owner = new Map<string, string>();
  const blockOfEntry = (item: CodeModule) => `svc:${leadOf.get(item.id)?.item.id ?? item.id}`;
  for (const item of entries) owner.set(item.id, blockOfEntry(item));
  const entryDir = new Map(leads.map((lead) => [blockOfEntry(lead.item), dirOf(lead.item.filePath)]));

  // 1) Lo que importa cada servicio (BFS por niveles; en empate, el servicio de la misma carpeta).
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "imports" || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
  }
  let frontier = entries.map((item) => item.id);
  while (frontier.length > 0) {
    const claims = new Map<string, string[]>();
    for (const id of frontier) {
      const from = owner.get(id);
      if (!from) continue;
      for (const target of out.get(id) ?? []) {
        if (owner.has(target) || isInfraModuleId(target)) continue;
        claims.set(target, [...(claims.get(target) ?? []), from]);
      }
    }
    for (const [target, candidates] of claims) {
      const path = byId.get(target)?.filePath ?? target;
      const local = candidates.filter((block) => {
        const dir = entryDir.get(block) ?? "";
        return dir !== "" && path.startsWith(`${dir}/`);
      });
      owner.set(target, [...(local.length > 0 ? local : candidates)].sort()[0] ?? candidates[0]!);
    }
    frontier = [...claims.keys()];
  }

  // 2) Lo que vive en la carpeta de un servicio (la más profunda que lo contiene).
  for (const item of principals) {
    if (owner.has(item.id) || isInfraModuleId(item.id)) continue;
    let best: { block: string; depth: number } | null = null;
    for (const [block, dir] of entryDir) {
      if (dir === "" || !item.filePath.startsWith(`${dir}/`)) continue;
      const depth = dir.split("/").length;
      if (!best || depth > best.depth || (depth === best.depth && block < best.block)) best = { block, depth };
    }
    if (best) owner.set(item.id, best.block);
  }

  // 3) Código que ejecuta un runtime de infra (Spark, Airflow): dentro de ese nodo.
  const runtime = new Set(infra.filter((item) => item.role !== undefined && RUNTIME_ROLES.has(item.role)).map((item) => item.id));
  for (const edge of [...graph.edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = byId.get(edge.source);
    if (!runtime.has(edge.target) || !source || owner.has(source.id) || isInfraModuleId(source.id)) continue;
    // Tests y scripts que citan Spark/Airflow no son jobs.
    if (!isArchitectureModule(source) || PERIPHERAL_FOLDERS.has(topFolder(source.filePath).toLowerCase())) continue;
    owner.set(source.id, `sys:${edge.target}`);
  }

  const blocks: SkeletonBlock[] = [];
  const membersOf = (block: string) => principals.filter((item) => owner.get(item.id) === block);

  for (const item of infra) {
    const id = `sys:${item.id}`;
    const role = item.role ?? "database";
    blocks.push({ id, label: item.label, color: ROLE_COLOR[role] ?? "zinc", kind: "infra", role, modules: [item, ...membersOf(id)], primaryModuleId: item.id });
  }
  for (const { item, service } of leads) {
    const id = blockOfEntry(item);
    const role = item.role ?? "service";
    blocks.push({
      id,
      label: serviceLabel(service, role),
      color: ROLE_COLOR[role] ?? "sky",
      kind: "service",
      role,
      modules: membersOf(id),
      primaryModuleId: item.id,
    });
  }

  // 4) Partes del repo sin ningún servicio desplegado: un nodo de app con su código (si tiene peso).
  const servedFolders = new Set([...owner].filter(([, block]) => block.startsWith("svc:")).map(([id]) => topFolder(byId.get(id)?.filePath ?? "")));
  const leftovers = new Map<string, CodeModule[]>();
  for (const item of principals) {
    if (owner.has(item.id) || isInfraModuleId(item.id)) continue;
    const folder = topFolder(item.filePath);
    if (folder === "" || servedFolders.has(folder) || PERIPHERAL_FOLDERS.has(folder.toLowerCase())) continue;
    leftovers.set(folder, [...(leftovers.get(folder) ?? []), item]);
  }
  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  for (const [folder, items] of [...leftovers].sort(([left], [right]) => left.localeCompare(right))) {
    if (items.filter(isArchitectureModule).length < MIN_PART_MODULES) continue;
    const group = groups.get(folder);
    const label = group && group.label !== group.id ? group.label : humanizePart(folder);
    // SPA / portal / BFF: aunque el README les ponga un nombre bonito, no entran en el mapa de sistema.
    if (isUiSurface(folder, label)) continue;
    const block: SkeletonBlock = {
      id: `part:${folder}`,
      label,
      color: group?.color ?? "violet",
      kind: "part",
      role: "app",
      modules: items,
    };
    if (group?.summary) block.summary = group.summary;
    blocks.push(block);
  }
  return absorbInternalInfra(blocks, graph.edges).filter((block) => !(block.kind === "part" && isUiSurface(block.id.replace(/^part:/, ""), block.label)));
}

/**
 * Infra que solo usa otra infra (el PostgreSQL de Airflow, Grafana sobre Prometheus) no es parte del flujo: se funde
 * en el nodo al que sirve. Si comparten rol (Prometheus · Grafana) el nombre los lleva a los dos; si no, se queda el
 * del nodo principal (Airflow). Así ninguna tecnología aparece dos veces ni como satélite suelto.
 */
function absorbInternalInfra(blocks: SkeletonBlock[], edges: readonly ModuleEdge[]): SkeletonBlock[] {
  const blockOf = new Map<string, SkeletonBlock>();
  for (const block of blocks) for (const item of block.modules) blockOf.set(item.id, block);
  const neighbours = new Map<SkeletonBlock, Set<SkeletonBlock>>();
  for (const edge of edges) {
    const source = blockOf.get(edge.source);
    const target = blockOf.get(edge.target);
    if (!source || !target || source === target) continue;
    neighbours.set(source, (neighbours.get(source) ?? new Set()).add(target));
    neighbours.set(target, (neighbours.get(target) ?? new Set()).add(source));
  }
  const absorbed = new Set<SkeletonBlock>();
  for (const block of blocks) {
    if (block.kind !== "infra" || block.modules.some((item) => !isInfraModuleId(item.id))) continue;
    const around = [...(neighbours.get(block) ?? [])];
    const host = around[0];
    if (around.length !== 1 || !host || host.kind !== "infra" || absorbed.has(host)) continue;
    // Solo se absorbe hacia el nodo con más conexiones (Grafana → Prometheus, no al revés).
    if ((neighbours.get(host)?.size ?? 0) <= 1 && host.id > block.id) continue;
    // Y solo lo que es de verdad interno: mismo papel (observabilidad) o servicios con el nombre del anfitrión
    // (`airflow-db`). El S3 que solo toca Airflow sigue siendo el data lake del sistema.
    const hostKey = (host.primaryModuleId ?? host.id).replace(/^.*:/, "").toLowerCase();
    const services = block.modules.flatMap((item) => item.subBlocks.map((sub) => sub.name.toLowerCase()));
    const internal = host.role === block.role || (services.length > 0 && services.every((name) => name.startsWith(`${hostKey}-`)));
    if (!internal) continue;
    host.modules.push(...block.modules);
    if (host.role === block.role) host.label = `${host.label} · ${block.label}`;
    absorbed.add(block);
  }
  return blocks.filter((block) => !absorbed.has(block));
}

/** Carpetas de ejemplos: código de muestra, no del sistema. */
const EXAMPLE_PATH = /(^|\/)(examples?|samples?)\//i;
/** Un mapa con menos módulos conectados que esto no se poda por huérfanos: sería quedarse sin mapa. */
const MIN_CONNECTED_TO_PRUNE = 3;

/**
 * El grafo de producto (lienzo, Check, simulación) sin lo que no aporta arquitectura: tests, `__init__`, configs,
 * ejemplos y módulos huérfanos (sin ninguna arista) — salvo la infra del compose y las entradas de servicio. El hilo
 * que pasaba por un módulo quitado se conserva. Lo omitido queda contado en `graph.omitted`: el repo no se toca.
 * No se toca un grafo que se quedaría sin núcleo (repos pequeños sin imports resolubles).
 */
export function pruneNonArchitectural(graph: CodeGraph): CodeGraph {
  const keepAlways = (item: CodeModule) => isInfraModuleId(item.id) || item.service !== undefined;
  const noise = new Set(
    graph.modules.filter((item) => !keepAlways(item) && (!isArchitectureModule(item) || EXAMPLE_PATH.test(item.filePath))).map((item) => item.id),
  );
  const survivors = graph.modules.filter((item) => !noise.has(item.id));
  const edges = contractEdges(graph.edges, noise);
  const touched = new Set<string>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    touched.add(edge.source);
    touched.add(edge.target);
  }
  const connected = survivors.filter((item) => touched.has(item.id) && !isInfraModuleId(item.id));
  const removed = new Set(noise);
  if (connected.length >= MIN_CONNECTED_TO_PRUNE) {
    for (const item of survivors) if (!touched.has(item.id) && !keepAlways(item)) removed.add(item.id);
  }
  if (removed.size === 0 || removed.size >= graph.modules.length) return graph;

  const modules = graph.modules.filter((item) => !removed.has(item.id));
  const usedGroups = new Set(modules.map((item) => item.groupId));
  const paths = graph.modules.filter((item) => removed.has(item.id)).map((item) => item.filePath).sort();
  return {
    ...graph,
    groups: graph.groups.filter((group) => usedGroups.has(group.id)),
    modules,
    edges: edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
    omitted: { count: paths.length, paths },
  };
}

/**
 * Quita el ruido (`isArchitectureModule`) de una vista de módulos sin romper el hilo: si `a → __init__ → b`, queda
 * `a → b`. Los sub-nodos de un módulo quitado se van con él.
 */
/** Aristas sin los nodos `removed`, conservando el hilo que pasaba por ellos (`a → __init__ → b` queda `a → b`). */
function contractEdges(edges: readonly ModuleEdge[], removed: ReadonlySet<string>): ModuleEdge[] {
  const kept: ModuleEdge[] = edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
  const seen = new Set(kept.map((edge) => `${edge.source}->${edge.target}`));
  for (const id of removed) {
    const into = edges.filter((edge) => edge.target === id && !removed.has(edge.source));
    const from = edges.filter((edge) => edge.source === id && !removed.has(edge.target));
    for (const left of into) {
      for (const right of from) {
        const key = `${left.source}->${right.target}`;
        if (left.source === right.target || seen.has(key)) continue;
        seen.add(key);
        kept.push({ id: `via:${left.source}:${right.target}`, source: left.source, target: right.target, kind: "imports" });
      }
    }
  }
  return kept;
}

export function filterNoise(prepared: PreparedGraph): PreparedGraph {
  const { graph } = prepared;
  const noise = new Set(graph.modules.filter((item) => item.supportOf === undefined && !isArchitectureModule(item)).map((item) => item.id));
  if (noise.size === 0) return prepared;
  for (const item of graph.modules) if (item.supportOf !== undefined && noise.has(item.supportOf)) noise.add(item.id);
  // No se vacía una vista entera de ruido (un bloque que solo tiene tests se sigue viendo).
  if (noise.size >= graph.modules.length) return prepared;

  const modules = graph.modules.filter((item) => !noise.has(item.id));
  const edges = contractEdges(graph.edges, noise);
  const subsystemOf = new Map([...prepared.subsystemOf].filter(([id]) => !noise.has(id)));
  const used = new Set(subsystemOf.values());
  return {
    graph: { ...graph, modules, edges },
    layerOf: prepared.layerOf,
    subsystemOf,
    subsystems: prepared.subsystems.filter((item) => used.has(item.id)),
    hidden: prepared.hidden,
  };
}

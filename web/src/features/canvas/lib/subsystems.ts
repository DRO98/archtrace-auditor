import type { CodeGraph, CodeModule, ModuleEdge, ModuleRole, ModuleSubsystem } from "@core/graph";
import { isCanvasComponent } from "../edit/components";
import { inferRole, pathTokens, roleForPath } from "./architecture";

/**
 * Etapas de ejecución (nombres heredados de sistemas de IA, válidos para cualquier stack), tal como se guardan en `CodeModule.layer` (lo que
 * escriben el build y el clasificador IA). El orden sigue el dato, no la dirección de los imports.
 */
export const STAGE = {
  entry: 0,
  preprocess: 1,
  index: 2,
  orchestration: 3,
  generation: 4,
} as const;

/**
 * Columnas del lienzo (3 niveles): entrada → orquestador → contenedores de servicios.
 * Las etapas de preproceso, índice y generación comparten la columna de servicios y se
 * distinguen dentro de su caja por `intraSubsystemRank`.
 */
export const LAYER = {
  entry: 0,
  orchestration: 1,
  services: 2,
} as const;

const STAGE_TO_LAYER: readonly number[] = [LAYER.entry, LAYER.services, LAYER.services, LAYER.orchestration, LAYER.services];

/** Etapa guardada (0–4) → columna del lienzo (0–2). Valores fuera de rango se acotan. */
export function migrateLegacyLayer(stage: number): number {
  const index = Math.min(STAGE_TO_LAYER.length - 1, Math.max(0, Math.round(stage)));
  return STAGE_TO_LAYER[index] ?? LAYER.services;
}

const ROLE_STAGE: Partial<Record<ModuleRole, number>> = {
  api: STAGE.entry,
  rpc: STAGE.entry,
  app: STAGE.entry,
  ui: STAGE.entry,
  transform: STAGE.preprocess,
  stream: STAGE.preprocess,
  database: STAGE.index,
  cache: STAGE.index,
  broker: STAGE.index,
  pipeline: STAGE.orchestration,
  service: STAGE.orchestration,
  prompt: STAGE.generation,
};

const INDEX_TOKENS = new Set(["embed", "embedder", "embedding", "embeddings", "vector", "retriever", "retrieval", "index", "search"]);

export type SubsystemCatalogEntry = ModuleSubsystem & { tokens: ReadonlySet<string>; roles: ReadonlySet<ModuleRole> };

/**
 * Cajas propias de sistemas de IA (RAG / inferencia). Solo entran en el catálogo por defecto si el
 * grafo tiene señales de IA (`isAiGraph`): en un backend Kafka + Postgres, "index" o "search" no
 * significan un vector store.
 */
export const AI_SUBSYSTEMS: ReadonlyArray<SubsystemCatalogEntry> = [
  {
    id: "rag-core",
    label: "RAG Core · Search & Retrieval",
    color: "violet",
    roles: new Set<ModuleRole>(["transform"]),
    tokens: new Set([...INDEX_TOKENS, "chunk", "chunker", "splitter", "loader"]),
  },
  {
    id: "inference",
    label: "Inference & Prompts",
    color: "amber",
    roles: new Set<ModuleRole>(["prompt"]),
    tokens: new Set(["llm", "prompt", "prompts", "completion", "inference", "generation"]),
  },
];

/** Cajas stack-agnósticas: mensajería, datos, observabilidad, infraestructura, entrada y dominio. */
export const GENERIC_SUBSYSTEMS: ReadonlyArray<SubsystemCatalogEntry> = [
  {
    id: "messaging",
    label: "Mensajería · Eventos y streams",
    color: "rose",
    roles: new Set<ModuleRole>(["broker", "stream"]),
    tokens: new Set([
      "kafka", "rabbit", "rabbitmq", "amqp", "pulsar", "nats", "sqs", "sns", "kinesis", "pubsub",
      "queue", "queues", "topic", "topics", "producer", "consumer", "broker", "events",
      "flink", "spark", "beam", "stream", "streams", "streaming",
    ]),
  },
  {
    id: "data",
    label: "Datos · Base de datos y caché",
    color: "emerald",
    roles: new Set<ModuleRole>(["database", "cache"]),
    tokens: new Set([
      "db", "database", "sql", "postgres", "postgresql", "mysql", "sqlite", "mongo", "mongodb", "clickhouse",
      "cassandra", "dynamo", "dynamodb", "redis", "memcached", "cache", "repository", "repositories", "repo",
      "migrations", "orm", "storage",
    ]),
  },
  {
    id: "observability",
    label: "Observabilidad",
    color: "sky",
    roles: new Set<ModuleRole>(),
    tokens: new Set(["metrics", "telemetry", "tracing", "tracer", "otel", "opentelemetry", "prometheus", "logging", "logger", "monitor", "monitoring"]),
  },
  {
    id: "infra",
    label: "Infraestructura / Runtime",
    color: "zinc",
    roles: new Set<ModuleRole>(),
    tokens: new Set(["docker", "infra", "runtime", "config", "deploy", "k8s", "kubernetes", "helm", "terraform"]),
  },
  {
    id: "ingress",
    label: "Entrada · API y RPC",
    color: "sky",
    roles: new Set<ModuleRole>(["api", "rpc"]),
    tokens: new Set(["gateway", "grpc", "proto", "protobuf", "graphql", "controller", "controllers"]),
  },
  {
    id: "domain",
    label: "Dominio · Lógica de negocio",
    color: "violet",
    roles: new Set<ModuleRole>(["service"]),
    tokens: new Set(["domain", "usecase", "usecases", "business"]),
  },
];

/**
 * Catálogo completo (IA + genérico) para contextos sin grafo (clasificador de módulos, scripts).
 * El orden es la prioridad de asignación.
 */
export const DEFAULT_SUBSYSTEMS: ReadonlyArray<SubsystemCatalogEntry> = [...AI_SUBSYSTEMS, ...GENERIC_SUBSYSTEMS];

const AI_ROLES: ReadonlySet<ModuleRole> = new Set(["ai-model", "prompt"]);
const AI_TOKENS = new Set(["llm", "rag", "embed", "embedder", "embedding", "embeddings", "openai", "anthropic", "ollama", "prompt", "prompts", "chunker", "vector"]);

/** true si el grafo modela un sistema de IA (rol de modelo/prompt o vocabulario RAG en las rutas). */
export function isAiGraph(graph: Pick<CodeGraph, "modules">): boolean {
  return graph.modules.some(
    (item) =>
      (item.role !== undefined && AI_ROLES.has(item.role)) ||
      pathTokens(`${item.filePath} ${item.label}`).some((token) => AI_TOKENS.has(token)),
  );
}

/** Catálogo por defecto de un grafo sin `subsystems`: las cajas de IA solo si el grafo es de IA. */
export function subsystemCatalogFor(graph: Pick<CodeGraph, "modules">): ReadonlyArray<SubsystemCatalogEntry> {
  return isAiGraph(graph) ? DEFAULT_SUBSYSTEMS : GENERIC_SUBSYSTEMS;
}

/** Un subsistema con un solo miembro no aporta información: se dibuja sin caja. */
const MIN_SUBSYSTEM_MEMBERS = 2;

export interface PreparedGraph {
  /** Grafo filtrado; los sub-nodos que caen en otra capa o subsistema se promueven a tarjeta. */
  graph: CodeGraph;
  layerOf: ReadonlyMap<string, number>;
  /** Solo módulos principales con caja visible (≥ 2 miembros). */
  subsystemOf: ReadonlyMap<string, string>;
  subsystems: readonly ModuleSubsystem[];
  /** Módulos descartados por estar aislados (sin aristas ni sub-nodos). */
  hidden: readonly CodeModule[];
}

export function prepareGraph(graph: CodeGraph): PreparedGraph {
  const { modules, hidden } = dropIsolated(graph);
  const keptIds = new Set(modules.map((item) => item.id));
  const edges = graph.edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));

  const defaults = graph.subsystems === undefined ? subsystemCatalogFor(graph) : null;
  const catalog = graph.subsystems ?? defaults ?? [];
  const rawSubsystem = new Map(modules.map((item) => [item.id, item.subsystem ?? inferSubsystem(item, defaults)]));
  const layerOf = resolveLayers(modules, edges);

  // Un sub-nodo circular vive debajo de su tarjeta; si pertenece a otra columna o a otra caja, pasa a tarjeta propia.
  const promoted = modules.map((item) => {
    if (item.supportOf === undefined) return item;
    const sameLayer = layerOf.get(item.id) === layerOf.get(item.supportOf);
    const sameBox = rawSubsystem.get(item.id) === rawSubsystem.get(item.supportOf);
    if (sameLayer && sameBox) return item;
    const card: CodeModule = { ...item };
    delete card.supportOf;
    return card;
  });
  for (const item of promoted) {
    if (item.supportOf !== undefined) layerOf.set(item.id, layerOf.get(item.supportOf) ?? 0);
  }

  const members = new Map<string, number>();
  for (const item of promoted) {
    const id = rawSubsystem.get(item.id);
    if (id) members.set(id, (members.get(id) ?? 0) + 1);
  }
  const subsystemOf = new Map<string, string>();
  for (const item of promoted) {
    const id = rawSubsystem.get(item.id);
    if (item.supportOf === undefined && id && (members.get(id) ?? 0) >= MIN_SUBSYSTEM_MEMBERS) subsystemOf.set(item.id, id);
  }
  const used = new Set(subsystemOf.values());
  compactLayers(promoted, edges, layerOf, subsystemOf);

  return {
    graph: { ...graph, modules: promoted, edges },
    layerOf,
    subsystemOf,
    subsystems: catalog.filter((item) => used.has(item.id)).map(({ id, label, color }) => ({ id, label, color })),
    hidden,
  };
}

/**
 * Orienta cada arista en el sentido del flujo (capa menor → capa mayor) para que ningún
 * cable vuelva hacia la izquierda. `reversed` indica que el import original iba al revés.
 */
export function orientEdge(edge: ModuleEdge, layerOf: ReadonlyMap<string, number>): { source: string; target: string; reversed: boolean } {
  const from = layerOf.get(edge.source) ?? 0;
  const to = layerOf.get(edge.target) ?? 0;
  if (from > to) return { source: edge.target, target: edge.source, reversed: true };
  return { source: edge.source, target: edge.target, reversed: false };
}

/**
 * Compactación por niveles (ranking "longest-path" acotado por arriba): una tarjeta suelta cuyos
 * vecinos están todos en columnas anteriores no necesita irse más lejos que la columna siguiente al
 * más avanzado de ellos. Así `Conversation Memory`, que solo cuelga del servidor de entrada, se
 * coloca bajo el orquestador en lugar de abrir una columna de servicios vacía a su alrededor.
 * Los miembros de una caja visible no se mueven (la caja ocupa sus columnas de extremo a extremo)
 * y los sub-nodos siguen a su tarjeta.
 */
function compactLayers(
  modules: readonly CodeModule[],
  edges: readonly ModuleEdge[],
  layerOf: Map<string, number>,
  subsystemOf: ReadonlyMap<string, string>,
): void {
  const ownerOf = new Map(modules.map((item) => [item.id, item.supportOf ?? item.id]));
  const neighbours = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = ownerOf.get(edge.source);
    const target = ownerOf.get(edge.target);
    if (!source || !target || source === target) continue;
    neighbours.set(source, (neighbours.get(source) ?? new Set()).add(target));
    neighbours.set(target, (neighbours.get(target) ?? new Set()).add(source));
  }
  const movable = modules.filter((item) => item.supportOf === undefined && !subsystemOf.has(item.id));
  for (let pass = 0; pass < movable.length; pass += 1) {
    let moved = false;
    for (const item of movable) {
      const own = layerOf.get(item.id) ?? 0;
      const around = [...(neighbours.get(item.id) ?? [])].map((id) => layerOf.get(id) ?? 0);
      if (around.length === 0 || around.some((layer) => layer >= own)) continue;
      const tight = Math.max(...around) + 1;
      if (tight >= own) continue;
      layerOf.set(item.id, tight);
      moved = true;
    }
    if (!moved) break;
  }
  for (const item of modules) {
    if (item.supportOf !== undefined) layerOf.set(item.id, layerOf.get(item.supportOf) ?? 0);
  }
}

function dropIsolated(graph: CodeGraph): { modules: CodeModule[]; hidden: CodeModule[] } {
  if (graph.edges.length === 0) return { modules: graph.modules, hidden: [] };
  const ownerOf = (id: string): string => graph.modules.find((item) => item.id === id)?.supportOf ?? id;
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    connected.add(ownerOf(edge.source));
    connected.add(ownerOf(edge.target));
  }
  for (const item of graph.modules) {
    if (item.supportOf !== undefined) connected.add(item.supportOf);
  }
  const modules: CodeModule[] = [];
  const hidden: CodeModule[] = [];
  for (const item of graph.modules) {
    const owner = item.supportOf ?? item.id;
    // Un componente suelto del lienzo aún no tiene aristas, pero el usuario lo acaba de soltar: se muestra.
    if (connected.has(owner) || isCanvasComponent(item.id)) modules.push(item);
    else hidden.push(item);
  }
  return { modules, hidden };
}

export interface LayerClassification {
  layer: number;
  /** Id de DEFAULT_SUBSYSTEMS; ausente si el módulo no pertenece a ninguna caja. */
  subsystem?: string;
}

/**
 * Clasificación heurística instantánea por palabras clave de ruta/etiqueta y rol.
 * Devuelve null cuando no hay coincidencia de alta confianza para la capa (roles `util` o
 * `code`): son los módulos que el build envía al clasificador con IA.
 */
export function inferLayerAndSubsystem(
  filePath: string,
  role?: ModuleRole,
  label = "",
  catalog: ReadonlyArray<SubsystemCatalogEntry> = DEFAULT_SUBSYSTEMS,
): LayerClassification | null {
  const resolvedRole = role ?? roleForPath(filePath);
  const tokens = pathTokens(`${filePath} ${label}`);
  const layer = layerFor(resolvedRole, tokens);
  if (layer === undefined) return null;
  const subsystem = subsystemFor(resolvedRole, tokens, catalog);
  return subsystem ? { layer, subsystem } : { layer };
}

/** Etapa (esquema guardado 0–4), no columna. */
function layerFor(role: ModuleRole, tokens: readonly string[]): number | undefined {
  if (role === "ai-model") return tokens.some((token) => INDEX_TOKENS.has(token)) ? STAGE.index : STAGE.generation;
  return ROLE_STAGE[role];
}

function subsystemFor(
  role: ModuleRole,
  tokens: readonly string[],
  catalog: ReadonlyArray<SubsystemCatalogEntry>,
): string | undefined {
  for (const subsystem of catalog) {
    if (tokens.some((token) => subsystem.tokens.has(token))) return subsystem.id;
  }
  for (const subsystem of catalog) {
    if (subsystem.roles.has(role)) return subsystem.id;
  }
  return undefined;
}

function inferSubsystem(item: CodeModule, catalog: ReadonlyArray<SubsystemCatalogEntry> | null): string | undefined {
  if (!catalog) return undefined;
  return subsystemFor(item.role ?? inferRole(item), pathTokens(`${item.filePath} ${item.label}`), catalog);
}

/** Columna del lienzo: la etapa explícita o inferida, colapsada a 3 niveles. */
function inferLayer(item: CodeModule): number | undefined {
  const stage = item.layer ?? layerFor(item.role ?? inferRole(item), pathTokens(`${item.filePath} ${item.label}`));
  return stage === undefined ? undefined : migrateLegacyLayer(stage);
}

/**
 * Orden vertical dentro de una caja, siguiendo el dato: trocear → embeber → indexar → LLM → prompts.
 * Se mira primero el nombre del archivo y la etiqueta (en `src/llm/prompts.py` manda "prompts",
 * no la carpeta "llm"); si no hay coincidencia, la ruta entera y después el rol.
 */
const RANK_TOKENS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["loader", "parser", "splitter", "chunk", "chunker", "chunking", "cleaner", "tokenizer"]),
  new Set(["embed", "embedder", "embedding", "embeddings"]),
  new Set(["vector", "index", "retriever", "retrieval", "search", "store", "database", "db"]),
  new Set(["llm", "inference", "completion", "model", "generation"]),
  new Set(["prompt", "prompts", "template", "templates", "formatter"]),
];
/** Rango de un módulo sin pista semántica (p. ej. un registro o despachador): el flujo de aristas decide dónde va. */
export const UNRANKED = RANK_TOKENS.length;
const ROLE_RANK: Partial<Record<ModuleRole, number>> = { transform: 0, database: 2, cache: 2, "ai-model": 3, prompt: 4 };

export function intraSubsystemRank(item: Pick<CodeModule, "filePath" | "label" | "role">): number {
  const rankOf = (tokens: readonly string[]) => {
    let best = -1;
    RANK_TOKENS.forEach((set, rank) => {
      if (tokens.some((token) => set.has(token))) best = Math.max(best, rank);
    });
    return best;
  };
  const basename = item.filePath.split(/[\/]/).pop() ?? item.filePath;
  const own = rankOf(pathTokens(`${basename} ${item.label}`));
  if (own >= 0) return own;
  const inPath = rankOf(pathTokens(item.filePath));
  if (inPath >= 0) return inPath;
  return ROLE_RANK[item.role ?? roleForPath(item.filePath)] ?? UNRANKED;
}

/**
 * Capa explícita o inferida por rol. Los módulos sin rol claro (util, code) se colocan una
 * columna a la derecha del módulo más avanzado que los usa, sin pasar de servicios; si nadie
 * los usa, en la entrada.
 */
function resolveLayers(modules: readonly CodeModule[], edges: readonly ModuleEdge[]): Map<string, number> {
  const layerOf = new Map<string, number>();
  const pending: CodeModule[] = [];
  for (const item of modules) {
    const layer = inferLayer(item);
    if (layer === undefined) pending.push(item);
    else layerOf.set(item.id, layer);
  }
  // Una pasada por módulo pendiente basta para propagar cadenas util → util.
  for (let pass = 0; pass < pending.length; pass += 1) {
    for (const item of pending) {
      const callers = edges.filter((edge) => edge.target === item.id).map((edge) => layerOf.get(edge.source));
      const known = callers.filter((layer): layer is number => layer !== undefined);
      layerOf.set(item.id, known.length > 0 ? Math.min(Math.max(...known) + 1, LAYER.services) : LAYER.entry);
    }
  }
  return layerOf;
}

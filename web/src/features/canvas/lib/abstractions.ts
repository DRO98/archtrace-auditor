import type { CodeModule, ModuleEdge, ModuleRole } from "@core/graph";
import { isInfraModuleId } from "@/lib/scan/composeScan";
import { techLabel } from "@/lib/scan/semantics";
import { inferRole, pathTokens } from "./architecture";
import { isArchitectureModule } from "./architectureSkeleton";
import { prepareGraph, type PreparedGraph } from "./subsystems";

/**
 * Drill de un servicio del esqueleto como abstracciones, no archivos: Chatbot RAG → API, Agente / LLM, Recuperación
 * + Qdrant; Gestos → Modelo ML, Datos y preprocesado. Cada abstracción agrupa módulos por lo que hacen (rol y
 * tecnología) y se dibuja con el id de su módulo más conectado, así que seleccionarla abre el código real en el panel
 * y en el IDE. Como mucho `MAX_FACETS` abstracciones, más la infraestructura con la que habla el servicio.
 */

export const MAX_FACETS = 5;

type FacetKey = "api" | "app" | "llm" | "prompt" | "ml" | "retrieval" | "data" | "messaging" | "stream" | "pipeline" | "dataprep" | "logic";

const FACET_LABEL: Readonly<Record<FacetKey, string>> = {
  api: "API",
  app: "Aplicación",
  llm: "Agente / LLM",
  prompt: "Prompts",
  ml: "Modelo ML",
  retrieval: "Recuperación (RAG)",
  data: "Acceso a datos",
  messaging: "Mensajería",
  stream: "Procesado en streaming",
  pipeline: "Orquestación",
  dataprep: "Datos y preprocesado",
  logic: "Lógica",
};

const FACET_ROLE: Readonly<Record<FacetKey, ModuleRole>> = {
  api: "api",
  app: "app",
  llm: "ai-model",
  prompt: "prompt",
  ml: "ai-model",
  retrieval: "database",
  data: "database",
  messaging: "broker",
  stream: "stream",
  pipeline: "pipeline",
  dataprep: "transform",
  logic: "service",
};

const LLM_TECH: ReadonlySet<string> = new Set(["ollama", "openai", "langchain", "anthropic"]);
const ML_TECH: ReadonlySet<string> = new Set(["keras", "pytorch", "mediapipe"]);
const VECTOR_TECH: ReadonlySet<string> = new Set(["qdrant", "chroma", "elasticsearch"]);
const DATAPREP_TOKENS: ReadonlySet<string> = new Set([
  "datos", "dato", "data", "dataset", "datasets", "preprocess", "preprocesar", "preprocesado", "extraccion", "features",
  "grabacion", "recording", "loader", "ingest", "etl",
]);
/** Si hay que fundir abstracciones para no pasar del tope, estas se sacrifican antes. */
const FOLD_ORDER: readonly FacetKey[] = ["logic", "dataprep", "prompt", "app", "messaging", "pipeline", "data", "stream", "retrieval", "ml", "llm", "api"];

function facetOf(item: CodeModule): FacetKey {
  const role = item.role ?? inferRole(item);
  const tech = item.tech ?? [];
  if (role === "prompt") return "prompt";
  if (tech.some((name) => ML_TECH.has(name))) return "ml";
  if (tech.some((name) => VECTOR_TECH.has(name))) return "retrieval";
  if (role === "ai-model" || tech.some((name) => LLM_TECH.has(name))) return "llm";
  switch (role) {
    case "api":
    case "rpc":
      return "api";
    case "app":
    case "ui":
      return "app";
    case "database":
    case "cache":
      return "data";
    case "broker":
      return "messaging";
    case "stream":
      return "stream";
    case "pipeline":
      return "pipeline";
    default:
      return pathTokens(item.filePath).some((token) => DATAPREP_TOKENS.has(token)) ? "dataprep" : "logic";
  }
}

export interface Facet {
  key: FacetKey;
  label: string;
  role: ModuleRole;
  members: CodeModule[];
}

/** «Modelo ML (MediaPipe, Keras)», «Agente / LLM (LangChain)»: la tecnología distingue la abstracción. */
function facetLabel(key: FacetKey, members: readonly CodeModule[]): string {
  const relevant = key === "ml" ? ML_TECH : key === "llm" ? LLM_TECH : null;
  if (!relevant) return FACET_LABEL[key];
  const counts = new Map<string, number>();
  for (const item of members) for (const tech of item.tech ?? []) if (relevant.has(tech)) counts.set(tech, (counts.get(tech) ?? 0) + 1);
  const names = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 2).map(([tech]) => techLabel(tech));
  return names.length > 0 ? `${FACET_LABEL[key]} (${names.join(", ")})` : FACET_LABEL[key];
}

/**
 * Abstracciones de un conjunto de módulos (sin ruido ni infra), como mucho `max`: las que sobran se funden en la
 * siguiente que queda según `FOLD_ORDER` (primero la lógica genérica, nunca la API ni el LLM).
 */
export function facetsOf(modules: readonly CodeModule[], max = MAX_FACETS): Facet[] {
  const groups = new Map<FacetKey, CodeModule[]>();
  for (const item of modules) {
    if (isInfraModuleId(item.id) || item.supportOf !== undefined || !isArchitectureModule(item)) continue;
    const key = facetOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  while (groups.size > max) {
    const victim = FOLD_ORDER.find((key) => groups.has(key));
    if (!victim) break;
    const into = FOLD_ORDER.find((key) => key !== victim && groups.has(key) && key !== "logic") ?? FOLD_ORDER.find((key) => key !== victim && groups.has(key));
    if (!into) break;
    groups.set(into, [...(groups.get(into) ?? []), ...(groups.get(victim) ?? [])]);
    groups.delete(victim);
  }
  return [...groups]
    .map(([key, members]) => ({ key, label: facetLabel(key, members), role: FACET_ROLE[key], members }))
    .sort((left, right) => FOLD_ORDER.indexOf(right.key) - FOLD_ORDER.indexOf(left.key));
}

function degreeOf(edges: readonly ModuleEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

/**
 * Una tarjeta por abstracción de `modules`: el módulo más conectado de cada una, con el nombre de la abstracción y
 * sus archivos en el subtítulo. `nodeOf` lleva cada módulo a la tarjeta que lo resume.
 */
function facetNodes(modules: readonly CodeModule[], degree: ReadonlyMap<string, number>, nodeOf: Map<string, string>): CodeModule[] {
  const nodes: CodeModule[] = [];
  for (const facet of facetsOf(modules)) {
    const lead = [...facet.members].sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id))[0];
    if (!lead) continue;
    for (const item of facet.members) nodeOf.set(item.id, lead.id);
    const names = facet.members.map((item) => item.label);
    const node: CodeModule = {
      ...lead,
      label: facet.label,
      role: facet.role,
      subtitle: names.length > 3 ? `${names.slice(0, 3).join(" · ")} +${names.length - 3}` : names.join(" · "),
      summary: `${facet.label}: ${names.join(", ")}`,
      subBlocks: [],
    };
    delete node.supportOf;
    delete node.subsystem;
    delete node.layer;
    nodes.push(node);
  }
  return nodes;
}

/** Aristas del grafo llevadas a las tarjetas (`nodeOf`), una por par; `keep` decide cuáles cuentan. */
function aggregateEdges(edges: readonly ModuleEdge[], nodeOf: ReadonlyMap<string, string>, keep: (edge: ModuleEdge) => boolean = () => true): ModuleEdge[] {
  const merged = new Map<string, ModuleEdge>();
  for (const edge of edges) {
    const source = nodeOf.get(edge.source);
    const target = nodeOf.get(edge.target);
    if (!source || !target || source === target || !keep(edge)) continue;
    const id = `abs:${source}:${target}`;
    const current = merged.get(id);
    if (current) {
      if (edge.kind === "data-flow") current.kind = "data-flow";
      continue;
    }
    merged.set(id, { id, source, target, kind: edge.kind });
  }
  return [...merged.values()];
}

/**
 * Vista de drill de un bloque del esqueleto: una tarjeta por abstracción y la infraestructura vecina, con las
 * aristas agregadas entre ellas. `moduleIds`: los del bloque (incluido, si es un nodo infra, su propio módulo).
 */
export function abstractView(prepared: PreparedGraph, moduleIds: readonly string[]): PreparedGraph {
  const { graph } = prepared;
  const own = new Set(moduleIds);
  const byId = new Map(graph.modules.map((item) => [item.id, item]));
  const nodeOf = new Map<string, string>();
  const nodes = facetNodes(
    moduleIds.flatMap((id) => byId.get(id) ?? []),
    degreeOf(graph.edges),
    nodeOf,
  );
  // Infraestructura: la del propio bloque y la que usan sus módulos (Qdrant, Ollama, MongoDB…), una vez cada una.
  for (const edge of graph.edges) {
    if (own.has(edge.source) && isInfraModuleId(edge.target)) nodeOf.set(edge.target, edge.target);
    if (own.has(edge.target) && isInfraModuleId(edge.source)) nodeOf.set(edge.source, edge.source);
  }
  for (const id of moduleIds) if (isInfraModuleId(id)) nodeOf.set(id, id);
  for (const id of new Set(nodeOf.values())) {
    const item = byId.get(id);
    if (item && isInfraModuleId(id)) nodes.push({ ...item, subBlocks: [] });
  }
  // Solo lo que cruza el bloque o lo toca: dos servicios de infra entre sí no son parte de este drill.
  const edges = aggregateEdges(graph.edges, nodeOf, (edge) => own.has(edge.source) || own.has(edge.target));
  return prepareGraph({ ...graph, modules: nodes, edges, subsystems: [] });
}

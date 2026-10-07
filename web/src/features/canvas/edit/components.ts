import type { CodeGraph, CodeModule, ModuleEdge, ModuleGroup, ModuleRole } from "@core/graph";

/**
 * Componentes que el usuario añade al lienzo desde la paleta. No existen en el código: son una capa de
 * edición sobre el grafo cargado (se guardan aparte y se aplican con `applyCanvasEdits`), así que quitar
 * un componente devuelve el grafo exactamente a como estaba.
 */
export const COMPONENT_TEMPLATE_IDS = [
  "guardrails",
  "reranker",
  "cache",
  "query-rewriter",
  "memory",
  "output-guard",
  "database",
  "broker",
  "stream-processor",
  "rpc-service",
] as const;
export type ComponentTemplateId = (typeof COMPONENT_TEMPLATE_IDS)[number];

export interface ComponentTemplate {
  id: ComponentTemplateId;
  label: string;
  subtitle: string;
  description: string;
  role: ModuleRole;
}

export const COMPONENT_TEMPLATES: Readonly<Record<ComponentTemplateId, ComponentTemplate>> = {
  guardrails: {
    id: "guardrails",
    label: "Guardrails",
    subtitle: "validate · block · redact",
    description: "Filtra la entrada antes del modelo: prompt injection, PII y temas vetados.",
    role: "service",
  },
  reranker: {
    id: "reranker",
    label: "Reranker",
    subtitle: "score · reorder · top-k",
    description: "Reordena los fragmentos recuperados con un cross-encoder antes de pasarlos al LLM.",
    role: "transform",
  },
  cache: {
    id: "cache",
    label: "Cache Redis",
    subtitle: "lookup · set · ttl",
    description: "Caché semántica de respuestas: evita llamar al LLM con preguntas repetidas.",
    role: "database",
  },
  "query-rewriter": {
    id: "query-rewriter",
    label: "Query Rewriter",
    subtitle: "expand · rephrase · HyDE",
    description: "Reescribe o expande la pregunta para mejorar la recuperación.",
    role: "prompt",
  },
  memory: {
    id: "memory",
    label: "Memoria de chat",
    subtitle: "history · summarize",
    description: "Añade el historial de la conversación al contexto del modelo.",
    role: "database",
  },
  "output-guard": {
    id: "output-guard",
    label: "Output Guard",
    subtitle: "moderate · schema · cite",
    description: "Valida la respuesta generada: moderación, formato y citas.",
    role: "service",
  },
  database: {
    id: "database",
    label: "Base de datos",
    subtitle: "query · insert · migrate",
    description: "Almacén persistente (Postgres, MySQL, MongoDB, ClickHouse…) que lee o escribe el nodo siguiente.",
    role: "database",
  },
  broker: {
    id: "broker",
    label: "Broker de mensajes",
    subtitle: "publish · topic · consume",
    description: "Kafka, RabbitMQ o similar: desacopla productores y consumidores con topics o colas.",
    role: "broker",
  },
  "stream-processor": {
    id: "stream-processor",
    label: "Procesador de streams",
    subtitle: "window · aggregate · sink",
    description: "Flink, Spark Streaming o Kafka Streams: transforma eventos en tiempo real.",
    role: "stream",
  },
  "rpc-service": {
    id: "rpc-service",
    label: "Servicio gRPC",
    subtitle: "proto · stub · call",
    description: "Servicio remoto con contrato tipado (gRPC / protobuf).",
    role: "rpc",
  },
};

export function isComponentTemplateId(value: unknown): value is ComponentTemplateId {
  return typeof value === "string" && (COMPONENT_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Posición en coordenadas del lienzo (React Flow). */
export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Un componente añadido. Empalmado (`detached` falso o ausente): se inserta en el flujo justo antes del nodo
 * `before`. Suelto (`detached: true`): aparece sin aristas donde se soltó y `before` es solo la sugerencia
 * para «Empalmar en el flujo». Nunca se conecta solo: el analizador no puede verificar contra el AST que un
 * componente virtual vaya en ese punto, así que el empalme lo decide siempre el usuario.
 */
export interface AddedComponent {
  id: string;
  template: ComponentTemplateId;
  /** Nodo delante del cual se inserta (o se sugiere insertar); null o inexistente → antes del primer módulo. */
  before: string | null;
  /** true: suelto en el lienzo, sin aristas, hasta que el usuario lo empalme. */
  detached?: boolean;
  /** Punto de caída (solo sueltos): la esquina superior izquierda de la tarjeta. */
  position?: CanvasPoint;
}

export const CANVAS_COMPONENT_PREFIX = "canvas:";
export const CANVAS_EDIT_GROUP: ModuleGroup = { id: "canvas-edits", label: "Añadidos en el lienzo", color: "violet" };

export function componentModuleId(componentId: string): string {
  return `${CANVAS_COMPONENT_PREFIX}${componentId}`;
}

export function isCanvasComponent(moduleId: string): boolean {
  return moduleId.startsWith(CANVAS_COMPONENT_PREFIX);
}

/**
 * Aplica los componentes añadidos en orden. Insertar C antes de X redirige cada arista P→X a P→C y añade
 * C→X (si X no tenía entradas, solo C→X); varios componentes delante del mismo nodo se encadenan en el
 * orden en que se añadieron. Los sueltos (`detached`) solo añaden su módulo, sin aristas: el lienzo los
 * muestra igualmente (no se ocultan como los módulos aislados del código).
 */
export function applyCanvasEdits(graph: CodeGraph, components: readonly AddedComponent[]): CodeGraph {
  if (components.length === 0) return graph;
  const modules: CodeModule[] = [...graph.modules];
  let edges: ModuleEdge[] = [...graph.edges];
  const ids = new Set(modules.map((item) => item.id));
  const counts = new Map<ComponentTemplateId, number>();

  for (const component of components) {
    const template = COMPONENT_TEMPLATES[component.template];
    const id = componentModuleId(component.id);
    if (!template || ids.has(id)) continue;
    const anchor = component.before && ids.has(component.before) ? component.before : (graph.modules[0]?.id ?? null);
    const n = (counts.get(template.id) ?? 0) + 1;
    counts.set(template.id, n);
    modules.push({
      id,
      label: n > 1 ? `${template.label} ${n}` : template.label,
      filePath: `canvas/${template.id}-${n}`,
      groupId: CANVAS_EDIT_GROUP.id,
      language: "virtual",
      role: template.role,
      subtitle: template.subtitle,
      summary: template.description,
      subBlocks: [],
    });
    ids.add(id);
    if (!anchor || component.detached) continue;
    edges = edges.map((edge) =>
      edge.target === anchor && edge.source !== anchor ? { ...edge, id: `${edge.id}~${id}`, target: id } : edge,
    );
    edges.push({ id: `${id}->${anchor}`, source: id, target: anchor, kind: "data-flow" });
  }

  const groups = graph.groups.some((group) => group.id === CANVAS_EDIT_GROUP.id) ? graph.groups : [...graph.groups, CANVAS_EDIT_GROUP];
  return { ...graph, groups, modules, edges };
}

/** Al quitar un componente, los que se insertaron delante de él pasan a apuntar a su destino. */
export function removeComponent(components: readonly AddedComponent[], moduleId: string): AddedComponent[] {
  const removed = components.find((item) => componentModuleId(item.id) === moduleId);
  if (!removed) return [...components];
  return components
    .filter((item) => item !== removed)
    .map((item) => (item.before === moduleId ? { ...item, before: removed.before } : item));
}

/** «Empalmar en el flujo»: el componente suelto pasa a insertarse antes de `before` (o de `target` si se da). */
export function spliceComponent(components: readonly AddedComponent[], moduleId: string, target?: string | null): AddedComponent[] {
  return components.map((item) => {
    if (componentModuleId(item.id) !== moduleId) return item;
    return { id: item.id, template: item.template, before: target === undefined ? item.before : target };
  });
}

/** Componente añadido de un nodo del lienzo, o undefined si el nodo es del código. */
export function findComponent(components: readonly AddedComponent[], moduleId: string): AddedComponent | undefined {
  return components.find((item) => componentModuleId(item.id) === moduleId);
}

interface PlaceableNode {
  id: string;
  position: CanvasPoint;
  parentId?: string;
  extent?: unknown;
}

/**
 * Coloca los componentes sueltos en su punto de caída (coordenadas absolutas), por encima del layout
 * automático. Se sacan de cualquier caja de subsistema para que la posición no sea relativa a ella.
 */
export function placeDetachedNodes<N extends PlaceableNode>(nodes: N[], components: readonly AddedComponent[]): N[] {
  const drops = new Map<string, CanvasPoint>();
  for (const item of components) {
    if (item.detached && item.position) drops.set(componentModuleId(item.id), item.position);
  }
  if (drops.size === 0) return nodes;
  return nodes.map((node) => {
    const position = drops.get(node.id);
    if (!position) return node;
    const next = { ...node, position };
    delete next.parentId;
    delete next.extent;
    return next;
  });
}

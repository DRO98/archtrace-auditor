import type { PlaygroundSseEvent } from "@core/playground";
import type { TraceSseEvent, TraceStageId } from "@core/trace";
import { resolveRoute, type RoutingEdge } from "../../simulation/lib/route";
import type { EdgeSimStatus, NodeSimStatus } from "../../simulation/lib/visuals";

/** Cualquier evento de traza: los del perfil RAG o los genéricos (HTTP, evento…). */
export type AnyTraceEvent = PlaygroundSseEvent | TraceSseEvent;

export interface StageTrace {
  /** Id de etapa del perfil (RAG: `api`, `llm`…; genéricos: el id del nodo). */
  stage: TraceStageId;
  /** Nombre a mostrar si el evento lo trae; si no, el del catálogo del perfil. */
  label?: string;
  nodeId: string | null;
  /** `error`: la etapa en curso cuando falló la consulta; `detail` lleva el mensaje (clave, cuota…). */
  status: "active" | "done" | "error";
  latencyMs?: number;
  detail?: string;
  /** Etapa previa al punto de entrada: se ejecuta (es requisito) pero no se pinta en el lienzo. */
  upstream?: boolean;
}

/** Lo que la traza pinta en el lienzo. Mismos estados que la simulación para reutilizar sus estilos. */
export interface TraceVisuals {
  stages: StageTrace[];
  nodeStatus: Record<string, NodeSimStatus>;
  edgeStatus: Record<string, EdgeSimStatus>;
  /** Suma de latencias por nodo (una etapa puede repetirse: el vector store indexa y luego busca). */
  latencyByNode: Record<string, number>;
  /** Último nodo encendido: la siguiente etapa traza la arista desde aquí. */
  lastNodeId: string | null;
  /**
   * Punto de entrada que aún no ha llegado: hasta que una etapa arranque en este nodo, las etapas
   * se registran como `upstream` y el lienzo no se pinta.
   */
  pendingEntryId: string | null;
}

export const EMPTY_TRACE: TraceVisuals = {
  stages: [],
  nodeStatus: {},
  edgeStatus: {},
  latencyByNode: {},
  lastNodeId: null,
  pendingEntryId: null,
};

/**
 * Traza inicial de una corrida. Con un punto de entrada que es una etapa del pipeline, el pintado espera
 * a que la traza llegue a él; si no lo es (un módulo cualquiera), se enciende ya y la primera etapa
 * dibuja el camino desde él.
 */
export function startTrace(entry: { nodeId: string; stage: TraceStageId | null } | null): TraceVisuals {
  if (!entry) return EMPTY_TRACE;
  if (entry.stage) return { ...EMPTY_TRACE, pendingEntryId: entry.nodeId };
  return { ...EMPTY_TRACE, nodeStatus: { [entry.nodeId]: "active" }, lastNodeId: entry.nodeId };
}

function settle<T extends string>(record: Record<string, T | "active">, to: T): Record<string, T | "active"> {
  const next = { ...record };
  for (const [key, value] of Object.entries(next)) if (value === "active") next[key] = to;
  return next;
}

type StageStart = Extract<AnyTraceEvent, { type: "stage_start" }>;
type StageDone = Extract<AnyTraceEvent, { type: "stage_done" }>;

function startedStage(event: StageStart, upstream: boolean): StageTrace {
  const started: StageTrace = { stage: event.stage, nodeId: event.nodeId, status: "active" };
  if (event.label) started.label = event.label;
  if (upstream) started.upstream = true;
  return started;
}

function finishStage(stages: readonly StageTrace[], event: StageDone): StageTrace[] {
  const next = [...stages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (item && item.stage === event.stage && item.status === "active") {
      next[index] = event.error
        ? { ...item, status: "error", latencyMs: event.latencyMs, detail: event.error }
        : { ...item, status: "done", latencyMs: event.latencyMs, detail: event.detail };
      break;
    }
  }
  return next;
}

/**
 * Reductor puro de la traza. Al empezar una etapa se enciende su nodo y el camino dibujado
 * desde el nodo anterior (vía `resolveRoute`, p. ej. chunker → pipeline → embedder); los nodos
 * intermedios de ese camino quedan como `done`.
 */
export function applyTraceEvent(state: TraceVisuals, event: AnyTraceEvent, edges: readonly RoutingEdge[]): TraceVisuals {
  if (state.pendingEntryId !== null) {
    if (event.type === "stage_start" && event.nodeId === state.pendingEntryId) {
      return applyTraceEvent({ ...state, pendingEntryId: null }, event, edges);
    }
    // Aguas arriba del punto de entrada: se anota la etapa, el lienzo sigue quieto.
    if (event.type === "stage_start") return { ...state, stages: [...state.stages, startedStage(event, true)] };
    if (event.type === "stage_done") return { ...state, stages: finishStage(state.stages, event) };
    if (event.type === "edge_active") return state;
  }
  switch (event.type) {
    case "stage_start": {
      const stages = [...state.stages, startedStage(event, false)];
      if (!event.nodeId) return { ...state, stages };
      const nodeStatus = settle(state.nodeStatus, "done") as Record<string, NodeSimStatus>;
      const edgeStatus = settle(state.edgeStatus, "done") as Record<string, EdgeSimStatus>;
      if (state.lastNodeId && state.lastNodeId !== event.nodeId) {
        const route = resolveRoute(edges, state.lastNodeId, event.nodeId) ?? [];
        const byId = new Map(edges.map((edge) => [edge.id, edge]));
        for (const hop of route) {
          edgeStatus[hop.edgeId] = "active";
          const edge = byId.get(hop.edgeId);
          for (const id of edge ? [edge.source, edge.target] : []) nodeStatus[id] ??= "done";
        }
      }
      nodeStatus[event.nodeId] = "active";
      return { ...state, stages, nodeStatus, edgeStatus, lastNodeId: event.nodeId };
    }
    case "stage_done": {
      const stages = finishStage(state.stages, event);
      if (!event.nodeId) return { ...state, stages };
      return {
        ...state,
        stages,
        nodeStatus: { ...state.nodeStatus, [event.nodeId]: "done" },
        latencyByNode: { ...state.latencyByNode, [event.nodeId]: (state.latencyByNode[event.nodeId] ?? 0) + event.latencyMs },
      };
    }
    case "edge_active":
      return { ...state, edgeStatus: { ...state.edgeStatus, [event.edgeId]: "active" } };
    case "error":
      return {
        ...state,
        stages: state.stages.map((item) => (item.status === "active" ? { ...item, status: "error" as const, detail: event.message } : item)),
        nodeStatus: settle(state.nodeStatus, "done") as Record<string, NodeSimStatus>,
        edgeStatus: settle(state.edgeStatus, "done") as Record<string, EdgeSimStatus>,
      };
    case "done":
      return {
        ...state,
        stages: state.stages.map((item) => (item.status === "active" ? { ...item, status: "done" as const } : item)),
        nodeStatus: settle(state.nodeStatus, "done") as Record<string, NodeSimStatus>,
        edgeStatus: settle(state.edgeStatus, "done") as Record<string, EdgeSimStatus>,
      };
    default:
      return state;
  }
}

/** Un nodo del recorrido con el tiempo total que pasó la consulta en él. */
export interface RouteHop {
  key: string;
  nodeId: string | null;
  /** Primera etapa que pasó por el nodo: da el nombre si el nodo no está en el grafo. */
  stage: StageTrace;
  latencyMs: number;
  upstream: boolean;
}

/**
 * Agrupa las etapas por nodo en orden de primera visita (embedder y vector store salen dos veces:
 * indexar y buscar) y suma sus latencias. Las etapas sin nodo se agrupan por etapa.
 */
export function routeByNode(stages: readonly StageTrace[]): RouteHop[] {
  const hops = new Map<string, RouteHop>();
  for (const item of stages) {
    const key = item.nodeId ?? `stage:${item.stage}`;
    const hop = hops.get(key);
    if (hop) {
      hop.latencyMs += item.latencyMs ?? 0;
      hop.upstream &&= item.upstream === true;
    } else {
      hops.set(key, { key, nodeId: item.nodeId, stage: item, latencyMs: item.latencyMs ?? 0, upstream: item.upstream === true });
    }
  }
  return [...hops.values()];
}

/** "0.4 ms", "12 ms", "1.8 s". */
export function formatLatency(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

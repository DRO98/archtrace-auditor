import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { CodeGraph, CodeModule, GroupColor, ModuleRole } from "@core/graph";
import { inferRole } from "./architecture";
import { describeModule } from "./describe";
import { nodeRects, routeLayeredEdges } from "./edgeRouting";
import { routeKey, type GraphPosition, type LayeredLayout } from "./layout";
import {
  assignEdgePorts,
  assignPortSlots,
  majoritySide,
  PORT_POSITION,
  portHandleId,
  sideLength,
  slotHandleId,
  slotOffset,
  type PortSide,
  type PortSlot,
  type Rect,
} from "./ports";
import { orientEdge, type PreparedGraph } from "./subsystems";
import type { NodeSimStatus } from "@/features/simulation/lib/visuals";
import type { ImpactVisual } from "./blastRadius";
import { CARD_HEIGHT, CARD_WIDTH, EDGE_STYLE, edgeColorFor, GROUP_STYLES, SUPPORT_SIZE } from "../theme";

export type ModuleNodeData = {
  module: CodeModule;
  groupColor: GroupColor;
  groupLabel: string;
  role: ModuleRole;
  subtitle: string;
  supports: Array<{ id: string; label: string }>;
  impact?: ImpactVisual;
  impactDepth?: number;
  sim?: NodeSimStatus;
  /** Latencia medida por el playground en vivo (badge bajo la tarjeta). */
  latencyMs?: number;
  /** Modelo asignado al nodo LLM (chip sobre la tarjeta; se cambia con clic derecho). */
  llmModel?: string;
  /** Lados con aristas principales conectadas (los demás handles se dibujan invisibles). */
  ports?: PortSide[];
  /** Un handle por ranura: cada arista sale/entra por su propio punto del lado (ver `assignPortSlots`). */
  handles?: SlotHandle[];
};

export interface SlotHandle {
  id: string;
  type: "source" | "target";
  side: PortSide;
  /** Posición a lo largo del lado, 0–100 %. */
  percent: number;
}
export type SupportNodeData = Omit<ModuleNodeData, "supports">;
export type ModuleFlowNode = Node<ModuleNodeData, "module">;
export type SupportFlowNode = Node<SupportNodeData, "support">;
export type SubsystemNodeData = {
  label: string;
  color: GroupColor;
  dimmed?: boolean;
  /** Estado en «Simular flujo» cuando el recorrido va por el mapa de sistema. */
  sim?: NodeSimStatus;
  /** Bloque de Level 0: tarjeta clicable (entra al detalle) en lugar de caja contenedora. */
  level0?: {
    blockId: string;
    size: number;
    sample: string[];
    tech: string[];
    /** Ids de tecnología (la primera da el logo del nodo). */
    techIds: string[];
    kind: "infra" | "service" | "part" | "group";
    role: ModuleRole;
    summary?: string;
    /** Abstracciones del bloque (solo en el esqueleto de sistema). */
    facets: string[];
    /** Vista «Arquitectura»: el nodo se despliega con sus abstracciones. */
    expanded?: boolean;
    /** Módulo que representa el bloque (siempre que lo haya): da el logo de la infra en grafos antiguos. */
    logoModuleId?: string;
    /** Bloque de un solo módulo (MongoDB, Redpanda…): el click selecciona el módulo en vez de abrir un detalle vacío. */
    primaryModuleId?: string;
  };
};
export type SubsystemFlowNode = Node<SubsystemNodeData, "subsystem">;
export type AppFlowNode = ModuleFlowNode | SupportFlowNode | SubsystemFlowNode;

export const SUBSYSTEM_NODE_PREFIX = "subsystem:";

export function isSubsystemNode(node: AppFlowNode): node is SubsystemFlowNode {
  return node.type === "subsystem";
}

export interface FlowResult {
  nodes: AppFlowNode[];
  edges: Edge[];
  hiddenEdges: number;
}

/** Color del cable según el nodo que lo emite: su rol o, si es neutro, su subsistema o grupo. */
export function edgeColorOf(graph: CodeGraph, item: CodeModule | undefined): string {
  if (!item) return EDGE_STYLE.neutral;
  const subsystem = item.subsystem ? graph.subsystems?.find((entry) => entry.id === item.subsystem) : undefined;
  const group = graph.groups.find((entry) => entry.id === item.groupId);
  const fallback = subsystem ? GROUP_STYLES[subsystem.color].hex : group ? GROUP_STYLES[group.color].hex : undefined;
  return edgeColorFor(item.role ?? inferRole(item), fallback);
}

/** Estilo base de un cable principal: color de su origen, algo translúcido para leer los cruces. */
export function mainEdgeStyle(color: string) {
  return {
    stroke: color,
    strokeWidth: EDGE_STYLE.width,
    strokeOpacity: EDGE_STYLE.opacity,
    transition: "opacity 200ms ease, stroke 200ms ease, stroke-width 200ms ease, stroke-opacity 200ms ease",
  };
}

export function edgeMarker(color: string) {
  return { type: MarkerType.ArrowClosed, color, width: 14, height: 14 };
}

export function graphToFlow(
  graph: CodeGraph,
  positions: Map<string, GraphPosition>,
  routes: Map<string, GraphPosition[]> = new Map(),
): FlowResult {
  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const supportsByParent = new Map<string, CodeModule[]>();
  for (const item of graph.modules) {
    if (!item.supportOf) continue;
    const list = supportsByParent.get(item.supportOf);
    if (list) list.push(item);
    else supportsByParent.set(item.supportOf, [item]);
  }

  const nodes: Array<ModuleFlowNode | SupportFlowNode> = graph.modules.map((item) => {
    const group = groups.get(item.groupId);
    const role = item.role ?? inferRole(item);
    const shared = {
      module: item,
      groupColor: group?.color ?? "zinc",
      groupLabel: group?.label ?? item.groupId,
      role,
      subtitle: describeModule(item, role),
    };
    const position = positions.get(item.id) ?? { x: 0, y: 0 };
    if (item.supportOf) {
      const support: SupportFlowNode = {
        id: item.id,
        type: "support",
        position,
        data: shared,
        width: SUPPORT_SIZE,
        height: SUPPORT_SIZE,
      };
      return support;
    }
    const card: ModuleFlowNode = {
      id: item.id,
      type: "module",
      position,
      data: {
        ...shared,
        supports: (supportsByParent.get(item.id) ?? []).map((support) => ({
          id: support.id,
          label: support.label,
        })),
      },
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
    return card;
  });

  const byId = new Map(graph.modules.map((item) => [item.id, item]));
  const colorOf = (id: string) => edgeColorOf(graph, byId.get(id));
  const supportPairs = new Set<string>();
  const edges: Edge[] = [];
  for (const item of graph.modules) {
    if (!item.supportOf) continue;
    const pair = `${item.supportOf}→${item.id}`;
    supportPairs.add(pair);
    edges.push({
      id: `support:${item.supportOf}:${item.id}`,
      source: item.supportOf,
      target: item.id,
      sourceHandle: `support:${item.id}`,
      targetHandle: "in",
      type: "support",
      style: {
        stroke: colorOf(item.supportOf),
        strokeWidth: 1.5,
        strokeOpacity: EDGE_STYLE.opacity,
        strokeDasharray: "5 4",
        transition: "opacity 200ms ease, stroke 200ms ease, stroke-width 200ms ease, stroke-opacity 200ms ease",
      },
      selectable: false,
      focusable: false,
    });
  }

  const supportIds = new Set(graph.modules.filter((item) => item.supportOf).map((item) => item.id));
  let hiddenEdges = 0;
  for (const edge of graph.edges) {
    const touchesSupport = supportIds.has(edge.source) || supportIds.has(edge.target);
    if (!touchesSupport) {
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "routed",
        data: { points: routes.get(routeKey(edge.source, edge.target)) ?? [] },
        markerEnd: edgeMarker(colorOf(edge.source)),
        style: mainEdgeStyle(colorOf(edge.source)),
      });
      continue;
    }
    const pair = `${edge.source}→${edge.target}`;
    if (supportPairs.has(pair)) continue;
    hiddenEdges += 1;
  }

  return { nodes, edges, hiddenEdges };
}

/**
 * Flujo por capas con cajas de subsistema. Los nodos contenidos llevan `parentId` + `extent: "parent"`
 * y posición relativa a su caja; React Flow exige que el padre preceda a sus hijos en la lista.
 * Las aristas se orientan en el sentido del flujo (capa menor → mayor), eligen puerto
 * (izquierda/derecha entre columnas, arriba/abajo dentro de una columna) y llevan en `data.points`
 * la polilínea ortogonal de `routeLayeredEdges`, que rodea tarjetas y cajas ajenas.
 */
export function layeredFlow(prepared: PreparedGraph, layout: LayeredLayout): FlowResult {
  const base = graphToFlow(prepared.graph, layout.positions);
  const boxes = new Map(layout.boxes.map((box) => [box.id, box]));

  const groups: SubsystemFlowNode[] = layout.boxes.map((box) => ({
    id: `${SUBSYSTEM_NODE_PREFIX}${box.id}`,
    type: "subsystem",
    position: { x: box.x, y: box.y },
    width: box.width,
    height: box.height,
    zIndex: -1,
    selectable: false,
    focusable: false,
    data: { label: box.label, color: box.color },
  }));

  const boxOf = (node: ModuleFlowNode | SupportFlowNode) => {
    const owner = node.type === "support" ? node.data.module.supportOf : node.id;
    const subsystem = owner ? prepared.subsystemOf.get(owner) : undefined;
    return subsystem ? boxes.get(subsystem) : undefined;
  };

  const originals = new Map(prepared.graph.edges.map((item) => [item.id, item]));
  const byModule = new Map(prepared.graph.modules.map((item) => [item.id, item]));
  const oriented = base.edges.map((edge) => {
    const original = edge.type === "routed" ? originals.get(edge.id) : undefined;
    if (!original) return edge;
    const { source, target } = orientEdge(original, prepared.layerOf);
    // Al orientar, el origen puede cambiar: el color sigue al nodo del que sale el cable dibujado.
    const color = edgeColorOf(prepared.graph, byModule.get(source));
    return { ...edge, source, target, style: mainEdgeStyle(color), markerEnd: edgeMarker(color) };
  });
  const main = oriented.filter((edge) => edge.type === "routed");

  const rects = nodeRects(prepared, layout);
  const withSupports = new Set(prepared.graph.modules.flatMap((item) => (item.supportOf ? [item.supportOf] : [])));
  const ports = assignEdgePorts(main, (id) => rects.get(id), (id) => withSupports.has(id), rects);
  const withPorts = main.flatMap((edge) => {
    const pair = ports.get(edge.id);
    return pair ? [{ id: edge.id, source: edge.source, target: edge.target, ports: pair }] : [];
  });
  const slots = assignPortSlots(withPorts, (id) => rects.get(id));
  const routes = routeLayeredEdges(
    prepared,
    layout,
    withPorts.map((edge) => ({ ...edge, slots: slots.get(edge.id) })),
  );

  const handles = new Map<string, SlotHandle[]>();
  const addHandle = (nodeId: string, type: SlotHandle["type"], slot: PortSlot) => {
    const rect = rects.get(nodeId);
    if (!rect) return;
    const list = handles.get(nodeId) ?? [];
    list.push({ id: slotHandleId(slot), type, side: slot.side, percent: slotPercent(rect, slot) });
    handles.set(nodeId, list);
  };
  for (const edge of withPorts) {
    const pair = slots.get(edge.id);
    if (!pair) continue;
    addHandle(edge.source, "source", pair.source);
    addHandle(edge.target, "target", pair.target);
  }

  const outSides = new Map<string, PortSide[]>();
  const inSides = new Map<string, PortSide[]>();
  for (const edge of main) {
    const pair = ports.get(edge.id);
    if (!pair) continue;
    outSides.set(edge.source, [...(outSides.get(edge.source) ?? []), pair.source]);
    inSides.set(edge.target, [...(inSides.get(edge.target) ?? []), pair.target]);
  }

  const children = (base.nodes as Array<ModuleFlowNode | SupportFlowNode>).map((node) => {
    const box = boxOf(node);
    const placed =
      node.type === "module"
        ? {
            ...node,
            sourcePosition: PORT_POSITION[majoritySide(outSides.get(node.id) ?? [], "right")],
            targetPosition: PORT_POSITION[majoritySide(inSides.get(node.id) ?? [], "left")],
            data: {
              ...node.data,
              ports: [...new Set([...(outSides.get(node.id) ?? []), ...(inSides.get(node.id) ?? [])])],
              handles: handles.get(node.id) ?? [],
            },
          }
        : node;
    if (!box) return placed;
    return {
      ...placed,
      parentId: `${SUBSYSTEM_NODE_PREFIX}${box.id}`,
      extent: "parent" as const,
      position: { x: node.position.x - box.x, y: node.position.y - box.y },
    };
  });

  const edges = oriented.map((edge) => {
    const pair = ports.get(edge.id);
    if (edge.type !== "routed" || !pair) return edge;
    const slot = slots.get(edge.id);
    return {
      ...edge,
      sourceHandle: slot ? slotHandleId(slot.source) : portHandleId(pair.source),
      targetHandle: slot ? slotHandleId(slot.target) : portHandleId(pair.target),
      data: { points: routes.get(edge.id) ?? [] },
    };
  });

  return { nodes: [...groups, ...children], edges, hiddenEdges: base.hiddenEdges };
}

/** Posición (0–100 %) de una ranura a lo largo de su lado, la misma que usa el router para anclar el cable. */
function slotPercent(rect: Rect, slot: PortSlot): number {
  const length = sideLength(rect, slot.side);
  return length > 0 ? 50 + (slotOffset(slot, length) / length) * 100 : 50;
}

/**
 * Extremos de todas las aristas que dibujaría `layeredFlow` (mismos ids y orientación), sin calcular layout.
 * Simulación, playground e impacto trabajan sobre el grafo completo aunque el lienzo muestre Level 0 o un solo bloque.
 */
export function flowEdgeEndpoints(prepared: PreparedGraph): Array<{ id: string; source: string; target: string }> {
  return graphToFlow(prepared.graph, new Map()).edges.map((edge) => {
    if (edge.type !== "routed") return { id: edge.id, source: edge.source, target: edge.target };
    const { source, target } = orientEdge({ id: edge.id, source: edge.source, target: edge.target, kind: "imports" }, prepared.layerOf);
    return { id: edge.id, source, target };
  });
}

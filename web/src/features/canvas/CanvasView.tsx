"use client";

import { useEffect, useRef, type DragEvent } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, useReactFlow, useStore, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PlayerBar } from "@/features/simulation/components/PlayerBar";
import { SimulationBridge } from "@/features/simulation/SimulationBridge";
import { ZoomControls } from "./components/ZoomControls";
import { edgeTypes } from "./edges/RoutedEdge";
import { COMPONENT_DRAG_TYPE, insertComponent } from "./edit/ComponentPalette";
import { isComponentTemplateId } from "./edit/components";
import { useCanvasEdits } from "./edit/store";
import { exploreCode, revealInEditor } from "./lib/actions";
import { isSubsystemNode, type AppFlowNode } from "./lib/flow";
import { archResolutionFor, AUTO_DRILL_ZOOM } from "./lib/level0";
import { nodeTypes } from "./nodes/nodeTypes";
import { useCanvasStore } from "./store";
import { CARD_HEIGHT, CARD_WIDTH, FIT_VIEW_OPTIONS, GROUP_STYLES, MINIMAP_HEIGHT, MINIMAP_WIDTH, ROLE_TONE } from "./theme";

interface CanvasViewProps {
  nodes: AppFlowNode[];
  edges: Edge[];
  /** Cambia al pasar de Level 0 a un bloque (o volver): el encuadre se recalcula. */
  viewKey: string;
}

/** Frames que se espera, como mucho, a que la vista nueva llegue a React Flow antes de encuadrar igualmente. */
const REFIT_MAX_FRAMES = 30;

/**
 * `fitView` de React Flow solo actúa al montar; al cambiar de nivel (Sistema, Arquitectura, un servicio) se reencuadra
 * a mano. No se usa `fitView`: con `onlyRenderVisibleElements` un nodo fuera de pantalla no se mide, `fitView` lo
 * ignora y el encuadre se queda al zoom máximo sobre los que sí se ven. Aquí la caja sale de las posiciones del layout
 * (que se conocen para todos) y del tamaño declarado o medido de cada nodo.
 */
function RefitOnViewChange({ viewKey, nodes }: { viewKey: string; nodes: readonly AppFlowNode[] }) {
  const flow = useReactFlow<AppFlowNode>();
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  // Al montar ya encuadra la prop `fitView`; aquí solo cuentan los cambios de vista posteriores.
  const fittedKey = useRef(viewKey);
  useEffect(() => {
    if (fittedKey.current === viewKey || paneWidth === 0 || paneHeight === 0) return;
    fittedKey.current = viewKey;
    const expected = nodes.map((node) => node.id);
    let frame = 0;
    let handle = 0;
    const tick = (): void => {
      frame += 1;
      const internals = expected.map((id) => flow.getInternalNode(id));
      if (internals.some((node) => node === undefined) && frame < REFIT_MAX_FRAMES) {
        handle = requestAnimationFrame(tick);
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of internals) {
        if (!node) continue;
        const { x, y } = node.internals.positionAbsolute;
        const width = node.measured.width ?? node.width ?? CARD_WIDTH;
        const height = node.measured.height ?? node.height ?? CARD_HEIGHT;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
      if (!Number.isFinite(minX)) return;
      const usable = 1 - 2 * FIT_VIEW_OPTIONS.padding;
      const zoom = Math.max(0.1, Math.min(FIT_VIEW_OPTIONS.maxZoom, (paneWidth * usable) / (maxX - minX), (paneHeight * usable) / (maxY - minY)));
      void flow.setViewport(
        { x: paneWidth / 2 - ((minX + maxX) / 2) * zoom, y: paneHeight / 2 - ((minY + maxY) / 2) * zoom, zoom },
        { duration: 300 },
      );
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
    // `nodes` cambia en cada pintado (selección, simulación): solo el cambio de vista dispara el encuadre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, viewKey, paneWidth, paneHeight]);
  return null;
}

interface DropTarget {
  /** Nodo sugerido para «Empalmar en el flujo»: el que está bajo el puntero o el más cercano. */
  suggested: string | null;
  /** Esquina superior izquierda de la tarjeta, centrada en el punto de caída. */
  position: { x: number; y: number };
}

/**
 * Punto de caída en coordenadas del lienzo y nodo (no subsistema) sugerido para empalmar: el que está bajo
 * el puntero o, si se suelta en el vacío, el más cercano. Solo es una sugerencia: nada se conecta solo.
 */
function useDropTarget(): (event: DragEvent) => DropTarget {
  const flow = useReactFlow<AppFlowNode>();
  return (event) => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const position = { x: point.x - CARD_WIDTH / 2, y: point.y - CARD_HEIGHT / 2 };
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-module]");
    if (hit?.dataset.module) return { suggested: hit.dataset.module, position };
    let best: { id: string; distance: number } | null = null;
    for (const node of flow.getNodes()) {
      if (isSubsystemNode(node)) continue;
      const internal = flow.getInternalNode(node.id);
      if (!internal) continue;
      const { x, y } = internal.internals.positionAbsolute;
      const cx = x + (internal.measured.width ?? 0) / 2;
      const cy = y + (internal.measured.height ?? 0) / 2;
      const distance = Math.hypot(point.x - cx, point.y - cy);
      if (!best || distance < best.distance) best = { id: node.id, distance };
    }
    return { suggested: best?.id ?? null, position };
  };
}

/**
 * Zoom semántico ligado al viewport: la resolución (0–2) sigue al zoom, y acercarse del todo sobre un bloque de
 * Level 0 entra en él. Solo reacciona a gestos del usuario (`event` no nulo): los encuadres automáticos al cambiar de
 * nivel no disparan otro cambio de nivel.
 */
function useSemanticZoom(container: React.RefObject<HTMLDivElement | null>) {
  const flow = useReactFlow<AppFlowNode>();
  return {
    onMove: (_: unknown, viewport: { zoom: number }) => useCanvasStore.getState().setArchResolution(archResolutionFor(viewport.zoom)),
    onMoveEnd: (event: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => {
      if (!event || viewport.zoom < AUTO_DRILL_ZOOM) return;
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return;
      const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const hit = flow.getNodes().find((node) => {
        if (!isSubsystemNode(node) || !node.data.level0 || node.data.level0.primaryModuleId) return false;
        const width = node.width ?? 0;
        const height = node.height ?? 0;
        return center.x >= node.position.x && center.x <= node.position.x + width && center.y >= node.position.y && center.y <= node.position.y + height;
      });
      if (hit && isSubsystemNode(hit) && hit.data.level0) useCanvasStore.getState().enterSubsystem(hit.data.level0.blockId);
    },
  };
}

export function CanvasView({ nodes, edges, viewKey }: CanvasViewProps) {
  const presentation = useCanvasStore((state) => state.presentation);
  const dropTarget = useDropTarget();
  const container = useRef<HTMLDivElement>(null);
  const semanticZoom = useSemanticZoom(container);
  return (
    <div
      ref={container}
      className="absolute inset-0"
      onDragOver={(event) => {
        if (presentation || !event.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const template = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);
        if (!isComponentTemplateId(template)) return;
        event.preventDefault();
        const { suggested, position } = dropTarget(event);
        insertComponent(template, suggested, { detached: true, position });
      }}
    >
      <ReactFlow<AppFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="light"
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        maxZoom={1.5}
        nodesConnectable={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        onMove={semanticZoom.onMove}
        onMoveEnd={semanticZoom.onMoveEnd}
        onNodeClick={(_, node) => {
          if (isSubsystemNode(node)) {
            const level0 = node.data.level0;
            if (!level0) return;
            // Un nodo de un solo módulo (MongoDB, Redpanda…) no tiene detalle que abrir: se muestran sus datos.
            if (level0.primaryModuleId) useCanvasStore.getState().selectModule(level0.primaryModuleId);
            // Level 0: el bloque es la puerta al detalle de sus módulos.
            else useCanvasStore.getState().enterSubsystem(level0.blockId);
            return;
          }
          useCanvasStore.getState().selectModule(node.id);
          // Lienzo → IDE: con la extensión conectada, el editor salta al archivo y línea del módulo.
          revealInEditor(node.id);
        }}
        onNodeContextMenu={(event, node) => {
          if (isSubsystemNode(node) || presentation) return;
          event.preventDefault();
          useCanvasStore.getState().selectModule(node.id);
          useCanvasEdits.getState().openMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
        }}
        onNodeDoubleClick={(_, node) => {
          if (!isSubsystemNode(node)) exploreCode(node.id);
        }}
        onNodeMouseEnter={(_, node) => {
          if (!isSubsystemNode(node)) useCanvasStore.getState().setHover({ kind: "module", id: node.id });
        }}
        onNodeMouseLeave={() => useCanvasStore.getState().setHover(null)}
        onEdgeMouseEnter={(_, edge) => useCanvasStore.getState().setHover({ kind: "edge", id: edge.id })}
        onEdgeMouseLeave={() => useCanvasStore.getState().setHover(null)}
        onPaneClick={() => {
          useCanvasEdits.getState().closeMenu();
          const state = useCanvasStore.getState();
          state.deselect();
          state.clearImpact();
        }}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cbd5e1" />
        {presentation ? null : (
        <MiniMap<AppFlowNode>
          position="bottom-left"
          pannable
          zoomable
          style={{
            width: MINIMAP_WIDTH,
            height: MINIMAP_HEIGHT,
            borderRadius: 12,
            border: "1px solid #e5e5e5",
          }}
          bgColor="#ffffff"
          maskColor="rgba(248, 250, 252, 0.7)"
          nodeColor={(node) =>
            isSubsystemNode(node)
              ? node.data.level0
                ? GROUP_STYLES[node.data.color].hex
                : "rgba(163, 163, 163, 0.15)"
              : ROLE_TONE[node.data.role].hex
          }
          nodeBorderRadius={6}
        />
        )}
        <ZoomControls />
        <RefitOnViewChange viewKey={viewKey} nodes={nodes} />
        <SimulationBridge />
        <PlayerBar />
      </ReactFlow>
    </div>
  );
}

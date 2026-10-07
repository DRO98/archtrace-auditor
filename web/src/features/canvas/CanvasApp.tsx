"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { LayoutGrid, Loader2 } from "lucide-react";
import type { CodeGraph } from "@core/graph";
import { useScenarios } from "@/features/simulation/lib/useScenarios";
import { buildSystemScenarios } from "@/features/simulation/lib/systemScenario";
import { uiLanguage } from "@/lib/i18n/lang";
import type { NodeSimStatus } from "@/features/simulation/lib/visuals";
import { stopSimulation } from "@/features/simulation/lib/actions";
import { useSimStore } from "@/features/simulation/store";
import { DemoBanner } from "@/features/demos/components/DemoBanner";
import { demoByGraph } from "@/features/demos";
import { cancelPlayground } from "@/features/playground/hooks/usePlaygroundTrace";
import { PlaygroundBridge } from "@/features/playground/PlaygroundBridge";
import { PlaygroundDrawer } from "@/features/playground/components/PlaygroundDrawer";
import { usePlaygroundStore } from "@/features/playground/store";
import { TeacherDrawer } from "@/features/drawer/TeacherDrawer";
import { HistoryView } from "@/features/history/HistoryView";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { PresentationBar } from "@/features/share/components/PresentationBar";
import { AppHeader } from "./components/AppHeader";
import { ImportStatsBanner } from "./components/ImportStatsBanner";
import { LevelBreadcrumb } from "./components/LevelBreadcrumb";
import { ExportCodeModal } from "./components/ExportCodeModal";
import { ExportDocsModal, type ExportFormat } from "./components/ExportDocsModal";
import { CanvasView } from "./CanvasView";
import { LeftRail } from "./components/LeftRail";
import { IdeSyncBridge } from "./IdeSyncBridge";
import { SourceSyncBridge } from "./SourceSyncBridge";
import { inferRole } from "./lib/architecture";
import { ARCHITECTURE_KIND_INFO } from "./lib/architectureKind";
import { useArchitectureKind } from "./lib/useArchitectureKind";
import { RIGHT_PANEL_CLASS } from "./theme";
import { DriftBanner } from "@/features/health/DriftBanner";
import { useHealthSync } from "@/features/health/store";
import { useCheckNudge } from "@/features/health/useCheckNudge";
import { calculateBlastRadius, impactVisual } from "./lib/blastRadius";
import { paintEdges } from "./lib/edgeFocus";
import { useGraphName } from "./lib/useGraphName";
import { loadCodeGraph } from "./lib/graphRepair";
import { flowEdgeEndpoints, isSubsystemNode, layeredFlow, type AppFlowNode } from "./lib/flow";
import { buildLevel0, focusPrepared, isLeafBlock, layoutLevel0, level0Flow, shouldUseLevel0 } from "./lib/level0";
import { abstractView } from "./lib/abstractions";
import { filterNoise } from "./lib/architectureSkeleton";
import { layoutLayered } from "./lib/layout";
import { prepareGraph } from "./lib/subsystems";
import { useCanvasKeys } from "./lib/useCanvasKeys";
import { hydrateMemoryGraphs, isMemoryGraphName, memoryGraph, memorySourceMeta, touchMemoryGraph } from "./lib/memoryGraphs";
import { SHARED_GRAPH_PREFIX } from "./lib/graphName";
import { decodeShareState, sharedDataFromHash, type SharedView } from "@/features/share/lib/shareState";
import { useCanvasStore } from "./store";
import { applyCanvasEdits, placeDetachedNodes, type AddedComponent } from "./edit/components";
import { NodeContextMenu } from "./edit/NodeContextMenu";
import { useCanvasEdits } from "./edit/store";
import { useRecordRuns } from "@/features/runs/useRecordRuns";
import { modelLabel } from "@/lib/ai/catalog";
import { resolveStageNode } from "@/lib/rag/stageNodes";
import { markCanvasOpened } from "@/lib/metrics/localMetrics";

type LoadState =
  | { status: "loading" }
  | { status: "error"; errors: string[] }
  | { status: "ready"; graph: CodeGraph; warnings: string[] };

type GraphSource = { ok: true; body: unknown; view?: SharedView } | { ok: false; error: string };

/**
 * De dónde sale cada grafo: enlace compartido (`#data=`), repo importado de GitHub (solo en memoria),
 * demo (en el bundle) o `public/graphs/<nombre>.json`.
 */
async function readGraphSource(name: string): Promise<GraphSource> {
  if (name.startsWith(SHARED_GRAPH_PREFIX)) {
    const payload = decodeShareState(sharedDataFromHash(window.location.hash) ?? "");
    if (!payload) return { ok: false, error: "El enlace compartido está incompleto o dañado (#data= no se pudo descomprimir)." };
    const { graph, ...view } = payload;
    return { ok: true, body: graph, view };
  }
  // Tras recargar, los grafos importados vuelven desde IndexedDB.
  if (isMemoryGraphName(name) && !memoryGraph(name)) await hydrateMemoryGraphs();
  const inMemory = memoryGraph(name);
  if (inMemory) {
    touchMemoryGraph(name);
    return { ok: true, body: structuredClone(inMemory) };
  }
  if (isMemoryGraphName(name)) {
    return {
      ok: false,
      error: "Esta fuente importada no está guardada en este navegador (se borró, o se importó en otro navegador o en modo privado): vuelve a importarla desde «Pipelines».",
    };
  }
  const demo = demoByGraph(name);
  if (demo) return { ok: true, body: structuredClone(demo.graph) };
  const response = await fetch(`/graphs/${name}.json`);
  if (!response.ok) return { ok: false, error: `No se encontró /graphs/${name}.json` };
  return { ok: true, body: (await response.json()) as unknown };
}

/** Selección y modo presentación que traía el enlace compartido. */
function applySharedView(view: SharedView, graph: CodeGraph): void {
  const state = useCanvasStore.getState();
  if (view.selectedModuleId && graph.modules.some((item) => item.id === view.selectedModuleId)) {
    state.selectModule(view.selectedModuleId);
  }
  if (view.presentation) state.setPresentation(true);
}

function useProjectGraph(name: string | null): LoadState {
  // Guardado junto al nombre que lo produjo: al cambiar de grafo, el anterior cuenta como "cargando".
  const [state, setState] = useState<{ name: string; load: LoadState } | null>(null);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    const done = (load: LoadState): void => {
      if (!cancelled) setState({ name, load });
    };

    async function load(graphName: string): Promise<void> {
      try {
        const source = await readGraphSource(graphName);
        if (!source.ok) return done({ status: "error", errors: [source.error] });
        const loaded = loadCodeGraph(source.body);
        if (cancelled) return;
        if (!loaded.ok) return done({ status: "error", errors: loaded.errors });
        if (loaded.warnings.length > 0) console.warn("[teacher] grafo reparado al cargar", loaded.warnings);
        useCanvasStore.getState().setGraph(loaded.graph);
        if (source.view) applySharedView(source.view, loaded.graph);
        done({ status: "ready", graph: loaded.graph, warnings: loaded.warnings });
      } catch (error) {
        const message =
          error instanceof SyntaxError
            ? `/graphs/${graphName}.json no es JSON válido (${error.message})`
            : error instanceof Error
              ? error.message
              : "Error al leer el grafo";
        done({ status: "error", errors: [message] });
      }
    }

    // Lo que pintaba el grafo anterior no tiene sentido en el nuevo.
    if (useSimStore.getState().activeScenarioId) stopSimulation();
    cancelPlayground();
    void load(name);
    return () => {
      cancelled = true;
    };
  }, [name]);

  return state && state.name === name ? state.load : { status: "loading" };
}

function paintSimulation(
  nodes: AppFlowNode[],
  nodeStatus: Readonly<Record<string, NodeSimStatus>>,
): AppFlowNode[] {
  if (Object.keys(nodeStatus).length === 0) return nodes;
  const painted = nodes.map((node): AppFlowNode => {
    // En el mapa de sistema los pasos del recorrido son los propios bloques de Level 0.
    if (isSubsystemNode(node)) return node.data.level0 ? { ...node, data: { ...node.data, sim: nodeStatus[node.id] } } : node;
    const sim = nodeStatus[node.id];
    if (node.type === "support") return { ...node, data: { ...node.data, sim } };
    return { ...node, data: { ...node.data, sim } };
  });
  const previewing = Object.values(nodeStatus).includes("preview");
  if (!previewing) return painted;
  const litParents = new Set<string>();
  for (const node of painted) {
    if (isSubsystemNode(node) || node.data.sim !== "preview" || !node.parentId) continue;
    litParents.add(node.parentId);
  }
  return painted.map((node): AppFlowNode => {
    if (!isSubsystemNode(node)) return node;
    return { ...node, data: { ...node.data, dimmed: !litParents.has(node.id) } };
  });
}

const NO_COMPONENTS: readonly AddedComponent[] = [];

/** Chip con el modelo asignado sobre el nodo LLM. */
function paintLlm(nodes: AppFlowNode[], llmNodeId: string | null, llmModel: string): AppFlowNode[] {
  if (!llmNodeId) return nodes;
  return nodes.map((node): AppFlowNode => {
    if (node.id !== llmNodeId || isSubsystemNode(node)) return node;
    if (node.type === "support") return { ...node, data: { ...node.data, llmModel } };
    return { ...node, data: { ...node.data, llmModel } };
  });
}

/** Badge de latencia del playground en cada nodo recorrido. */
function paintLatency(nodes: AppFlowNode[], latencyByNode: Readonly<Record<string, number>>): AppFlowNode[] {
  if (Object.keys(latencyByNode).length === 0) return nodes;
  return nodes.map((node): AppFlowNode => {
    const latencyMs = latencyByNode[node.id];
    if (isSubsystemNode(node) || latencyMs === undefined) return node;
    if (node.type === "support") return { ...node, data: { ...node.data, latencyMs } };
    return { ...node, data: { ...node.data, latencyMs } };
  });
}

function paintNodes(
  nodes: AppFlowNode[],
  active: boolean,
  sourceId: string | null,
  depthMap: Record<string, number>,
): AppFlowNode[] {
  if (!active || !sourceId) return nodes;
  return nodes.map((node): AppFlowNode => {
    if (isSubsystemNode(node)) return node;
    const impact = impactVisual(node.id, true, sourceId, depthMap);
    const impactDepth = depthMap[node.id];
    if (node.type === "support") return { ...node, data: { ...node.data, impact, impactDepth } };
    return { ...node, data: { ...node.data, impact, impactDepth } };
  });
}

/**
 * Aviso de grafo reparado: solo a consola (no banner). El detalle técnico no debe tapar el mapa.
 */
function EmptyCanvas() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-white px-6 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-neutral-100 text-ink-2" aria-hidden>
          <LayoutGrid className="size-5" />
        </span>
        <h2 className="text-sm font-semibold text-ink">No hay módulos que mostrar</h2>
        <p className="text-sm text-ink-2">
          El grafo está vacío o todos sus módulos están aislados. Regenera el grafo con{" "}
          <span className="font-mono text-xs">npm run graph:build</span>.
        </p>
      </div>
    </div>
  );
}

function CanvasShell({ graph: loadedGraph, graphName }: { graph: CodeGraph; graphName: string }) {
  useCanvasKeys();
  useRecordRuns(graphName);
  const demo = demoByGraph(graphName);
  // El store tiene la versión viva del grafo (parches del IDE → SourceSyncBridge); la capa de edición
  // del lienzo (componentes añadidos) se aplica encima sin tocar el grafo original.
  const liveGraph = useCanvasStore((state) => state.graph) ?? loadedGraph;
  const components = useCanvasEdits((state) => (state.graphName === graphName ? state.components : NO_COMPONENTS));
  const editsLoaded = useCanvasEdits((state) => state.graphName === graphName);
  useEffect(() => {
    useCanvasEdits.getState().load(graphName);
  }, [graphName]);
  useEffect(() => {
    // El modelo asignado al nodo LLM en una sesión anterior vuelve a mandar en "Probar en vivo".
    const { llm } = useCanvasEdits.getState();
    const playground = usePlaygroundStore.getState();
    if (!editsLoaded || !llm || playground.status === "running") return;
    playground.setProvider(llm.provider);
    playground.setModel(llm.model);
  }, [editsLoaded]);
  const graph = useMemo(() => applyCanvasEdits(liveGraph, components), [liveGraph, components]);
  useEffect(() => {
    const playground = usePlaygroundStore.getState();
    playground.setDemo(demo?.playground ?? null);
    // Una demo no-RAG abre "Probar / Simular" en su perfil (evento, HTTP) con su payload de ejemplo.
    if (demo?.trace && playground.status !== "running") {
      playground.setProfile(demo.trace.profile);
      usePlaygroundStore.getState().setPayload(demo.trace.payload);
    } else if (demo?.playground) {
      playground.setProfile("rag");
    }
  }, [demo]);
  const { kind: architectureKind } = useArchitectureKind();
  useHealthSync(graphName);
  useEffect(() => {
    // Fuera de las demos, el perfil de "Probar / Simular" sigue al tipo de arquitectura (no se asume RAG).
    if (demo || usePlaygroundStore.getState().status === "running") return;
    usePlaygroundStore.getState().setProfile(ARCHITECTURE_KIND_INFO[architectureKind].traceProfile);
  }, [demo, architectureKind]);
  const importMeta = useMemo(() => memorySourceMeta(graphName), [graphName]);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [exportCodeOpen, setExportCodeOpen] = useState(false);
  const selectedModuleId = useCanvasStore((state) => state.selectedModuleId);
  const hover = useCanvasStore((state) => state.hover);
  const impactHoverEdgeId = useCanvasStore((state) => state.impactHoverEdgeId);
  const impactAnalysisMode = useCanvasStore((state) => state.impactAnalysisMode);
  const selectedImpactNodeId = useCanvasStore((state) => state.selectedImpactNodeId);
  const view = useCanvasStore((state) => state.view);
  const presentation = useCanvasStore((state) => state.presentation && state.view === "architecture");
  // Tras importar, el primer vistazo enseña mapa + hallazgos: el Check se abre solo una vez por grafo.
  useCheckNudge(graphName, graph, importMeta !== undefined && !demo && !presentation);
  const nodeStatus = useSimStore((state) => state.nodeStatus);
  const previewNodeStatus = useSimStore((state) => state.previewNodeStatus);
  const tracing = usePlaygroundStore((state) => state.status !== "idle");
  const traceNodeStatus = usePlaygroundStore((state) => state.nodeStatus);
  const latencyByNode = usePlaygroundStore((state) => state.latencyByNode);
  const playgroundOpen = usePlaygroundStore((state) => state.open);
  const playgroundProvider = usePlaygroundStore((state) => state.provider);
  const playgroundModel = usePlaygroundStore((state) => state.model);
  const archLevel = useCanvasStore((state) => state.archLevel);
  const focusedSubsystemId = useCanvasStore((state) => state.focusedSubsystemId);
  const prepared = useMemo(() => prepareGraph(graph), [graph]);
  const level0 = useMemo(() => buildLevel0(prepared), [prepared]);
  // Demos y lienzos con componentes añadidos van directos al detalle: Level 0 es para entender un repo, no para editarlo.
  const level0Enabled = !demo && components.length === 0 && shouldUseLevel0(prepared, level0);
  // Mapa de sistema (compose): la vista «todos los módulos» no existe; sin bloque abierto se está en el mapa.
  const systemMap = level0Enabled && level0.style === "system";
  const archView = useCanvasStore((state) => state.archView);
  const focusedBlock = level0Enabled && archLevel === 1 ? (level0.blocks.find((block) => block.id === focusedSubsystemId) ?? null) : null;
  // P0: con Level 0 disponible, sin bloque abierto se muestra el mapa — nunca el hairball de todos los módulos.
  const showLevel0 = level0Enabled && (archLevel === 0 || focusedBlock === null);
  // Nivel superior del mapa de sistema: «Sistema» (un nodo por servicio) o «Arquitectura» (el mismo mapa con cada
  // servicio desplegado en sus abstracciones). Las dos son el mapa: mismas columnas, flechas y simulación.
  const architectureMode = systemMap && showLevel0 && archView === "architecture";
  // En Level 1 de un repo grande se quita el ruido (`__init__`, tests, configs); las demos pequeñas se ven tal cual.
  // En el esqueleto de sistema, entrar en un bloque enseña sus abstracciones (API, Agente / LLM…), no sus archivos.
  const drillFiles = useCanvasStore((state) => state.drillFiles);
  const visible = useMemo(() => {
    if (!focusedBlock) return level0Enabled ? filterNoise(prepared) : prepared;
    if (level0.style === "system" && !drillFiles) return abstractView(prepared, focusedBlock.moduleIds);
    return focusPrepared(prepared, focusedBlock);
  }, [prepared, focusedBlock, level0Enabled, level0.style, drillFiles]);
  const layout = useMemo(() => (showLevel0 ? null : layoutLayered(visible)), [visible, showLevel0]);
  const blocks = useMemo(
    () => graph.modules.reduce((total, item) => total + item.subBlocks.length, 0),
    [graph],
  );

  useEffect(() => {
    const started = performance.now();
    layoutLayered(prepareGraph(graph));
    const ms = performance.now() - started;
    if (process.env.NODE_ENV === "development") {
      console.info(`[teacher] layout ${ms.toFixed(1)} ms · ${graph.modules.length} módulos · ${blocks} bloques`);
      if (prepared.hidden.length > 0) {
        console.info(`[teacher] ocultos por estar aislados: ${prepared.hidden.map((item) => item.label).join(", ")}`);
      }
    }
    useCanvasStore.getState().setLayoutStats({ ms, modules: graph.modules.length, blocks });
  }, [graph, blocks, prepared]);

  const level0View = useMemo(
    () => level0Flow(level0, layoutLevel0(level0, { expanded: architectureMode }), { expanded: architectureMode }),
    [level0, architectureMode],
  );
  const flow = useMemo(() => {
    if (!layout) return level0View;
    const base = layeredFlow(visible, layout);
    // Componentes sueltos: en su punto de caída, no donde los pondría el layout automático.
    return { ...base, nodes: placeDetachedNodes(base.nodes, components) };
  }, [level0View, visible, layout, components]);
  const viewKey = showLevel0 ? (architectureMode ? "level0:architecture" : "level0") : `level1:${focusedBlock?.id ?? "all"}`;
  useEffect(() => {
    // Dogfood: tiempo desde «Importar» hasta ver Level 0 (solo en localStorage, ver `lib/metrics/localMetrics.ts`).
    const ms = markCanvasOpened(graphName, showLevel0);
    if (ms !== null && process.env.NODE_ENV === "development") console.info(`[teacher] import → Level 0 en ${ms} ms`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo la primera vista del grafo
  }, [graphName]);
  // Playground e impacto ven siempre el grafo completo, se esté en Level 0, en un bloque o en todo.
  const simEdges = useMemo(() => flowEdgeEndpoints(prepared), [prepared]);
  const simNodeIds = useMemo(() => prepared.graph.modules.map((item) => item.id), [prepared.graph]);
  // Con mapa de sistema, «Simular flujo» recorre los servicios que se ven en Level 0, no los archivos.
  const systemScenarios = useMemo(() => {
    if (!systemMap) return null;
    const list = buildSystemScenarios(level0, prepared.graph, uiLanguage());
    return list.length > 0 ? list : null;
  }, [systemMap, level0, prepared.graph]);
  const scenarioEdges = useMemo(
    () => (systemMap ? level0View.edges.map(({ id, source, target }) => ({ id, source, target })) : simEdges),
    [systemMap, level0View, simEdges],
  );
  const scenarioNodeIds = useMemo(() => (systemMap ? level0View.nodes.map((node) => node.id) : simNodeIds), [systemMap, level0View, simNodeIds]);
  const simulating = useSimStore((state) => state.activeScenarioId !== null);
  useEffect(() => {
    const canvas = useCanvasStore.getState();
    // El recorrido de sistema pinta los bloques de Level 0: si se simula desde dentro de un bloque, se vuelve al mapa.
    if (systemMap && simulating && !showLevel0) canvas.exitToLevel0();
    // P0: nunca forzar «todos los módulos» por traza/simulación (antes: enterSubsystem(null) → hairball).
  }, [systemMap, showLevel0, simulating]);
  useEffect(() => {
    useCanvasStore.getState().setSystemMode(systemMap);
  }, [systemMap]);
  const openedSystemFor = useRef<string | null>(null);
  useEffect(() => {
    // Al abrir un grafo con Level 0 se empieza siempre en el mapa (una vez por grafo).
    if (!level0Enabled || openedSystemFor.current === graphName) return;
    openedSystemFor.current = graphName;
    useCanvasStore.getState().exitToLevel0();
  }, [level0Enabled, graphName]);
  // Escape del hairball legado: L1 sin bloque abierto no es una vista válida.
  useEffect(() => {
    if (!level0Enabled) return;
    if (archLevel === 1 && focusedSubsystemId === null) useCanvasStore.getState().exitToLevel0();
  }, [level0Enabled, archLevel, focusedSubsystemId]);
  useEffect(() => {
    useCanvasStore.getState().setSystemMapShown(systemMap && showLevel0);
  }, [systemMap, showLevel0]);
  useEffect(() => {
    // Seleccionar un módulo desde fuera del lienzo (búsqueda, lección, IDE) abre el bloque que lo contiene.
    if (!level0Enabled || !selectedModuleId) return;
    const blockId = level0.blockOf.get(selectedModuleId);
    // Módulo sin bloque: no hay vista de «todos los archivos»; se queda en el mapa.
    if (!blockId) return;
    if (archLevel === 1 && (focusedSubsystemId === null || focusedSubsystemId === blockId)) return;
    // Un nodo de un solo módulo (MongoDB…) se selecciona en Level 0 sin abrir un detalle vacío.
    const block = level0.blocks.find((item) => item.id === blockId);
    if (archLevel === 0 && block && isLeafBlock(block)) return;
    useCanvasStore.getState().enterSubsystem(blockId);
  }, [level0Enabled, level0, selectedModuleId, archLevel, focusedSubsystemId]);
  useEffect(() => {
    useSimStore.getState().configure({ edges: scenarioEdges, nodeIds: scenarioNodeIds });
  }, [scenarioEdges, scenarioNodeIds]);
  const playgroundModules = useMemo(
    () => prepared.graph.modules.map((item) => ({ id: item.id, label: item.label, filePath: item.filePath, role: item.role ?? inferRole(item) })),
    [prepared.graph],
  );
  const traceEdges = useMemo(
    () => prepared.graph.edges.map(({ id, source, target, kind }) => ({ id, source, target, kind })),
    [prepared.graph],
  );
  useEffect(() => {
    usePlaygroundStore.getState().configure({ edges: simEdges, modules: playgroundModules, graphEdges: traceEdges });
  }, [simEdges, playgroundModules, traceEdges]);
  const llmNodeId = useMemo(
    () =>
      demo?.playground
        ? (demo.playground.stages.find((stage) => stage.stage === "llm")?.nodeId ?? null)
        : demo
          ? null
          : resolveStageNode("llm", playgroundModules),
    [demo, playgroundModules],
  );
  const llmModel = demo?.playground ? demo.playground.model : modelLabel(playgroundProvider, playgroundModel);
  const labelOf = useMemo(() => {
    const labels = new Map(prepared.graph.modules.map((item) => [item.id, item.label]));
    return (id: string): string | null => labels.get(id) ?? null;
  }, [prepared.graph]);
  useScenarios(prepared.graph, simEdges, systemScenarios);
  const blast = useMemo(
    () =>
      impactAnalysisMode && selectedImpactNodeId
        ? calculateBlastRadius(selectedImpactNodeId, simEdges)
        : null,
    [simEdges, impactAnalysisMode, selectedImpactNodeId],
  );
  const nodes = useMemo(() => {
    const base = paintLlm(paintNodes(flow.nodes, impactAnalysisMode, selectedImpactNodeId, blast?.depthMap ?? {}), llmNodeId, llmModel);
    // La traza del playground tiene prioridad sobre la simulación (y su vista previa).
    if (tracing) return paintLatency(paintSimulation(base, traceNodeStatus), latencyByNode);
    return paintSimulation(base, Object.keys(nodeStatus).length > 0 ? nodeStatus : previewNodeStatus);
  }, [flow.nodes, impactAnalysisMode, selectedImpactNodeId, blast, nodeStatus, previewNodeStatus, tracing, traceNodeStatus, latencyByNode, llmNodeId, llmModel]);
  const edges = useMemo(
    () =>
      paintEdges(flow.edges, { selectedModuleId, hover, affectedEdgeIds: blast?.affectedEdgeIds ?? null, impactHoverEdgeId }),
    [flow.edges, selectedModuleId, hover, blast, impactHoverEdgeId],
  );

  return (
    <div className="flex h-full flex-col bg-canvas text-ink" data-presentation={presentation || undefined}>
      {presentation ? null : <AppHeader projectName={graph.projectName} onExport={setExportFormat} onExportCode={() => setExportCodeOpen(true)} />}
      <PlaygroundBridge />
      <div className="flex min-h-0 flex-1">
        {presentation ? null : <LeftRail />}
        <main className="relative min-w-0 flex-1">
          {view === "architecture" ? (
            <SectionErrorBoundary title="el lienzo">
              {nodes.length === 0 ? <EmptyCanvas /> : <CanvasView nodes={nodes} edges={edges} viewKey={viewKey} />}
              {presentation ? <PresentationBar projectName={graph.projectName} /> : null}
              {!presentation ? (
                <div className="pointer-events-none absolute left-3 top-3 z-20 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-2">
                  {demo ? <div className="pointer-events-auto"><DemoBanner key={demo.graphName} demo={demo} /></div> : null}
                  {importMeta && !demo ? (
                    <div className="pointer-events-auto">
                      <ImportStatsBanner meta={importMeta} />
                    </div>
                  ) : null}
                  {level0Enabled ? (
                    <LevelBreadcrumb
                      level0={level0}
                      showLevel0={showLevel0}
                      focusedBlock={focusedBlock}
                      architectureMode={architectureMode}
                    />
                  ) : null}
                </div>
              ) : null}
              {!presentation ? <DriftBanner /> : null}
            </SectionErrorBoundary>
          ) : (
            <HistoryView />
          )}
        </main>
        {/* Una sola columna a la derecha: "Probar en vivo" o los detalles del módulo, nunca ambos. */}
        {presentation ? null : (
          <SectionErrorBoundary title="el panel" className={RIGHT_PANEL_CLASS}>
            {playgroundOpen && view === "architecture" ? <PlaygroundDrawer /> : <TeacherDrawer />}
          </SectionErrorBoundary>
        )}
      </div>
      {view === "architecture" && !presentation ? <NodeContextMenu labelOf={labelOf} llmNodeId={llmNodeId} demo={demo !== null} /> : null}
      {exportFormat ? <ExportDocsModal format={exportFormat} onClose={() => setExportFormat(null)} /> : null}
      {exportCodeOpen ? <ExportCodeModal onClose={() => setExportCodeOpen(false)} /> : null}
    </div>
  );
}

function ReadyCanvas({ graph, graphName }: { graph: CodeGraph; graphName: string }) {
  return (
    <ReactFlowProvider>
      <CanvasShell graph={graph} graphName={graphName} />
      <IdeSyncBridge />
      <SourceSyncBridge />
    </ReactFlowProvider>
  );
}

/** Editor de un pipeline. La conexión con el IDE la abre el layout del dashboard. */
export function CanvasApp() {
  const graphName = useGraphName();
  const loaded = useProjectGraph(graphName);

  if (loaded.status === "loading") {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 bg-canvas text-sm text-ink-3">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Cargando grafo…
      </div>
    );
  }

  if (loaded.status === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-6 text-ink">
        <div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-4 shadow-md">
          <h1 className="text-sm font-semibold text-rose-700">No se pudo cargar el grafo</h1>
          <ul className="mt-3 space-y-1 font-mono text-xs text-ink-2">
            {loaded.errors.map((error, index) => (
              <li key={`${index}-${error}`} className="[overflow-wrap:anywhere]">
                {error}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return <ReadyCanvas key={graphName} graph={loaded.graph} graphName={graphName ?? ""} />;
}

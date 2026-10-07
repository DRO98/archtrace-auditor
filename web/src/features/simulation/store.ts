import { create } from "zustand";
import type { ExecutionFlowScenario } from "@core/simulation";
import { SimulationEngine, type EnginePhase } from "./lib/engine";
import { summarizePayload } from "./lib/payload";
import { resolveScenarioRoutes, type RouteHop, type RoutingEdge } from "./lib/route";
import { DEFAULT_TIMELINE_OPTIONS, buildTimeline } from "./lib/timeline";
import { derivePreview, deriveVisuals, type EdgeSimStatus, type NodeSimStatus } from "./lib/visuals";

export type SimStatus = "idle" | "playing" | "paused" | "finished";

/** Lo que la simulación necesita saber del lienzo actual: las aristas DIBUJADAS y los ids de nodo. */
export interface SimContext {
  edges: readonly RoutingEdge[];
  nodeIds: readonly string[];
}

interface ActiveRun {
  engine: SimulationEngine;
  scenario: ExecutionFlowScenario;
  routes: Array<RouteHop[] | null>;
  dispose: () => void;
}

interface SimState {
  scenarios: readonly ExecutionFlowScenario[];
  scenarioError: string | null;
  activeScenarioId: string | null;
  status: SimStatus;
  stepIndex: number;
  phase: EnginePhase;
  /** Resumen del dato que sale del paso actual: etiqueta fija junto a la primera arista activa. */
  packetLabel: string;
  packetEdgeId: string | null;
  nodeStatus: Readonly<Record<string, NodeSimStatus>>;
  edgeStatus: Readonly<Record<string, EdgeSimStatus>>;
  edgeReversed: Readonly<Record<string, true>>;
  /** Tarjeta bajo el cursor, mientras no hay simulación en marcha. */
  hoveredScenarioId: string | null;
  previewNodeStatus: Readonly<Record<string, NodeSimStatus>>;
  previewEdgeStatus: Readonly<Record<string, EdgeSimStatus>>;
  setScenarios: (scenarios: readonly ExecutionFlowScenario[], error?: string | null) => void;
  configure: (context: SimContext) => void;
  /** `null` quita el resaltado de previsualización. */
  hoverScenario: (scenarioId: string | null) => void;
  start: (scenarioId: string) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  seekStep: (index: number) => void;
}

// La simulación avanza solo con clics: cada acción salta al inicio de un paso y se queda en pausa.
// El motor no vive en el estado de React; zustand solo guarda lo que se pinta.
let context: SimContext = { edges: [], nodeIds: [] };
let run: ActiveRun | null = null;

const IDLE = {
  activeScenarioId: null,
  status: "idle",
  stepIndex: 0,
  phase: "process",
  packetLabel: "",
  packetEdgeId: null,
  nodeStatus: {},
  edgeStatus: {},
  edgeReversed: {},
} as const;

const PREVIEW_IDLE = {
  hoveredScenarioId: null,
  previewNodeStatus: {},
  previewEdgeStatus: {},
} as const;

function publish(): void {
  if (!run) return;
  const state = run.engine.getState();
  const visuals = deriveVisuals({
    scenario: run.scenario,
    routes: run.routes,
    edges: context.edges,
    nodeIds: context.nodeIds,
    state,
  });
  const leaving = run.scenario.steps[state.stepIndex];
  useSimStore.setState({
    status: state.status,
    stepIndex: state.stepIndex,
    phase: state.phase,
    packetLabel: leaving ? summarizePayload(leaving.mockPayload.output) : "",
    packetEdgeId: visuals.labelEdgeId,
    nodeStatus: visuals.nodeStatus,
    edgeStatus: visuals.edgeStatus,
    edgeReversed: visuals.edgeReversed,
  });
}

function disposeRun(): void {
  run?.dispose();
  run = null;
}

export const useSimStore = create<SimState>((set, get) => ({
  scenarios: [],
  scenarioError: null,
  ...IDLE,
  ...PREVIEW_IDLE,

  setScenarios: (scenarios, error = null) => {
    if (get().activeScenarioId && !scenarios.some((item) => item.id === get().activeScenarioId)) get().stop();
    set({ scenarios, scenarioError: error });
    const hovered = get().hoveredScenarioId;
    if (hovered) get().hoverScenario(scenarios.some((item) => item.id === hovered) ? hovered : null);
  },

  configure: (next) => {
    const changed = next.edges !== context.edges || next.nodeIds !== context.nodeIds;
    context = next;
    if (changed && run) get().stop();
    const hovered = get().hoveredScenarioId;
    if (changed && hovered && !get().activeScenarioId) get().hoverScenario(hovered);
  },

  hoverScenario: (scenarioId) => {
    if (scenarioId === null || get().activeScenarioId) {
      set({ ...PREVIEW_IDLE });
      return;
    }
    const scenario = get().scenarios.find((item) => item.id === scenarioId);
    if (!scenario) {
      set({ ...PREVIEW_IDLE });
      return;
    }
    const preview = derivePreview(scenario, context.edges, context.nodeIds);
    set({
      hoveredScenarioId: scenarioId,
      previewNodeStatus: preview.nodeStatus,
      previewEdgeStatus: preview.edgeStatus,
    });
  },

  start: (scenarioId) => {
    const scenario = get().scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return;
    disposeRun();

    const routes = resolveScenarioRoutes(scenario.steps, context.edges);
    const engine = new SimulationEngine(buildTimeline(scenario, routes, DEFAULT_TIMELINE_OPTIONS));
    run = { engine, scenario, routes, dispose: engine.subscribe(publish) };

    set({ activeScenarioId: scenarioId, ...PREVIEW_IDLE });
    // El motor nace en pausa en t = 0: se publica el paso 0 sin reproducir nada.
    publish();
  },

  stop: () => {
    disposeRun();
    set({ ...IDLE });
  },

  next: () => {
    if (!run) return;
    get().seekStep(run.engine.getState().stepIndex + 1);
  },
  prev: () => {
    if (!run) return;
    get().seekStep(Math.max(0, run.engine.getState().stepIndex - 1));
  },
  seekStep: (index) => run?.engine.seekStep(index),
}));

/** Escenario en marcha (referencia estable mientras no cambie). */
export function useActiveScenario(): ExecutionFlowScenario | null {
  return useSimStore((state) => state.scenarios.find((item) => item.id === state.activeScenarioId) ?? null);
}

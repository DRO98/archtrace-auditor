import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { ExecutionFlowScenario } from "@core/simulation";
import { SimulationEngine, type EngineFrame, type EnginePhase } from "./lib/engine";
import { summarizePayload } from "./lib/payload";
import { resolveScenarioRoutes, type RouteHop, type RoutingEdge } from "./lib/route";
import { DEFAULT_TIMELINE_OPTIONS, buildTimeline } from "./lib/timeline";
import { deriveVisuals, type EdgeSimStatus, type NodeSimStatus } from "./lib/visuals";

export type SimStatus = "idle" | "playing" | "paused" | "finished";
export const SPEEDS = [0.5, 1, 2, 4] as const;

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
  speed: number;
  totalMs: number;
  stepStarts: readonly number[];
  /** Resumen del dato que sale del paso actual: viaja en una etiqueta junto al paquete. */
  packetLabel: string;
  nodeStatus: Readonly<Record<string, NodeSimStatus>>;
  edgeStatus: Readonly<Record<string, EdgeSimStatus>>;
  syncIde: boolean;
  followCamera: boolean;
  setScenarios: (scenarios: readonly ExecutionFlowScenario[], error?: string | null) => void;
  configure: (context: SimContext) => void;
  start: (scenarioId: string) => void;
  stop: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekStep: (index: number) => void;
  seekTime: (ms: number) => void;
  setSpeed: (speed: number) => void;
  advance: (dtMs: number) => void;
  toggleSyncIde: () => void;
  toggleFollowCamera: () => void;
}

// El motor NO vive en el estado de React: cambia 60 veces por segundo.
// El estado de zustand solo se actualiza en los cambios de paso, fase o estado.
let context: SimContext = { edges: [], nodeIds: [] };
let run: ActiveRun | null = null;
const frameListeners = new Set<() => void>();

const IDLE = {
  activeScenarioId: null,
  status: "idle",
  stepIndex: 0,
  phase: "process",
  totalMs: 0,
  stepStarts: [],
  packetLabel: "",
  nodeStatus: {},
  edgeStatus: {},
} as const;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function notifyFrame(): void {
  for (const listener of frameListeners) listener();
}

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
    speed: state.speed,
    packetLabel: leaving ? summarizePayload(leaving.mockPayload.output) : "",
    nodeStatus: visuals.nodeStatus,
    edgeStatus: visuals.edgeStatus,
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
  speed: 1,
  syncIde: true,
  followCamera: true,

  setScenarios: (scenarios, error = null) => {
    if (get().activeScenarioId && !scenarios.some((item) => item.id === get().activeScenarioId)) get().stop();
    set({ scenarios, scenarioError: error });
  },

  configure: (next) => {
    const changed = next.edges !== context.edges || next.nodeIds !== context.nodeIds;
    context = next;
    if (changed && run) get().stop();
  },

  start: (scenarioId) => {
    const scenario = get().scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return;
    disposeRun();

    const routes = resolveScenarioRoutes(scenario.steps, context.edges);
    const options = prefersReducedMotion()
      ? { ...DEFAULT_TIMELINE_OPTIONS, travelMs: 0, jumpMs: 0 }
      : DEFAULT_TIMELINE_OPTIONS;
    const timeline = buildTimeline(scenario, routes, options);
    const engine = new SimulationEngine(timeline);
    const offBoundary = engine.subscribe(publish);
    const offFrame = engine.subscribeFrame(notifyFrame);
    run = {
      engine,
      scenario,
      routes,
      dispose: () => {
        offBoundary();
        offFrame();
      },
    };

    set({ activeScenarioId: scenarioId, totalMs: timeline.totalMs, stepStarts: timeline.stepStarts });
    engine.setSpeed(get().speed);
    engine.play();
  },

  stop: () => {
    disposeRun();
    set({ ...IDLE });
    notifyFrame();
  },

  play: () => run?.engine.play(),
  pause: () => run?.engine.pause(),
  toggle: () => run?.engine.toggle(),
  next: () => run?.engine.next(),
  prev: () => run?.engine.prev(),
  seekStep: (index) => run?.engine.seekStep(index),
  seekTime: (ms) => run?.engine.seekTime(ms),
  setSpeed: (speed) => {
    if (run) run.engine.setSpeed(speed);
    else set({ speed });
  },
  advance: (dtMs) => {
    run?.engine.advance(dtMs);
  },
  toggleSyncIde: () => set((state) => ({ syncIde: !state.syncIde })),
  toggleFollowCamera: () => set((state) => ({ followCamera: !state.followCamera })),
}));

/** Escenario en marcha (referencia estable mientras no cambie). */
export function useActiveScenario(): ExecutionFlowScenario | null {
  return useSimStore((state) => state.scenarios.find((item) => item.id === state.activeScenarioId) ?? null);
}

// ── Reloj y paquete: se leen en cada fotograma sin pasar por React ─────────────

export function subscribeSimFrame(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

export function getSimFrame(): EngineFrame {
  return run?.engine.getFrame() ?? { edgeId: null, reversed: false, progress: 0 };
}

function getSimElapsed(): number {
  return Math.round((run?.engine.getState().t ?? 0) / 50) * 50;
}

/** Milisegundos transcurridos (a 1x), redondeados a 50 para no repintar de más. Solo la barra de reproducción lo usa. */
export function useSimElapsed(): number {
  return useSyncExternalStore(subscribeSimFrame, getSimElapsed, () => 0);
}

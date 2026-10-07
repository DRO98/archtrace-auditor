import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFlowScenario, FlowStep } from "@core/simulation";
import { SimulationEngine } from "./engine";
import type { RouteHop } from "./route";
import { DEFAULT_TIMELINE_OPTIONS, buildTimeline, locate } from "./timeline";

function step(index: number, nodeId: string, durationMs?: number): FlowStep {
  const built: FlowStep = {
    stepIndex: index,
    nodeId,
    title: `Paso ${index}`,
    description: "d",
    fileReference: { path: `${nodeId}.py`, lineStart: 1, lineEnd: 2, functionName: "f" },
    mockPayload: { input: "i", output: "o" },
  };
  if (durationMs !== undefined) built.durationMs = durationMs;
  return built;
}

// 3 pasos: A →(1 salto)→ B →(2 saltos)→ C.  A=1000, B=2000 (por defecto), C=1000
const SCENARIO: ExecutionFlowScenario = {
  id: "s",
  name: "s",
  description: "s",
  entryNodeId: "A",
  steps: [step(0, "A", 1000), step(1, "B"), step(2, "C", 1000)],
};
const ROUTES: Array<RouteHop[] | null> = [
  [{ edgeId: "ab", reversed: false }],
  [
    { edgeId: "bh", reversed: true },
    { edgeId: "hc", reversed: false },
  ],
];

function timeline() {
  return buildTimeline(SCENARIO, ROUTES);
}

test("timeline: pasos + viajes a 1x", () => {
  const t = timeline();
  // 1000 + 700 + 2000 + 700 + 700 + 1000
  assert.equal(t.totalMs, 6100);
  assert.deepEqual(t.stepStarts, [0, 1700, 5100]);
  assert.deepEqual(
    t.segments.map((segment) => segment.kind),
    ["process", "travel", "process", "travel", "travel", "process"],
  );
});

test("timeline: sin ruta = salto; mismo nodo = nada; travelMs 0 = sin viajes", () => {
  const jump = buildTimeline(SCENARIO, [null, []], DEFAULT_TIMELINE_OPTIONS);
  assert.deepEqual(
    jump.segments.map((segment) => segment.kind),
    ["process", "jump", "process", "process"],
  );
  const still = buildTimeline(SCENARIO, ROUTES, { ...DEFAULT_TIMELINE_OPTIONS, travelMs: 0, jumpMs: 0 });
  assert.equal(still.totalMs, 4000);
  assert.deepEqual(still.stepStarts, [0, 1000, 3000]);
});

test("locate: límites y progreso", () => {
  const t = timeline();
  assert.deepEqual(locate(t, 0), { segmentIndex: 0, progress: 0 });
  assert.deepEqual(locate(t, 500), { segmentIndex: 0, progress: 0.5 });
  assert.equal(locate(t, 1000).segmentIndex, 1); // empieza el viaje
  assert.equal(locate(t, 1350).progress, 0.5);
  assert.deepEqual(locate(t, t.totalMs), { segmentIndex: 5, progress: 1 });
  assert.deepEqual(locate(buildTimeline({ ...SCENARIO, steps: [] }, []), 5), { segmentIndex: -1, progress: 0 });
});

test("advance: recorre pasos, viajes y termina", () => {
  const engine = new SimulationEngine(timeline());
  assert.equal(engine.getState().status, "paused");
  engine.play();

  engine.advance(250);
  engine.advance(250);
  engine.advance(250);
  engine.advance(250); // t = 1000: entra en el viaje A→B
  let state = engine.getState();
  assert.equal(state.phase, "travel");
  assert.equal(state.stepIndex, 0);
  assert.deepEqual(engine.getFrame(), { edgeId: "ab", reversed: false, progress: 0 });

  engine.advance(175); // mitad del viaje
  assert.equal(engine.getFrame().progress, 0.25);
  engine.advance(175);
  assert.equal(engine.getFrame().progress, 0.5);

  for (let index = 0; index < 100; index += 1) engine.advance(100);
  state = engine.getState();
  assert.equal(state.status, "finished");
  assert.equal(state.stepIndex, 2);
  assert.equal(state.phase, "process");
  assert.equal(state.t, 6100);
});

test("advance devuelve true solo al cambiar de paso, fase o estado", () => {
  const engine = new SimulationEngine(timeline());
  engine.play();
  assert.equal(engine.advance(100), false);
  assert.equal(engine.advance(100), false);
  assert.equal(engine.advance(250), false);
  let changed = false;
  for (let index = 0; index < 10 && !changed; index += 1) changed = engine.advance(100);
  assert.equal(changed, true); // cruzó t = 1000
});

test("velocidad escala el tiempo y dt se acota", () => {
  const engine = new SimulationEngine(timeline());
  engine.setSpeed(2);
  engine.play();
  engine.advance(100);
  assert.equal(engine.getState().t, 200);
  engine.advance(60_000); // pestaña dormida: se acota a 250 ms reales
  assert.equal(engine.getState().t, 200 + 500);
});

test("pausa y reanudar", () => {
  const engine = new SimulationEngine(timeline());
  engine.play();
  engine.advance(200);
  engine.pause();
  assert.equal(engine.advance(200), false);
  assert.equal(engine.getState().t, 200);
  engine.toggle();
  assert.equal(engine.getState().status, "playing");
});

test("next: anima el viaje y se detiene al inicio del paso siguiente", () => {
  const engine = new SimulationEngine(timeline());
  engine.next();
  assert.equal(engine.getState().status, "playing");
  for (let index = 0; index < 100; index += 1) engine.advance(100);
  const state = engine.getState();
  assert.equal(state.status, "paused");
  assert.equal(state.t, 1700);
  assert.equal(state.stepIndex, 1);
  assert.equal(state.phase, "process");
});

test("next en el último paso termina", () => {
  const engine = new SimulationEngine(timeline());
  engine.seekStep(2);
  engine.next();
  assert.equal(engine.getState().status, "finished");
  engine.next(); // no hace nada
  assert.equal(engine.getState().status, "finished");
});

test("prev: reinicia el paso si lleva tiempo; si no, va al anterior", () => {
  const engine = new SimulationEngine(timeline());
  engine.seekStep(1);
  engine.seekTime(1700 + 1000); // 1 s dentro del paso 1
  engine.prev();
  assert.equal(engine.getState().t, 1700);
  engine.prev();
  assert.equal(engine.getState().t, 0);
  engine.prev(); // en el primero se queda
  assert.equal(engine.getState().t, 0);
  assert.equal(engine.getState().status, "paused");
});

test("seekStep y seekTime", () => {
  const engine = new SimulationEngine(timeline());
  engine.seekStep(2);
  assert.equal(engine.getState().stepIndex, 2);
  assert.equal(engine.getState().status, "paused");
  engine.seekTime(999_999);
  assert.equal(engine.getState().status, "finished");
  engine.seekTime(10);
  assert.equal(engine.getState().status, "paused");
  engine.seekStep(99); // fuera de rango: sin efecto
  assert.equal(engine.getState().t, 10);
});

test("play tras terminar reinicia desde cero", () => {
  const engine = new SimulationEngine(timeline());
  engine.seekTime(6100);
  engine.play();
  assert.equal(engine.getState().t, 0);
  assert.equal(engine.getState().status, "playing");
});

test("subscribe se avisa de cambios de estado; subscribeFrame de cada fotograma", () => {
  const engine = new SimulationEngine(timeline());
  let boundary = 0;
  let frames = 0;
  engine.subscribe(() => (boundary += 1));
  engine.subscribeFrame(() => (frames += 1));
  engine.play();
  const boundaryAfterPlay = boundary;
  engine.advance(50);
  engine.advance(50);
  assert.equal(boundary, boundaryAfterPlay); // no hubo cambio de paso
  assert.ok(frames >= 2);
});

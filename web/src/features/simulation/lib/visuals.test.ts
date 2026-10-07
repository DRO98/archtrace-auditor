import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionFlowScenario, FlowStep } from "@core/simulation";
import type { RouteHop, RoutingEdge } from "./route";
import { derivePreview, deriveVisuals } from "./visuals";
import { resolveScenarioRoutes } from "./route";

function step(index: number, nodeId: string): FlowStep {
  return {
    stepIndex: index,
    nodeId,
    title: `Paso ${index}`,
    description: "d",
    fileReference: { path: `${nodeId}.py`, lineStart: 1, lineEnd: 2, functionName: "f" },
    mockPayload: { input: "i", output: "o" },
  };
}

// grafo: A → B → C ; H (hub) solo para el viaje de B a C ; Z ajeno al escenario
const EDGES: RoutingEdge[] = [
  { id: "ab", source: "A", target: "B" },
  { id: "bh", source: "H", target: "B" },
  { id: "hc", source: "H", target: "C" },
  { id: "zz", source: "Z", target: "A" },
];
const NODES = ["A", "B", "C", "H", "Z"];
const SCENARIO: ExecutionFlowScenario = {
  id: "s",
  name: "s",
  description: "s",
  entryNodeId: "A",
  steps: [step(0, "A"), step(1, "B"), step(2, "C")],
};
const ROUTES: Array<RouteHop[] | null> = [
  [{ edgeId: "ab", reversed: false }],
  [
    { edgeId: "bh", reversed: true },
    { edgeId: "hc", reversed: false },
  ],
];

function visuals(stepIndex: number, phase: "process" | "travel" | "jump", hopIndex = 0) {
  return deriveVisuals({
    scenario: SCENARIO,
    routes: ROUTES,
    edges: EDGES,
    nodeIds: NODES,
    state: { stepIndex, phase, hopIndex },
  });
}

test("inicio: solo el primer nodo activo; participantes pendientes; ajenos apagados; sale el dato por ab", () => {
  const { nodeStatus, edgeStatus, labelEdgeId } = visuals(0, "process");
  assert.deepEqual(nodeStatus, { A: "active", B: "upcoming", C: "upcoming", H: "upcoming", Z: "off" });
  assert.deepEqual(edgeStatus, { zz: "off", ab: "active" });
  assert.equal(labelEdgeId, "ab");
});

test("viaje de A a B: A hecho, arista ab activa", () => {
  const { nodeStatus, edgeStatus } = visuals(0, "travel", 0);
  assert.equal(nodeStatus.A, "done");
  assert.equal(nodeStatus.B, "upcoming");
  assert.equal(edgeStatus.ab, "active");
});

test("paso 1 en curso: A hecho, B activo, arista ab hecha, ruta de salida activa con su sentido", () => {
  const { nodeStatus, edgeStatus, edgeReversed, labelEdgeId } = visuals(1, "process");
  assert.equal(nodeStatus.A, "done");
  assert.equal(nodeStatus.B, "active");
  assert.equal(edgeStatus.ab, "done");
  assert.equal(edgeStatus.bh, "active");
  assert.equal(edgeStatus.hc, "active");
  assert.deepEqual(edgeReversed, { bh: true });
  assert.equal(labelEdgeId, "bh");
});

test("viaje de B a C en su 2.º salto: primer salto hecho, segundo activo", () => {
  const { nodeStatus, edgeStatus } = visuals(1, "travel", 1);
  assert.equal(nodeStatus.B, "done");
  assert.equal(nodeStatus.H, "upcoming");
  assert.equal(edgeStatus.bh, "done");
  assert.equal(edgeStatus.hc, "active");
});

test("final: todo hecho salvo el último nodo, que sigue activo", () => {
  const { nodeStatus, edgeStatus } = visuals(2, "process");
  assert.deepEqual([nodeStatus.A, nodeStatus.B, nodeStatus.C], ["done", "done", "active"]);
  assert.equal(edgeStatus.hc, "done");
  assert.equal(edgeStatus.zz, "off");
});

test("un nodo que vuelve a intervenir se ve activo, no hecho", () => {
  const loop: ExecutionFlowScenario = { ...SCENARIO, steps: [step(0, "A"), step(1, "B"), step(2, "A")] };
  const { nodeStatus } = deriveVisuals({
    scenario: loop,
    routes: [ROUTES[0] ?? null, [{ edgeId: "ab", reversed: true }]],
    edges: EDGES,
    nodeIds: NODES,
    state: { stepIndex: 2, phase: "process", hopIndex: 0 },
  });
  assert.equal(nodeStatus.A, "active");
  assert.equal(nodeStatus.B, "done");
});

test("salto sin ruta: el nodo de origen queda hecho y ninguna arista activa", () => {
  const { nodeStatus, edgeStatus } = deriveVisuals({
    scenario: SCENARIO,
    routes: [null, null],
    edges: EDGES,
    nodeIds: NODES,
    state: { stepIndex: 0, phase: "jump", hopIndex: 0 },
  });
  assert.equal(nodeStatus.A, "done");
  assert.ok(!Object.values(edgeStatus).includes("active"));
});

test("la previsualización ilumina el recorrido y apaga el resto", () => {
  const routes = resolveScenarioRoutes(SCENARIO.steps, EDGES);
  assert.deepEqual(routes[0], [{ edgeId: "ab", reversed: false }]);
  const { nodeStatus, edgeStatus } = derivePreview(SCENARIO, EDGES, NODES);
  assert.equal(nodeStatus.A, "preview");
  assert.equal(nodeStatus.B, "preview");
  assert.equal(nodeStatus.C, "preview");
  assert.equal(nodeStatus.H, "preview");
  assert.equal(nodeStatus.Z, "off");
  assert.equal(edgeStatus.ab, "preview");
  assert.equal(edgeStatus.bh, "preview");
  assert.equal(edgeStatus.hc, "preview");
  assert.equal(edgeStatus.zz, "off");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { beforeEach } from "node:test";
import { parseCodeGraph } from "../canvas/lib/graph";
import { drawnGraph } from "./lib/drawnEdges";
import { getSimFrame, useSimStore } from "./store";
import { parseScenarioFile } from "./lib/scenario";

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), relative), "utf8")) as unknown;
}

const parsedGraph = parseCodeGraph(readJson("public/graphs/macro_rag_project.json"));
if (!parsedGraph.ok) throw new Error(parsedGraph.errors.join("\n"));
// Contra lo que realmente se dibuja: módulos visibles (sin los aislados) y aristas de layeredFlow.
const drawn = drawnGraph(parsedGraph.graph);
const parsedScenarios = parseScenarioFile(readJson("public/scenarios/macro_rag_project.json"), drawn.graph, drawn.edges);
if (!parsedScenarios.ok) throw new Error(parsedScenarios.errors.join("\n"));
const scenarios = parsedScenarios.file.scenarios;
const nodeIds = drawn.graph.modules.map((item) => item.id);
const flow = { edges: drawn.edges };

const INGEST = "ingest-document";
const ROUTES = "src/api/routes.py";
const PIPELINE = "src/rag/pipeline.py";
const CHUNKER = "src/rag/chunker.py";

function sim() {
  return useSimStore.getState();
}

function run(ms: number, stepMs = 50): void {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) sim().advance(stepMs);
}

beforeEach(() => {
  sim().stop();
  sim().setScenarios(scenarios, null);
  sim().configure({ edges: flow.edges, nodeIds });
  useSimStore.setState({ speed: 1 });
});

test("estado inicial: sin simulación, sin estados en nodos ni aristas", () => {
  assert.equal(sim().status, "idle");
  assert.equal(sim().activeScenarioId, null);
  assert.deepEqual(sim().nodeStatus, {});
  assert.deepEqual(sim().edgeStatus, {});
});

test("start: reproduce desde el primer paso y marca el nodo activo", () => {
  sim().start(INGEST);
  assert.equal(sim().status, "playing");
  assert.equal(sim().stepIndex, 0);
  assert.equal(sim().phase, "process");
  assert.equal(sim().totalMs, 14200);
  assert.equal(sim().nodeStatus[ROUTES], "active");
  assert.equal(sim().nodeStatus[PIPELINE], "upcoming");
  assert.equal(sim().nodeStatus["src/bootstrap/app.py"], "off"); // no participa en este escenario
});

test("avanza: viaje por la arista routes→pipeline con paquete y etiqueta", () => {
  sim().start(INGEST);
  run(2000); // fin del paso 0
  run(350); // mitad del primer viaje
  assert.equal(sim().phase, "travel");
  assert.equal(sim().nodeStatus[ROUTES], "done");
  const frame = getSimFrame();
  assert.equal(frame.edgeId, `imports:${ROUTES}:${PIPELINE}`);
  assert.equal(frame.reversed, false);
  assert.ok(frame.progress > 0.3 && frame.progress < 0.7);
  assert.equal(sim().edgeStatus[`imports:${ROUTES}:${PIPELINE}`], "active");
  assert.equal(sim().packetLabel, "{document_id, body}");
});

test("chunker → embedder pasa por el pipeline (2 saltos); el segundo va contra la flecha dibujada", () => {
  sim().start(INGEST);
  sim().seekStep(2);
  sim().play();
  run(2000 + 100);
  assert.equal(sim().phase, "travel");
  // chunker → pipeline: la arista se dibuja chunker → pipeline, así que va a favor
  const first = getSimFrame();
  assert.equal(first.edgeId, `imports:${PIPELINE}:${CHUNKER}`);
  assert.equal(first.reversed, false);
  run(700);
  // pipeline → embedder: la arista se dibuja embeddings → pipeline, así que va en contra
  const second = getSimFrame();
  assert.equal(second.edgeId, `imports:${PIPELINE}:src/rag/embeddings.py`);
  assert.equal(second.reversed, true);
});

test("termina, deja el último nodo activo y permite repetir", () => {
  sim().start(INGEST);
  run(15000);
  assert.equal(sim().status, "finished");
  assert.equal(sim().nodeStatus["src/rag/vector_store.py"], "active");
  assert.equal(sim().nodeStatus[ROUTES], "done");
  sim().toggle();
  assert.equal(sim().status, "playing");
  assert.equal(sim().stepIndex, 0);
});

test("next se detiene al inicio del paso siguiente; prev reinicia o retrocede", () => {
  sim().start(INGEST);
  sim().pause();
  sim().next();
  run(4000);
  assert.equal(sim().status, "paused");
  assert.equal(sim().stepIndex, 1);
  assert.equal(sim().phase, "process");
  sim().prev(); // acaba de llegar al paso 1: vuelve al 0
  assert.equal(sim().stepIndex, 0);
  assert.equal(sim().status, "paused");
});

test("la velocidad se conserva al detener y volver a empezar", () => {
  sim().setSpeed(2);
  sim().start(INGEST);
  assert.equal(sim().speed, 2);
  sim().stop();
  assert.equal(sim().speed, 2);
  sim().start(INGEST);
  assert.equal(sim().speed, 2);
  run(1000);
  assert.equal(sim().status, "playing");
});

test("stop limpia el estado y el paquete", () => {
  sim().start(INGEST);
  run(2500);
  sim().stop();
  assert.equal(sim().status, "idle");
  assert.deepEqual(sim().nodeStatus, {});
  assert.equal(getSimFrame().edgeId, null);
});

test("cambiar el grafo dibujado o quitar el escenario activo detiene la simulación", () => {
  sim().start(INGEST);
  sim().configure({ edges: [...flow.edges], nodeIds });
  assert.equal(sim().status, "idle");

  sim().start(INGEST);
  sim().setScenarios([], null);
  assert.equal(sim().status, "idle");
});

test("un escenario desconocido no arranca nada", () => {
  sim().start("no-existe");
  assert.equal(sim().status, "idle");
});

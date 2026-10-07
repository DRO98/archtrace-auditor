import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCodeGraph } from "../../canvas/lib/graph";
import { drawnGraph } from "./drawnEdges";
import { resolveScenarioRoutes } from "./route";
import { parseScenarioFile, readStepMetrics } from "./scenario";
import { buildTimeline } from "./timeline";

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), relative), "utf8")) as unknown;
}

const parsedGraph = parseCodeGraph(readJson("public/graphs/macro_rag_project.json"));
if (!parsedGraph.ok) throw new Error(parsedGraph.errors.join("\n"));
// Todo se valida contra lo que REALMENTE se dibuja (lienzo por capas): módulos visibles y aristas orientadas.
const { graph, edges: drawn } = drawnGraph(parsedGraph.graph);
const base = readJson("public/scenarios/macro_rag_project.json");

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
}

interface MutableStep {
  [key: string]: unknown;
  fileReference: { [key: string]: unknown };
}
interface MutableScenario {
  [key: string]: unknown;
  steps: MutableStep[];
}

function firstScenario(file: Record<string, unknown>): MutableScenario {
  const scenarios = file.scenarios as MutableScenario[];
  const first = scenarios[0];
  if (!first) throw new Error("sin escenarios");
  return first;
}

function errorsOf(file: unknown): string[] {
  const result = parseScenarioFile(file, graph, drawn);
  return result.ok ? [] : result.errors;
}

test("el archivo generado es válido y trae los 2 escenarios del sandbox", () => {
  const result = parseScenarioFile(base, graph, drawn);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.file.scenarios.map((scenario) => scenario.id),
    ["ingest-document", "answer-question"],
  );
  assert.deepEqual(
    result.file.scenarios.map((scenario) => scenario.steps.length),
    [5, 7],
  );
});

test("los rangos de los pasos coinciden con el código real", () => {
  const result = parseScenarioFile(base, graph, drawn);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const answer = result.file.scenarios.find((scenario) => scenario.id === "answer-question");
  assert.ok(answer);
  const ranges = answer.steps.map((item) => [
    item.fileReference.functionName,
    item.fileReference.lineStart,
    item.fileReference.lineEnd,
  ]);
  assert.deepEqual(ranges, [
    ["ask_question", 38, 51],
    ["RagPipeline.retrieve", 34, 38],
    ["Embedder.embed", 28, 44],
    ["VectorStore.search", 56, 68],
    ["RagPipeline.answer", 40, 43],
    ["LlmService.complete", 18, 26],
    ["stream_tokens", 29, 40],
  ]);
});

test("todas las transiciones tienen camino sobre las aristas dibujadas", () => {
  const result = parseScenarioFile(base, graph, drawn);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  for (const scenario of result.file.scenarios) {
    const routes = resolveScenarioRoutes(scenario.steps, drawn);
    assert.equal(routes.includes(null), false, scenario.id);
  }
});

test("duración total a 1x: 14200 ms (guardar) y 18200 ms (responder)", () => {
  const result = parseScenarioFile(base, graph, drawn);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const totals = result.file.scenarios.map((scenario) =>
    buildTimeline(scenario, resolveScenarioRoutes(scenario.steps, drawn)).totalMs,
  );
  assert.deepEqual(totals, [14200, 18200]);
});

test("rutas de varios saltos y en sentido contrario (aristas tal como se dibujan)", () => {
  const result = parseScenarioFile(base, graph, drawn);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const answer = result.file.scenarios.find((scenario) => scenario.id === "answer-question");
  const ingest = result.file.scenarios.find((scenario) => scenario.id === "ingest-document");
  assert.ok(answer && ingest);

  // Embedder → Vector Store no tienen arista directa: 2 saltos
  assert.equal(resolveScenarioRoutes(answer.steps, drawn)[2]?.length, 2);

  // En el lienzo de 3 niveles el orquestador (columna 1) queda a la izquierda de los servicios
  // (columna 2): "pipeline → embedder" viaja a favor de su flecha y "vector store → pipeline" en contra.
  const answerRoutes = resolveScenarioRoutes(answer.steps, drawn);
  assert.deepEqual(answerRoutes[1], [{ edgeId: "imports:src/rag/pipeline.py:src/rag/embeddings.py", reversed: false }]);
  assert.deepEqual(answerRoutes[3], [{ edgeId: "imports:src/rag/pipeline.py:src/rag/vector_store.py", reversed: true }]);

  // pipeline → chunker: la arista se dibuja pipeline → chunker, a favor de su flecha
  assert.deepEqual(resolveScenarioRoutes(ingest.steps, drawn)[1], [
    { edgeId: "imports:src/rag/pipeline.py:src/rag/chunker.py", reversed: false },
  ]);
});

test("las aristas de apoyo ya no se usan: Embedder y Vector Store son tarjetas en el lienzo por capas", () => {
  const supportIds = drawn.filter((edge) => edge.id.startsWith("support:")).map((edge) => edge.id);
  assert.deepEqual(supportIds, ["support:src/llm/service.py:src/llm/prompts.py"]);
  assert.ok(!JSON.stringify(base).includes("support:"));
});

test("rechaza: nodo inexistente", () => {
  const file = clone();
  firstScenario(file).steps[1]!.nodeId = "src/no/existe.py";
  assert.ok(errorsOf(file).some((message) => message.includes("nodeId inexistente")));
});

test("rechaza: rango que no coincide con el código", () => {
  const file = clone();
  firstScenario(file).steps[0]!.fileReference.lineEnd = 99;
  assert.ok(errorsOf(file).some((message) => message.includes("≠")));
});

test("rechaza: función que no existe en el módulo", () => {
  const file = clone();
  firstScenario(file).steps[0]!.fileReference.functionName = "no_existe";
  assert.ok(errorsOf(file).some((message) => message.includes("no existe en")));
});

test("rechaza: path distinto al archivo del nodo", () => {
  const file = clone();
  firstScenario(file).steps[0]!.fileReference.path = "src/otro.py";
  assert.ok(errorsOf(file).some((message) => message.includes("no es el archivo del nodo")));
});

test("rechaza: stepIndex fuera de orden", () => {
  const file = clone();
  firstScenario(file).steps[2]!.stepIndex = 7;
  assert.ok(errorsOf(file).some((message) => message.includes("stepIndex debe ser 2")));
});

test("rechaza: entryNodeId distinto del primer nodo", () => {
  const file = clone();
  firstScenario(file).entryNodeId = "src/rag/pipeline.py";
  assert.ok(errorsOf(file).some((message) => message.includes("entryNodeId")));
});

test("rechaza: edgeIdToNext que no existe, que no conecta o en el último paso", () => {
  const missing = clone();
  firstScenario(missing).steps[0]!.edgeIdToNext = "imports:nada";
  assert.ok(errorsOf(missing).some((message) => message.includes("no es una arista dibujada")));

  const wrong = clone();
  firstScenario(wrong).steps[0]!.edgeIdToNext = "imports:src/rag/pipeline.py:src/rag/chunker.py";
  assert.ok(errorsOf(wrong).some((message) => message.includes("no conecta")));

  const last = clone();
  const steps = firstScenario(last).steps;
  steps[steps.length - 1]!.edgeIdToNext = "imports:src/rag/pipeline.py:src/rag/chunker.py";
  assert.ok(errorsOf(last).some((message) => message.includes("último paso")));
});

test("rechaza: durationMs fuera de rango, payload inválido y versión", () => {
  const slow = clone();
  firstScenario(slow).steps[0]!.durationMs = 10;
  assert.ok(errorsOf(slow).some((message) => message.includes("durationMs")));

  const payload = clone();
  firstScenario(payload).steps[0]!.mockPayload = { input: 3, output: "x" };
  assert.ok(errorsOf(payload).some((message) => message.includes("mockPayload")));

  const version = clone();
  version.version = 2;
  assert.ok(errorsOf(version).some((message) => message.includes("version")));
});

test("rechaza: ids duplicados y basura", () => {
  const dup = clone();
  const scenarios = dup.scenarios as MutableScenario[];
  const second = scenarios[1];
  if (second) second.id = "ingest-document";
  assert.ok(errorsOf(dup).some((message) => message.includes("duplicado")));
  assert.equal(parseScenarioFile(null, graph, drawn).ok, false);
  assert.equal(parseScenarioFile({ version: 1, graph: "x", scenarios: [] }, graph, drawn).ok, false);
});

test("metrics: se conservan si son válidas y son opcionales", () => {
  const result = parseScenarioFile(base, graph, drawn);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const first = result.file.scenarios[0]?.steps[0];
  assert.ok(first?.metrics);
  assert.equal(typeof first.metrics.latencyMs, "number");

  const without = clone();
  delete firstScenario(without).steps[0]!.metrics;
  const parsed = parseScenarioFile(without, graph, drawn);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.file.scenarios[0]?.steps[0]?.metrics, undefined);
});

test("metrics: el formato legado RAG se convierte a extensiones y el genérico se acepta", () => {
  assert.deepEqual(readStepMetrics({ latencyMs: 12, tokenCount: { prompt: 3, generation: 4 }, contextScore: 0.8 }), {
    latencyMs: 12,
    extensions: { promptTokens: 3, generationTokens: 4, contextScore: 0.8 },
  });
  assert.deepEqual(readStepMetrics({ latencyMs: 5, error: "timeout", extensions: { status: 504 } }), {
    latencyMs: 5,
    error: "timeout",
    extensions: { status: 504 },
  });
  assert.deepEqual(readStepMetrics({ latencyMs: 0 }), { latencyMs: 0 });
});

test("metrics: rechaza latencia negativa, tokens no enteros y contextScore fuera de [0, 1]", () => {
  const cases: unknown[] = [
    { latencyMs: -1, tokenCount: { prompt: 0, generation: 0 }, contextScore: 0.5 },
    { latencyMs: 10, tokenCount: { prompt: 1.5, generation: 0 }, contextScore: 0.5 },
    { latencyMs: 10, tokenCount: { prompt: 0, generation: -2 }, contextScore: 0.5 },
    { latencyMs: 10, tokenCount: { prompt: 0, generation: 0 }, contextScore: 1.2 },
    { latencyMs: 10, contextScore: 0.5 },
    { latencyMs: 10, extensions: { contextScore: 2 } },
    { latencyMs: 10, extensions: { promptTokens: -1 } },
    { latencyMs: 10, extensions: { lag: "alto" } },
    { latencyMs: 10, error: 42 },
    "rápido",
  ];
  for (const metrics of cases) {
    const file = clone();
    firstScenario(file).steps[0]!.metrics = metrics;
    assert.ok(
      errorsOf(file).some((message) => message.includes("metrics")),
      `debería rechazar ${JSON.stringify(metrics)}`,
    );
  }
});

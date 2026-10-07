import assert from "node:assert/strict";
import test from "node:test";
import type { PlaygroundSseEvent } from "@core/playground";
import { exportRunReport, formatCost } from "./exportRunReport";
import { entryInputs, resolveEntry } from "./entryPoint";
import { EMPTY_TRACE, applyTraceEvent, formatLatency, routeByNode, startTrace, type TraceVisuals } from "./traceState";

// api → pipeline → chunker / embedder, como en macro_rag_project.
const EDGES = [
  { id: "e:api:pipe", source: "api", target: "pipe" },
  { id: "e:pipe:chunk", source: "pipe", target: "chunk" },
  { id: "e:pipe:embed", source: "pipe", target: "embed" },
];

function run(events: PlaygroundSseEvent[], initial: TraceVisuals = EMPTY_TRACE): TraceVisuals {
  return events.reduce((state, event) => applyTraceEvent(state, event, EDGES), initial);
}

test("stage_start enciende el nodo y el camino desde la etapa anterior", () => {
  const state = run([
    { type: "stage_start", stage: "api", nodeId: "api" },
    { type: "stage_done", stage: "api", nodeId: "api", latencyMs: 2 },
    { type: "stage_start", stage: "chunker", nodeId: "chunk" },
  ]);
  assert.deepEqual(state.nodeStatus, { api: "done", pipe: "done", chunk: "active" });
  assert.deepEqual(state.edgeStatus, { "e:api:pipe": "active", "e:pipe:chunk": "active" });
  assert.equal(state.lastNodeId, "chunk");
});

test("la etapa siguiente apaga las aristas anteriores y suma latencias repetidas", () => {
  const state = run([
    { type: "stage_start", stage: "chunker", nodeId: "chunk" },
    { type: "stage_done", stage: "chunker", nodeId: "chunk", latencyMs: 1.5, detail: "3 fragmentos" },
    { type: "stage_start", stage: "embedder", nodeId: "embed" },
    { type: "stage_done", stage: "embedder", nodeId: "embed", latencyMs: 2 },
    { type: "stage_start", stage: "embedder", nodeId: "embed" },
    { type: "stage_done", stage: "embedder", nodeId: "embed", latencyMs: 3 },
    { type: "done" },
  ]);
  assert.deepEqual(state.edgeStatus, { "e:pipe:chunk": "done", "e:pipe:embed": "done" });
  assert.deepEqual(state.latencyByNode, { chunk: 1.5, embed: 5 });
  assert.deepEqual(
    state.stages.map((item) => [item.stage, item.status, item.latencyMs]),
    [
      ["chunker", "done", 1.5],
      ["embedder", "done", 2],
      ["embedder", "done", 3],
    ],
  );
  assert.equal(state.stages[0]?.detail, "3 fragmentos");
});

test("etapas sin nodo se registran sin tocar el lienzo", () => {
  const state = run([
    { type: "stage_start", stage: "llm", nodeId: null },
    { type: "stage_done", stage: "llm", nodeId: null, latencyMs: 40 },
  ]);
  assert.deepEqual(state.nodeStatus, {});
  assert.deepEqual(state.latencyByNode, {});
  assert.equal(state.stages[0]?.latencyMs, 40);
});

test("formatLatency y formatCost", () => {
  assert.equal(formatLatency(0.42), "0.4 ms");
  assert.equal(formatLatency(12.3), "12 ms");
  assert.equal(formatLatency(1830), "1.8 s");
  assert.equal(formatCost(null), "sin tarifa conocida");
  assert.equal(formatCost(0, "ollama"), "0 $ (local)");
  assert.equal(formatCost(0.0000215), "$0.000022");
  assert.equal(formatCost(0.0421), "$0.0421");
});

test("exportRunReport incluye pregunta, traza, fragmentos y coste", () => {
  const markdown = exportRunReport({
    question: "¿Qué es RAG?",
    documentName: null,
    answer: "Recuperación + generación [1].",
    chunks: [{ id: "doc:0", text: "RAG | combina", score: 0.8123 }],
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, estimated: true },
    costUsd: 0,
    provider: "ollama",
    model: "llama3",
    stages: [{ stage: "vector_store", nodeId: "src/rag/vector_store.py", status: "done", latencyMs: 0.3, detail: "top-1" }],
    finishedAt: "2026-09-26T10:00:00.000Z",
  });
  assert.match(markdown, /^# Informe de consulta RAG/);
  assert.match(markdown, /\*\*Documento:\*\* texto pegado/);
  assert.match(markdown, /\*\*Punto de entrada:\*\* Sistema Completo \(API Routes\)/);
  assert.match(markdown, /\| 1 \| Vector Store \| `src\/rag\/vector_store.py` \| 0.3 ms \| top-1 \|/);
  assert.match(markdown, /\*\*0.812\*\* · `doc:0`/);
  assert.match(markdown, /RAG \\\| combina/);
  assert.match(markdown, /Total: 120 \(estimado\)/);
  assert.match(markdown, /Coste estimado: 0 \$ \(local\)/);
});

test("entrada en una etapa: lo anterior se anota como preparación y el lienzo arranca en el nodo de entrada", () => {
  const state = run(
    [
      { type: "stage_start", stage: "api", nodeId: "api" },
      { type: "stage_done", stage: "api", nodeId: "api", latencyMs: 2 },
      { type: "edge_active", edgeId: "e:api:pipe" },
      { type: "stage_start", stage: "chunker", nodeId: "chunk" },
      { type: "stage_done", stage: "chunker", nodeId: "chunk", latencyMs: 1 },
      { type: "stage_start", stage: "embedder", nodeId: "embed" },
    ],
    startTrace({ nodeId: "chunk", stage: "chunker" }),
  );
  assert.equal(state.pendingEntryId, null);
  assert.deepEqual(state.nodeStatus, { chunk: "done", pipe: "done", embed: "active" });
  // Nada de api → pipe: esa arista era aguas arriba de la entrada.
  assert.deepEqual(state.edgeStatus, { "e:pipe:chunk": "active", "e:pipe:embed": "active" });
  assert.deepEqual(state.latencyByNode, { chunk: 1 });
  assert.deepEqual(
    state.stages.map((item) => [item.stage, item.upstream === true, item.latencyMs]),
    [
      ["api", true, 2],
      ["chunker", false, 1],
      ["embedder", false, undefined],
    ],
  );
});

test("entrada en un módulo fuera del pipeline: se enciende ya y la primera etapa sale de él", () => {
  const state = run([{ type: "stage_start", stage: "chunker", nodeId: "chunk" }], startTrace({ nodeId: "api", stage: null }));
  assert.deepEqual(state.nodeStatus, { api: "done", pipe: "done", chunk: "active" });
  assert.deepEqual(state.edgeStatus, { "e:api:pipe": "active", "e:pipe:chunk": "active" });
});

test("routeByNode agrupa por nodo en orden de primera visita y suma latencias", () => {
  const hops = routeByNode([
    { stage: "api", nodeId: "api", status: "done", latencyMs: 4, upstream: true },
    { stage: "embedder", nodeId: "embed", status: "done", latencyMs: 2 },
    { stage: "vector_store", nodeId: null, status: "done", latencyMs: 1 },
    { stage: "embedder", nodeId: "embed", status: "done", latencyMs: 3 },
  ]);
  assert.deepEqual(
    hops.map((hop) => [hop.key, hop.latencyMs, hop.upstream]),
    [
      ["api", 4, true],
      ["embed", 5, false],
      ["stage:vector_store", 1, false],
    ],
  );
});

test("resolveEntry usa el mismo mapeo etapa → nodo que el servidor", () => {
  const modules = [
    { id: "src/api/routes.py", label: "API Routes", filePath: "src/api/routes.py" },
    { id: "src/rag/chunker.py", label: "Chunker", filePath: "src/rag/chunker.py" },
    { id: "src/utils/log.py", label: "Logger", filePath: "src/utils/log.py" },
  ];
  assert.deepEqual(resolveEntry("src/rag/chunker.py", modules, null), { nodeId: "src/rag/chunker.py", label: "Chunker", stage: "chunker" });
  const logger = resolveEntry("src/utils/log.py", modules, null);
  assert.equal(logger.stage, null);
  assert.deepEqual(entryInputs(logger), ["question", "documentText"]);
  assert.deepEqual(entryInputs(null), ["question", "documentText"]);
  assert.deepEqual(entryInputs({ nodeId: "x", label: "LLM", stage: "llm" }), ["question", "context[top-k]"]);
});

test("applyTraceEvent marca la etapa en curso como error con el mensaje del proveedor", () => {
  const started = applyTraceEvent(EMPTY_TRACE, { type: "stage_start", stage: "llm", nodeId: null }, []);
  const failed = applyTraceEvent(started, { type: "error", message: "Sin saldo.", code: "quota" }, []);
  assert.equal(failed.stages[0]?.status, "error");
  assert.equal(failed.stages[0]?.detail, "Sin saldo.");
});

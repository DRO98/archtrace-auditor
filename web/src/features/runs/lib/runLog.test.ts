import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRuns, appendRun, buildRunRecord, computeQualityMetrics, filterRuns, latencyByNode, parseRuns, type RunInput } from "./runLog";

const chunks = [
  { id: "c1", text: "El chunker trocea el documento en fragmentos de 400 caracteres.", score: 0.82 },
  { id: "c2", text: "Los embeddings se guardan en el vector store en memoria.", score: 0.41 },
  { id: "c3", text: "Texto sin relación con la pregunta.", score: 0.05 },
];

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    graphName: "demo",
    finishedAt: "2026-09-27T10:00:00.000Z",
    question: "¿Cómo se trocea el documento?",
    answer: "El chunker trocea el documento en fragmentos [1] y los guarda en el vector store [2].",
    provider: "openai",
    model: "gpt-4o",
    demo: false,
    entryLabel: null,
    stages: [
      { stage: "chunker", label: "Chunker", nodeId: "chunker.ts", latencyMs: 12 },
      { stage: "embedder", label: "Embedder", nodeId: "embedder.ts", latencyMs: 30 },
      { stage: "llm", label: "LLM", nodeId: "llm.ts", latencyMs: 900 },
    ],
    usage: { promptTokens: 400, completionTokens: 60, totalTokens: 460 },
    costUsd: 0.002,
    chunks,
    ...overrides,
  };
}

test("computeQualityMetrics: relevancia, precisión, citas y groundedness", () => {
  const metrics = computeQualityMetrics(input().answer, chunks);
  assert.equal(metrics.topScore, 0.82);
  assert.equal(metrics.meanScore, 0.427);
  assert.equal(metrics.precisionAtK, 0.667);
  assert.equal(metrics.citationCoverage, 0.667);
  assert.ok(metrics.groundedness !== null && metrics.groundedness > 0.8);
});

test("computeQualityMetrics sin fragmentos devuelve null", () => {
  const metrics = computeQualityMetrics("respuesta", []);
  assert.deepEqual(Object.values(metrics), [null, null, null, null, null]);
});

test("buildRunRecord suma latencias y recorta textos", () => {
  const run = buildRunRecord(input({ chunks: [{ id: "x", text: "a".repeat(2000), score: 0.5 }] }), "id-1");
  assert.equal(run.totalLatencyMs, 942);
  assert.equal(run.chunks[0]?.text.length, 600);
  assert.equal(run.id, "id-1");
});

test("aggregateRuns: medias, p95 y coste solo de las que lo tienen", () => {
  const a = buildRunRecord(input(), "a");
  const b = buildRunRecord(input({ costUsd: null, stages: [{ stage: "llm", label: "LLM", nodeId: "llm.ts", latencyMs: 100 }] }), "b");
  const aggregate = aggregateRuns([a, b]);
  assert.equal(aggregate.count, 2);
  assert.equal(aggregate.avgLatencyMs, (942 + 100) / 2);
  assert.equal(aggregate.p95LatencyMs, 942);
  assert.equal(aggregate.avgCostUsd, 0.002);
  assert.equal(aggregate.totalTokens, 920);
  assert.deepEqual(aggregateRuns([]).avgLatencyMs, null);
});

test("latencyByNode promedia por nodo", () => {
  const runs = [buildRunRecord(input(), "a"), buildRunRecord(input({ stages: [{ stage: "llm", label: "LLM", nodeId: "llm.ts", latencyMs: 100 }] }), "b")];
  assert.equal(latencyByNode(runs).get("llm.ts")?.avgMs, 500);
});

test("appendRun respeta el tope y parseRuns descarta basura", () => {
  const runs = [1, 2, 3].map((n) => buildRunRecord(input(), `r${n}`));
  const capped = runs.reduce((list, run) => appendRun(list, run, 2), [] as ReturnType<typeof buildRunRecord>[]);
  assert.deepEqual(capped.map((run) => run.id), ["r3", "r2"]);
  const parsed = parseRuns(JSON.stringify([...capped, { version: 1, id: 5 }, "x"]));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parseRuns("no json"), []);
});

test("v1 (solo RAG) se lee como v2 con profile rag, latencyByNode y errorRate", () => {
  const legacy: Record<string, unknown> = { ...buildRunRecord(input(), "old"), version: 1 };
  delete legacy.profile;
  delete legacy.latencyByNode;
  delete legacy.errorRate;
  const [run] = parseRuns(JSON.stringify([legacy]));
  assert.ok(run);
  assert.equal(run.version, 2);
  assert.equal(run.profile, "rag");
  assert.deepEqual(run.latencyByNode, { "chunker.ts": 12, "embedder.ts": 30, "llm.ts": 900 });
  assert.equal(run.errorRate, 0);
  assert.ok(run.metrics);
});

test("run genérico (HTTP): sin métricas RAG, con errores por etapa y filtros", () => {
  const http = buildRunRecord(
    {
      profile: "http",
      graphName: "shop",
      finishedAt: "2026-09-27T11:00:00.000Z",
      question: '{"orderId":1}',
      answer: '{"ok":true}',
      provider: "simulado",
      model: "latencias simuladas",
      demo: false,
      entryLabel: "Orders API",
      stages: [
        { stage: "api.ts", label: "Orders API", nodeId: "api.ts", latencyMs: 12, status: "done" },
        { stage: "db.ts", label: "Orders DB", nodeId: "db.ts", latencyMs: 30, status: "error", detail: "timeout" },
      ],
      costUsd: null,
    },
    "h1",
  );
  assert.equal(http.metrics, null);
  assert.equal(http.errorRate, 0.5);
  assert.equal(http.stages[1]?.error, "timeout");
  assert.deepEqual(http.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [roundTrip] = parseRuns(JSON.stringify([http]));
  assert.equal(roundTrip?.profile, "http");
  assert.equal(roundTrip?.metrics, null);
  assert.equal(roundTrip?.stages[1]?.error, "timeout");

  const rag = buildRunRecord(input(), "r1");
  assert.deepEqual(filterRuns([http, rag], { profile: "http" }).map((run) => run.id), ["h1"]);
  assert.deepEqual(filterRuns([http, rag], { nodeId: "llm.ts" }).map((run) => run.id), ["r1"]);
  const aggregate = aggregateRuns([http, rag]);
  assert.equal(aggregate.avgErrorRate, 0.25);
  assert.ok(aggregate.avgRelevance !== null);
});

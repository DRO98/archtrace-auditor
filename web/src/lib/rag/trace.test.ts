import assert from "node:assert/strict";
import test from "node:test";
import type { PlaygroundModuleRef, PlaygroundSseEvent } from "@core/playground";
import { estimateCost } from "../ai/costEstimate";
import { AiError } from "../ai/types";
import { createSseParser, formatSseEvent } from "./sse";
import { resolveStageNode, resolveStageNodes } from "./stageNodes";
import { runRagTrace } from "./trace";

const RAG_MODULES: PlaygroundModuleRef[] = [
  { id: "src/api/routes.py", label: "API Routes", filePath: "src/api/routes.py" },
  { id: "src/bootstrap/app.py", label: "App Bootstrap", filePath: "src/bootstrap/app.py" },
  { id: "src/llm/prompts.py", label: "Prompts", filePath: "src/llm/prompts.py" },
  { id: "src/llm/service.py", label: "LLM Service", filePath: "src/llm/service.py" },
  { id: "src/rag/chunker.py", label: "Chunker", filePath: "src/rag/chunker.py" },
  { id: "src/rag/embeddings.py", label: "Embedder", filePath: "src/rag/embeddings.py" },
  { id: "src/rag/pipeline.py", label: "RAG Pipeline", filePath: "src/rag/pipeline.py" },
  { id: "src/rag/vector_store.py", label: "Vector Store", filePath: "src/rag/vector_store.py" },
];

test("resolveStageNode asigna cada etapa al módulo del grafo macro_rag_project", () => {
  assert.deepEqual(resolveStageNodes(RAG_MODULES), {
    api: "src/api/routes.py",
    chunker: "src/rag/chunker.py",
    embedder: "src/rag/embeddings.py",
    vector_store: "src/rag/vector_store.py",
    llm: "src/llm/service.py",
  });
});

test("resolveStageNode prioriza tokens y devuelve null sin coincidencias", () => {
  const modules = [
    { id: "a", label: "User Service", filePath: "src/user_service.ts" },
    { id: "b", label: "LLM", filePath: "src/ai/client.ts" },
  ];
  assert.equal(resolveStageNode("llm", modules), "b"); // "llm" gana a "service"
  assert.equal(resolveStageNode("chunker", modules), null);
  assert.equal(resolveStageNode("api", []), null);
});

test("createSseParser junta eventos partidos y descarta basura", () => {
  const parser = createSseParser();
  const wire = formatSseEvent({ type: "stage_start", stage: "chunker", nodeId: "x" }) + formatSseEvent({ type: "done" });
  const cut = 17;
  assert.deepEqual(parser.push(wire.slice(0, cut)), []);
  assert.deepEqual(parser.push(`${wire.slice(cut)}: comentario\n\ndata: {no json}\n\ndata: {"type":"raro"}\n\n`), [
    { type: "stage_start", stage: "chunker", nodeId: "x" },
    { type: "done" },
  ]);
  assert.deepEqual(parser.push('data: {"type":"error","message":"m"}'), []);
  assert.deepEqual(parser.flush(), [{ type: "error", message: "m" }]);
});

test("createSseParser acepta CRLF y rechaza eventos con campos inválidos", () => {
  const parser = createSseParser();
  const events = parser.push(
    'data: {"type":"stage_done","stage":"llm","nodeId":null,"latencyMs":5}\r\n\r\ndata: {"type":"stage_start","stage":"otro","nodeId":null}\r\n\r\n',
  );
  assert.deepEqual(events, [{ type: "stage_done", stage: "llm", nodeId: null, latencyMs: 5 }]);
});

test("estimateCost: tarifa conocida, Ollama gratis y modelo desconocido null", () => {
  const usage = { promptTokens: 1_000_000, completionTokens: 500_000, totalTokens: 1_500_000 };
  assert.ok(Math.abs((estimateCost("openai", "gpt-4o-mini", usage) ?? 0) - 0.45) < 1e-12);
  assert.equal(estimateCost("ollama", "llama3", usage), 0);
  assert.equal(estimateCost("groq", "modelo-inventado", usage), null);
});

function traceInput(overrides: Partial<Parameters<typeof runRagTrace>[0]> = {}) {
  const events: PlaygroundSseEvent[] = [];
  let clock = 0;
  const input: Parameters<typeof runRagTrace>[0] = {
    question: "¿Qué guarda el vector store?",
    documentText: "El vector store guarda embeddings. ".repeat(20),
    modules: RAG_MODULES,
    provider: "openai",
    model: "gpt-4o-mini",
    complete: async () => ({ text: "Guarda embeddings [1].", usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } }),
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    startedAt: 0,
    dwellMs: 0,
    now: () => (clock += 1),
    ...overrides,
  };
  return { input, events };
}

test("runRagTrace emite las etapas en orden, el resultado y done", async () => {
  const { input, events } = traceInput();
  await runRagTrace(input);
  const stages = events.filter((event) => event.type === "stage_start").map((event) => event.stage);
  assert.deepEqual(stages, ["api", "chunker", "embedder", "vector_store", "embedder", "vector_store", "llm"]);
  const starts = events.filter((event) => event.type === "stage_start");
  assert.equal(starts[1]?.nodeId, "src/rag/chunker.py");
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(result.answer, "Guarda embeddings [1].");
  assert.ok(result.chunks.length > 0 && result.chunks.length <= 4);
  assert.equal(result.costUsd, (100 * 0.15 + 10 * 0.6) / 1_000_000);
  assert.deepEqual(events.at(-1), { type: "done" });
  for (const event of events) if (event.type === "stage_done") assert.ok(event.latencyMs >= 0);
});

test("runRagTrace estima el uso si el proveedor no lo da", async () => {
  const { input, events } = traceInput({ provider: "ollama", model: "llama3", complete: async () => ({ text: "abcd" }) });
  await runRagTrace(input);
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(result.usage.estimated, true);
  assert.equal(result.usage.completionTokens, 1);
  assert.equal(result.costUsd, 0);
});

test("runRagTrace convierte un fallo del LLM en error + done", async () => {
  const { input, events } = traceInput({
    complete: async () => {
      throw new AiError("auth", "La clave no es válida.");
    },
  });
  await runRagTrace(input);
  assert.deepEqual(events.slice(-2), [{ type: "error", message: "La clave no es válida.", code: "auth" }, { type: "done" }]);
  assert.equal(events.some((event) => event.type === "result"), false);
});

test("runRagTrace rechaza documentos sin texto útil", async () => {
  const { input, events } = traceInput({ documentText: "   " });
  await runRagTrace(input);
  assert.deepEqual(events.slice(-2), [
    { type: "error", message: "El documento no tiene texto que indexar.", code: "bad_response" },
    { type: "done" },
  ]);
});

test("runRagTrace calla si el cliente cancela", async () => {
  const controller = new AbortController();
  const { input, events } = traceInput({
    signal: controller.signal,
    complete: async () => {
      controller.abort();
      throw new AiError("aborted", "La petición se canceló.");
    },
  });
  await runRagTrace(input);
  assert.equal(events.some((event) => event.type === "error" || event.type === "done"), false);
});

test("runRagTrace desglosa el coste (embedder local + LLM) con la tarifa manual", async () => {
  const { input, events } = traceInput({ price: { price: { input: 10, output: 20 }, source: "custom" } });
  await runRagTrace(input);
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  const [embedder, llm] = result.costBreakdown ?? [];
  assert.equal(embedder?.stage, "embedder");
  assert.equal(embedder?.costUsd, 0);
  assert.equal(embedder?.priceSource, "local");
  assert.ok((embedder?.promptTokens ?? 0) > 0);
  assert.equal(llm?.stage, "llm");
  assert.equal(llm?.priceSource, "custom");
  assert.equal(llm?.costUsd, (result.usage.promptTokens * 10 + result.usage.completionTokens * 20) / 1_000_000);
  assert.equal(result.costUsd, llm?.costUsd);
});

test("runRagTrace marca el error de cuota con su código", async () => {
  const { input, events } = traceInput({
    complete: async () => {
      throw new AiError("quota", "Tu clave de OpenAI se ha quedado sin saldo.");
    },
  });
  await runRagTrace(input);
  assert.deepEqual(events.at(-2), { type: "error", message: "Tu clave de OpenAI se ha quedado sin saldo.", code: "quota" });
});

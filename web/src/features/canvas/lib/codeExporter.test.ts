import assert from "node:assert/strict";
import test from "node:test";
import { buildCodeExportSpec, defaultCodeExportOptions, generatePython, generateTypeScript, runnableExportProfile, sanitizeOptions } from "./codeExporter";

const ragCanvas = {
  projectName: "Demo RAG",
  modules: [
    { id: "api", label: "API Routes", filePath: "src/api/routes.py" },
    { id: "chunker", label: "Chunker", filePath: "src/rag/chunker.py" },
    { id: "embed", label: "Embeddings", filePath: "src/rag/embeddings.py" },
    { id: "store", label: "Vector Store", filePath: "src/rag/vector_store.py" },
    { id: "llm", label: "LLM Service", filePath: "src/llm/service.py" },
    { id: "orphan", label: "Orphan", filePath: "src/other/tool.py" },
  ],
  edges: [
    { source: "api", target: "chunker" },
    { source: "chunker", target: "embed" },
    { source: "embed", target: "store" },
    { source: "store", target: "llm" },
  ],
};

test("lee etapas y conexiones del lienzo", () => {
  const spec = buildCodeExportSpec(ragCanvas, defaultCodeExportOptions("groq", "openai/gpt-oss-120b"));
  assert.equal(spec.retrieval, true);
  assert.deepEqual(
    spec.stages.map((item) => item.stage),
    ["api", "chunker", "embedder", "vector_store", "llm"],
  );
  assert.ok(spec.flow.includes("Chunker → Embedder"));
  assert.equal(spec.embedder, "hashing");
});

test("sin etapas de recuperación solo genera la llamada al LLM", () => {
  const spec = buildCodeExportSpec(
    { projectName: "Bot", modules: [{ id: "llm", label: "LLM", filePath: "llm.ts" }], edges: [] },
    defaultCodeExportOptions("anthropic", "claude-sonnet-5"),
  );
  assert.equal(spec.retrieval, false);
  const python = generatePython(spec);
  assert.match(python, /import anthropic/);
  assert.doesNotMatch(python, /chunk_text/);
});

test("incluye proveedor, chunker y embedder en ambos lenguajes", () => {
  const options = { ...defaultCodeExportOptions("openai", "gpt-4o-mini"), chunkSize: 500, chunkOverlap: 50, topK: 3 };
  const spec = buildCodeExportSpec(ragCanvas, options);
  const python = generatePython(spec);
  const ts = generateTypeScript(spec);
  for (const code of [python, ts]) {
    assert.match(code, /CHUNK_SIZE = 500/);
    assert.match(code, /CHUNK_OVERLAP = 50/);
    assert.match(code, /TOP_K = 3/);
    assert.match(code, /text-embedding-3-small/);
    assert.match(code, /gpt-4o-mini/);
    assert.doesNotMatch(code, /sk-/);
  }
  assert.match(ts, /baseURL|new OpenAI\(\{ apiKey: requiredEnv\("OPENAI_API_KEY"\) \}\)/);
});

test("corrige solapamientos imposibles", () => {
  const fixed = sanitizeOptions({ ...defaultCodeExportOptions("ollama", "llama3"), chunkSize: 100, chunkOverlap: 300, topK: 0 });
  assert.equal(fixed.chunkOverlap, 99);
  assert.equal(fixed.topK, 1);
});

test("runnableExportProfile: plantilla RAG solo en grafos de IA", () => {
  const makeModule = (id: string, filePath: string) => ({ id, label: id, filePath, groupId: "g", language: "python", subBlocks: [] });
  assert.equal(runnableExportProfile({ modules: [makeModule("llm", "src/llm/service.py")] }), "rag");
  assert.equal(runnableExportProfile({ modules: [makeModule("api", "src/api/orders.ts"), makeModule("db", "src/db/orders.ts")] }), null);
});

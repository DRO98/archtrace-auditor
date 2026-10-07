import assert from "node:assert/strict";
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { ProjectMap } from "@core/projectMap";
import { createParserHost } from "./parserHost.js";
import { buildProjectMap } from "./resolve.js";
import { scanDirectory } from "./nodeScan.js";

function wasmDir(): string {
  const dir = path.resolve("dist/wasm");
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.resolve("node_modules/web-tree-sitter/tree-sitter.wasm"), path.join(dir, "tree-sitter.wasm"));
  const grammars = path.resolve("node_modules/tree-sitter-wasms/out");
  for (const name of ["python", "javascript", "tsx"]) {
    copyFileSync(path.join(grammars, `tree-sitter-${name}.wasm`), path.join(dir, `tree-sitter-${name}.wasm`));
  }
  return dir;
}

describe("python workspace map", () => {
  it("parses sandbox python and resolves the expected calls", async () => {
    const map = await scanDirectory(path.resolve("..", "sandbox"), wasmDir(), {
      exclude: ["**/__pycache__/**"],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const file = (name: string) => {
      const found = map.files.find((item) => item.filePath === name);
      assert.ok(found, name);
      return found;
    };
    const symbol = (mapFile: ProjectMap["files"][number], qualified: string) => {
      const found = mapFile.symbols.find((item) => item.qualifiedName === qualified);
      assert.ok(found, qualified);
      return found;
    };
    const calls = (items: { target: string; line: number }[]) =>
      items.map((item) => `${item.target.split("::")[1]}@${item.line}`).join(",");

    const vector = file("src/rag/vector_store.py");
    assert.equal(vector.lineCount, 95);
    assert.deepEqual(symbol(vector, "VectorRecord").range, { startLine: 14, endLine: 21 });
    assert.deepEqual(symbol(vector, "VectorStore").range, { startLine: 24, endLine: 77 });
    const upsert = symbol(vector, "VectorStore.upsert");
    assert.deepEqual(upsert.range, { startLine: 33, endLine: 36 });
    assert.equal(calls(upsert.calls), "VectorStore._require_width@35");
    const addMany = symbol(vector, "VectorStore.add_many");
    assert.deepEqual(addMany.range, { startLine: 38, endLine: 44 });
    assert.equal(calls(addMany.calls), "VectorStore.upsert@42");
    const search = symbol(vector, "VectorStore.search");
    assert.deepEqual(search.range, { startLine: 56, endLine: 68 });
    assert.equal(calls(search.calls), "VectorStore._require_width@58,cosine_similarity@64");
    assert.equal(symbol(vector, "VectorStore.get").calls.length, 0);
    assert.equal(symbol(vector, "cosine_similarity").calls.length, 0);
    assert.match(search.doc ?? "", /closest records/);
    assert.match(symbol(vector, "VectorStore.__init__") ? "" : "", /^$/);

    const database = file("src/db/database.py");
    assert.equal(database.lineCount, 65);
    assert.deepEqual(symbol(database, "Note").range, { startLine: 11, endLine: 16 });
    const load = symbol(database, "Database.load");
    assert.deepEqual(load.range, { startLine: 26, endLine: 32 });
    assert.deepEqual(load.instantiations[0]?.range, { startLine: 32, endLine: 32 });
    assert.equal(symbol(database, "Database.get").calls.length, 0);

    const routes = file("src/api/routes.py");
    assert.equal(routes.lineCount, 51);
    const ingestDoc = symbol(routes, "ingest_document");
    assert.deepEqual(ingestDoc.range, { startLine: 27, endLine: 35 });
    assert.equal(calls(ingestDoc.calls), "_slug@31,RagPipeline.ingest@32");
    const ask = symbol(routes, "ask_question");
    assert.deepEqual(ask.range, { startLine: 38, endLine: 51 });
    assert.equal(calls(ask.calls), "RagPipeline.retrieve@44,RagPipeline.answer@49,LlmService.complete@50,stream_tokens@51");

    const service = file("src/llm/service.py");
    assert.equal(service.lineCount, 40);
    assert.equal(calls(symbol(service, "LlmService.complete").calls), "build_prompt@24");

    const app = file("src/bootstrap/app.py");
    assert.equal(app.lineCount, 30);
    const build = symbol(app, "build_pipeline");
    assert.deepEqual(build.range, { startLine: 13, endLine: 18 });
    assert.deepEqual(build.instantiations.map((item) => item.range.startLine), [15, 16, 17, 18]);
    const main = symbol(app, "main");
    assert.deepEqual(main.range, { startLine: 21, endLine: 26 });
    assert.equal(calls(main.calls), "build_pipeline@23,RagPipeline.ingest@24,RagPipeline.retrieve@25");
    assert.equal(calls(app.moduleScope.calls), "main@30");

    const pipeline = file("src/rag/pipeline.py");
    assert.equal(pipeline.lineCount, 43);
    const init = symbol(pipeline, "RagPipeline.__init__");
    assert.match(init.signature, /store: VectorStore/);
    assert.match(init.signature, /embedder: Embedder/);
    assert.match(init.signature, /service: LlmService/);
    const ingest = symbol(pipeline, "RagPipeline.ingest");
    assert.deepEqual(ingest.range, { startLine: 19, endLine: 32 });
    assert.equal(
      calls(ingest.calls),
      "chunk_text@22,Embedder.embed@23,VectorStore.upsert@30",
    );
    assert.equal(ingest.instantiations.length, 1);
    assert.equal(ingest.instantiations[0]?.target.endsWith("VectorRecord"), true);
    assert.deepEqual(ingest.instantiations[0]?.range, { startLine: 24, endLine: 29 });
    const retrieve = symbol(pipeline, "RagPipeline.retrieve");
    assert.deepEqual(retrieve.range, { startLine: 34, endLine: 38 });
    assert.equal(calls(retrieve.calls), "Embedder.embed@36,VectorStore.search@37");
    const answer = symbol(pipeline, "RagPipeline.answer");
    assert.deepEqual(answer.range, { startLine: 40, endLine: 43 });
    assert.equal(calls(answer.calls), "LlmService.complete@43");

    assert.equal(map.stats.skippedFiles, 0);
  });
});

void createParserHost;
void buildProjectMap;

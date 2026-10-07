import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CodeModule } from "@core/graph";
import { deriveSubtitle, humanizeLabel, inferRole } from "./architecture";
import { parseCodeGraph } from "./graph";

function moduleAt(filePath: string): CodeModule {
  return {
    id: filePath,
    label: filePath,
    filePath,
    groupId: "misc",
    language: "python",
    subBlocks: [],
  };
}

test("inferRole clasifica rutas conocidas", () => {
  const cases: ReadonlyArray<{ filePath: string; role: CodeModule["role"] }> = [
    { filePath: "src/api/routes.py", role: "api" },
    { filePath: "src/rag/pipeline.py", role: "pipeline" },
    { filePath: "src/rag/chunker.py", role: "transform" },
    { filePath: "src/rag/embeddings.py", role: "ai-model" },
    { filePath: "src/rag/vector_store.py", role: "database" },
    { filePath: "src/db/database.py", role: "database" },
    { filePath: "src/llm/service.py", role: "ai-model" },
    { filePath: "src/llm/prompts.py", role: "prompt" },
    { filePath: "src/bootstrap/app.py", role: "app" },
    { filePath: "src/misc/thing.py", role: "code" },
  ];
  for (const entry of cases) {
    assert.equal(inferRole(moduleAt(entry.filePath)), entry.role, entry.filePath);
  }
});

test("deriveSubtitle resume los métodos públicos del grafo sandbox", () => {
  const raw: unknown = JSON.parse(readFileSync("public/graphs/macro_rag_project.json", "utf8"));
  const parsed = parseCodeGraph(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const byPath = new Map(parsed.graph.modules.map((item) => [item.filePath, item]));
  assert.equal(deriveSubtitle(byPath.get("src/rag/pipeline.py") ?? moduleAt("missing")), "ingest · retrieve · answer");
  assert.equal(deriveSubtitle(byPath.get("src/api/routes.py") ?? moduleAt("missing")), "ingest_document · ask_question");
  assert.equal(deriveSubtitle(byPath.get("src/rag/vector_store.py") ?? moduleAt("missing")), "upsert · add_many · delete");
});

test("humanizeLabel convierte el nombre de archivo", () => {
  assert.equal(humanizeLabel("vector_store.py"), "Vector Store");
});

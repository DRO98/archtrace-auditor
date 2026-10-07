import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCodeGraph, buildIndexes } from "./graph";
import { findSubBlockAt } from "./ideSync";

function indexes() {
  const raw: unknown = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "public/graphs/macro_rag_project.json"), "utf8"),
  );
  const parsed = parseCodeGraph(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("grafo inválido");
  return buildIndexes(parsed.graph);
}

const FILE = "src/rag/vector_store.py";

test("findSubBlockAt elige el sub-bloque más estrecho", () => {
  const map = indexes().subBlocksByFile;
  assert.equal(findSubBlockAt(map, FILE, 60)?.name, "VectorStore.search");
  assert.equal(findSubBlockAt(map, FILE, 25)?.name, "VectorStore");
  assert.equal(findSubBlockAt(map, FILE, 22), null);
  assert.equal(findSubBlockAt(map, FILE, 14)?.name, "VectorRecord");
  assert.equal(findSubBlockAt(map, FILE, 95)?.name, "cosine_similarity");
  assert.equal(findSubBlockAt(map, "src/missing.py", 1), null);
});

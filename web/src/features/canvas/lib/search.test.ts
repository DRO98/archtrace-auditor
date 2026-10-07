import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { buildIndexes } from "./graph";
import { matchModules } from "./search";

const VECTOR = "src/rag/vector_store.py";
const DATABASE = "src/db/database.py";

function indexes() {
  const graph: CodeGraph = {
    version: 1,
    projectName: "sandbox",
    groups: [
      { id: "rag", label: "RAG Pipeline", color: "violet" },
      { id: "db", label: "Database", color: "emerald" },
    ],
    modules: [
      {
        id: VECTOR,
        label: "vector_store.py",
        filePath: VECTOR,
        groupId: "rag",
        language: "python",
        subBlocks: [
          { id: `${VECTOR}::VectorStore`, kind: "class", name: "VectorStore", range: { startLine: 24, endLine: 77 } },
          {
            id: `${VECTOR}::VectorStore.search`,
            kind: "method",
            name: "VectorStore.search",
            range: { startLine: 56, endLine: 68 },
            parentId: `${VECTOR}::VectorStore`,
          },
        ],
      },
      {
        id: DATABASE,
        label: "database.py",
        filePath: DATABASE,
        groupId: "db",
        language: "python",
        subBlocks: [
          { id: `${DATABASE}::Database`, kind: "class", name: "Database", range: { startLine: 19, endLine: 65 } },
        ],
      },
    ],
    edges: [],
  };
  return buildIndexes(graph);
}

const empty = { query: "", groups: new Set<string>(), kinds: new Set<never>() };

test("matchModules sin filtros devuelve null", () => {
  assert.equal(matchModules(indexes(), empty), null);
});

test("matchModules con vector incluye vector_store.py", () => {
  const match = matchModules(indexes(), { ...empty, query: "vector" });
  assert.ok(match?.modules.has(VECTOR));
});

test("matchModules con search marca el sub-bloque", () => {
  const match = matchModules(indexes(), { ...empty, query: "search" });
  assert.ok(match?.modules.has(VECTOR));
  assert.ok(match?.subBlocks.has(`${VECTOR}::VectorStore.search`));
});

test("matchModules con vector zzz devuelve conjuntos vacíos", () => {
  const match = matchModules(indexes(), { ...empty, query: "vector zzz" });
  assert.equal(match?.modules.size, 0);
  assert.equal(match?.subBlocks.size, 0);
});

test("matchModules filtra por grupo", () => {
  const match = matchModules(indexes(), { ...empty, groups: new Set(["rag"]) });
  assert.deepEqual([...(match?.modules ?? [])], [VECTOR]);
});

test("matchModules filtra por tipo", () => {
  const match = matchModules(indexes(), { ...empty, kinds: new Set(["method"]) });
  assert.deepEqual([...(match?.modules ?? [])], [VECTOR]);
});

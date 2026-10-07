import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { evictionsFor, MAX_STORED_GRAPHS } from "./graphStore";
import { githubGraphName, hydrateMemoryGraphs, memoryGraph, registerMemoryGraph, removeMemoryGraph } from "./memoryGraphs";

test("evictionsFor no borra nada por debajo del tope", () => {
  const entries = Array.from({ length: MAX_STORED_GRAPHS }, (_, index) => ({ name: `gh-${index}`, savedAt: index }));
  assert.deepEqual(evictionsFor(entries), []);
});

test("evictionsFor borra los usados hace más tiempo (LRU)", () => {
  const entries = [
    { name: "gh-viejo", savedAt: 1 },
    { name: "gh-nuevo", savedAt: 30 },
    { name: "gh-medio", savedAt: 10 },
    { name: "gh-reciente", savedAt: 20 },
  ];
  assert.deepEqual(evictionsFor(entries, 2), ["gh-medio", "gh-viejo"]);
});

test("sin IndexedDB (Node, modo privado) los grafos siguen funcionando en memoria", async () => {
  const graph: CodeGraph = { version: 1, projectName: "acme/api", groups: [], modules: [], edges: [] };
  const name = githubGraphName("acme", "api");
  registerMemoryGraph(name, graph, { kind: "github", label: "acme/api" });
  await hydrateMemoryGraphs();
  assert.equal(memoryGraph(name), graph);
  removeMemoryGraph(name);
  assert.equal(memoryGraph(name), undefined);
});

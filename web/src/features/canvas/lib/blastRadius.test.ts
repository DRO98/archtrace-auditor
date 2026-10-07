import assert from "node:assert/strict";
import test from "node:test";
import type { CodeModule } from "@core/graph";
import { calculateBlastRadius, impactLabel, summarizeImpact, type BlastEdge } from "./blastRadius";

function edge(id: string, source: string, target: string): BlastEdge {
  return { id, source, target };
}

function moduleOf(id: string, role: CodeModule["role"]): CodeModule {
  return {
    id,
    label: id,
    filePath: `${id}.py`,
    groupId: "g",
    language: "python",
    role,
    subBlocks: [],
  };
}

test("impacto directo en el primer salto y cascada más allá", () => {
  const edges = [edge("a-b", "a", "b"), edge("b-c", "b", "c"), edge("a-d", "a", "d")];
  const result = calculateBlastRadius("a", edges);
  assert.deepEqual(result.depthMap, { b: 1, d: 1, c: 2 });
  assert.equal(result.affectedNodeIds.has("a"), false);
  assert.deepEqual([...result.affectedEdgeIds].sort(), ["a-b", "a-d", "b-c"]);
});

test("un ciclo no reentra y conserva la profundidad mínima", () => {
  const edges = [edge("a-b", "a", "b"), edge("b-a", "b", "a"), edge("b-c", "b", "c"), edge("c-b", "c", "b")];
  const result = calculateBlastRadius("a", edges);
  assert.equal(result.depthMap.b, 1);
  assert.equal(result.depthMap.c, 2);
  assert.equal(result.affectedNodeIds.has("a"), false);
  assert.equal(result.affectedEdgeIds.has("b-a"), true);
});

test("auto-arista se ignora y un nodo aislado no impacta nada", () => {
  const loop = calculateBlastRadius("a", [edge("a-a", "a", "a")]);
  assert.equal(loop.affectedNodeIds.size, 0);
  assert.equal(loop.affectedEdgeIds.size, 0);

  const missing = calculateBlastRadius("ghost", [edge("a-b", "a", "b")]);
  assert.equal(missing.affectedNodeIds.size, 0);
  assert.deepEqual(missing.depthMap, {});
});

test("el resumen separa módulos y rutas API", () => {
  const modules = new Map<string, CodeModule>([
    ["api", moduleOf("api", "api")],
    ["db", moduleOf("db", "database")],
    ["ui", moduleOf("ui", "ui")],
  ]);
  const summary = summarizeImpact({ api: 1, db: 2, ui: 1 }, modules);
  assert.equal(summary.modules, 2);
  assert.equal(summary.apiRoutes, 1);
  assert.equal(summary.label, "2 módulos y 1 ruta API impactadas");
  assert.equal(impactLabel(1, 0), "1 módulo impactado");
  assert.equal(impactLabel(0, 2), "2 rutas API impactadas");
  assert.equal(impactLabel(0, 0), "Ningún módulo impactado");
});

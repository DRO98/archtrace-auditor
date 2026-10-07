import assert from "node:assert/strict";
import test from "node:test";
import { directCallers, edgeFor, matchesQuery, overallRisk, riskForDepth } from "./impact";

const edges = [
  { id: "x-a", source: "x", target: "a" },
  { id: "a-b", source: "a", target: "b" },
  { id: "b-c", source: "b", target: "c" },
  { id: "y-a", source: "y", target: "a" },
  { id: "a-a", source: "a", target: "a" },
];

test("riesgo por profundidad", () => {
  assert.equal(riskForDepth(1).level, "high");
  assert.equal(riskForDepth(2).level, "secondary");
  assert.equal(riskForDepth(5).level, "indirect");
});

test("riesgo global", () => {
  assert.equal(overallRisk(0, 0, 0).level, "none");
  assert.equal(overallRisk(1, 0, 0).level, "indirect");
  assert.equal(overallRisk(1, 1, 0).level, "secondary");
  assert.equal(overallRisk(2, 0, 2).level, "high");
  assert.equal(overallRisk(1, 5, 0).level, "high");
});

test("consumidores directos sin auto-aristas ni duplicados", () => {
  assert.deepEqual(directCallers("a", [...edges, { id: "x-a2", source: "x", target: "a" }]).sort(), ["x", "y"]);
});

test("cable a resaltar", () => {
  assert.equal(edgeFor("incoming", "a", "y", edges), "y-a");
  assert.equal(edgeFor("outgoing", "a", "b", edges), "a-b");
  assert.equal(edgeFor("outgoing", "a", "c", edges, new Set(["a-b", "b-c"])), "b-c");
  assert.equal(edgeFor("outgoing", "a", "c", edges), null);
});

test("filtro sin acentos ni mayúsculas", () => {
  assert.ok(matchesQuery("vectorial", "BD Vectorial"));
  assert.ok(matchesQuery("lección", "leccion.ts"));
  assert.ok(matchesQuery("  ", "cualquiera"));
  assert.ok(!matchesQuery("zzz", "abc", "def"));
});

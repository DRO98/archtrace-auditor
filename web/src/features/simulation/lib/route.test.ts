import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ROUTE_HOPS, resolveRoute, resolveScenarioRoutes, type RoutingEdge } from "./route";

// a → b → c ;  d → b (d solo llega a b) ;  x aislado
const EDGES: RoutingEdge[] = [
  { id: "ab", source: "a", target: "b" },
  { id: "bc", source: "b", target: "c" },
  { id: "db", source: "d", target: "b" },
];

test("mismo nodo: sin viaje", () => {
  assert.deepEqual(resolveRoute(EDGES, "a", "a"), []);
});

test("un salto a favor y en contra de la flecha", () => {
  assert.deepEqual(resolveRoute(EDGES, "a", "b"), [{ edgeId: "ab", reversed: false }]);
  assert.deepEqual(resolveRoute(EDGES, "b", "a"), [{ edgeId: "ab", reversed: true }]);
});

test("varios saltos mezclando sentidos", () => {
  assert.deepEqual(resolveRoute(EDGES, "d", "c"), [
    { edgeId: "db", reversed: false },
    { edgeId: "bc", reversed: false },
  ]);
  assert.deepEqual(resolveRoute(EDGES, "c", "d"), [
    { edgeId: "bc", reversed: true },
    { edgeId: "db", reversed: true },
  ]);
});

test("edge preferida: se respeta en el sentido correcto", () => {
  assert.deepEqual(resolveRoute(EDGES, "b", "a", "ab"), [{ edgeId: "ab", reversed: true }]);
});

test("edge preferida que no conecta esos nodos: cae al cálculo del camino", () => {
  assert.deepEqual(resolveRoute(EDGES, "a", "c", "db"), [
    { edgeId: "ab", reversed: false },
    { edgeId: "bc", reversed: false },
  ]);
});

test("sin camino: null", () => {
  assert.equal(resolveRoute(EDGES, "a", "x"), null);
});

test("a igualdad de saltos gana el camino a favor de las flechas", () => {
  const edges: RoutingEdge[] = [
    { id: "s-m1", source: "s", target: "m1" },
    { id: "m1-t", source: "m1", target: "t" },
    { id: "m2-s", source: "m2", target: "s" }, // s → m2 iría en contra
    { id: "t-m2", source: "t", target: "m2" }, // m2 → t iría en contra
  ];
  assert.deepEqual(
    resolveRoute(edges, "s", "t")?.map((hop) => hop.edgeId),
    ["s-m1", "m1-t"],
  );
});

test("más de MAX_ROUTE_HOPS saltos: null", () => {
  const chain: RoutingEdge[] = [];
  for (let index = 0; index <= MAX_ROUTE_HOPS; index += 1) {
    chain.push({ id: `e${index}`, source: `n${index}`, target: `n${index + 1}` });
  }
  assert.equal(resolveRoute(chain, "n0", `n${MAX_ROUTE_HOPS + 1}`), null);
  assert.equal(resolveRoute(chain, "n0", `n${MAX_ROUTE_HOPS}`)?.length, MAX_ROUTE_HOPS);
});

test("resolveScenarioRoutes: una ruta por transición", () => {
  const routes = resolveScenarioRoutes(
    [{ nodeId: "a" }, { nodeId: "b", edgeIdToNext: "bc" }, { nodeId: "c" }, { nodeId: "c" }],
    EDGES,
  );
  assert.equal(routes.length, 3);
  assert.deepEqual(routes[0], [{ edgeId: "ab", reversed: false }]);
  assert.deepEqual(routes[1], [{ edgeId: "bc", reversed: false }]);
  assert.deepEqual(routes[2], []);
});

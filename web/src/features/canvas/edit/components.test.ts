import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeGraph } from "@core/graph";
import { applyCanvasEdits, componentModuleId, placeDetachedNodes, removeComponent, spliceComponent, type AddedComponent } from "./components";

const graph: CodeGraph = {
  version: 1,
  projectName: "demo",
  groups: [{ id: "g", label: "src", color: "sky" }],
  modules: ["api", "store", "llm"].map((id) => ({ id, label: id, filePath: `${id}.ts`, groupId: "g", language: "typescript", subBlocks: [] })),
  edges: [
    { id: "e1", source: "api", target: "store", kind: "calls" },
    { id: "e2", source: "store", target: "llm", kind: "data-flow" },
  ],
};

test("sin componentes devuelve el mismo grafo", () => {
  assert.equal(applyCanvasEdits(graph, []), graph);
});

test("insertar antes de un nodo redirige sus entradas", () => {
  const edited = applyCanvasEdits(graph, [{ id: "a", template: "reranker", before: "llm" }]);
  const id = componentModuleId("a");
  assert.ok(edited.modules.some((item) => item.id === id && item.label === "Reranker"));
  assert.deepEqual(
    edited.edges.map((edge) => `${edge.source}->${edge.target}`),
    ["api->store", `store->${id}`, `${id}->llm`],
  );
  assert.ok(edited.groups.some((group) => group.id === "canvas-edits"));
});

test("dos componentes delante del mismo nodo se encadenan y se numeran", () => {
  const edited = applyCanvasEdits(graph, [
    { id: "a", template: "guardrails", before: "llm" },
    { id: "b", template: "guardrails", before: "llm" },
  ]);
  const [a, b] = [componentModuleId("a"), componentModuleId("b")];
  assert.deepEqual(
    edited.edges.map((edge) => `${edge.source}->${edge.target}`),
    ["api->store", `store->${a}`, `${a}->${b}`, `${b}->llm`],
  );
  assert.equal(edited.modules.at(-1)?.label, "Guardrails 2");
});

test("un ancla inexistente cae al primer módulo y nunca queda aislado", () => {
  const edited = applyCanvasEdits(graph, [{ id: "a", template: "cache", before: "borrado" }]);
  assert.ok(edited.edges.some((edge) => edge.source === componentModuleId("a") && edge.target === "api"));
});

test("quitar un componente reengancha los que apuntaban a él", () => {
  const components: AddedComponent[] = [
    { id: "a", template: "cache", before: "llm" },
    { id: "b", template: "guardrails", before: componentModuleId("a") },
  ];
  assert.deepEqual(removeComponent(components, componentModuleId("a")), [{ id: "b", template: "guardrails", before: "llm" }]);
});

test("un componente suelto se añade sin tocar las aristas del código", () => {
  const edited = applyCanvasEdits(graph, [{ id: "a", template: "guardrails", before: "llm", detached: true, position: { x: 10, y: 20 } }]);
  assert.ok(edited.modules.some((item) => item.id === componentModuleId("a")));
  assert.deepEqual(
    edited.edges.map((edge) => `${edge.source}->${edge.target}`),
    ["api->store", "store->llm"],
  );
});

test("empalmar un suelto lo conecta antes de su nodo sugerido y olvida la posición", () => {
  const detached: AddedComponent[] = [{ id: "a", template: "reranker", before: "llm", detached: true, position: { x: 1, y: 2 } }];
  const spliced = spliceComponent(detached, componentModuleId("a"));
  assert.deepEqual(spliced, [{ id: "a", template: "reranker", before: "llm" }]);
  const id = componentModuleId("a");
  assert.deepEqual(
    applyCanvasEdits(graph, spliced).edges.map((edge) => `${edge.source}->${edge.target}`),
    ["api->store", `store->${id}`, `${id}->llm`],
  );
  assert.equal(spliceComponent(detached, componentModuleId("a"), "store")[0]?.before, "store");
});

test("los sueltos se colocan en su punto de caída y salen de su caja", () => {
  const id = componentModuleId("a");
  const nodes = [
    { id, position: { x: 0, y: 0 }, parentId: "box", extent: "parent" as const },
    { id: "llm", position: { x: 5, y: 5 }, parentId: "box" },
  ];
  const placed = placeDetachedNodes(nodes, [{ id: "a", template: "cache", before: null, detached: true, position: { x: 300, y: 40 } }]);
  assert.deepEqual(placed[0], { id, position: { x: 300, y: 40 } });
  assert.equal(placed[1], nodes[1]);
});

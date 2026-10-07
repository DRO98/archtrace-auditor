import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { CodeGraph, CodeModule } from "@core/graph";
import { nodeRects, routeLayeredEdges, routeSystemEdges, segmentHitsAny, simplify } from "./edgeRouting";
import { layeredFlow } from "./flow";
import { parseCodeGraph } from "./graph";
import type { GraphPosition, LayeredLayout } from "./layout";
import { layoutLayered } from "./layout";
import { assignEdgePorts, pickPortPair, type Rect } from "./ports";
import { prepareGraph, type PreparedGraph } from "./subsystems";
import { TOOL_CALLING_AGENT_DEMO } from "@/features/demos/catalog/toolCallingAgent";
import { CARD_HEIGHT, CARD_WIDTH } from "../theme";

function load(file: string): CodeGraph {
  const parsed = parseCodeGraph(JSON.parse(readFileSync(path.resolve(process.cwd(), `public/graphs/${file}.json`), "utf8")) as unknown);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.graph;
}

/** ¿El tramo ortogonal a→b entra en el interior de `rect`? (tocar el borde no cuenta) */
function crosses(a: GraphPosition, b: GraphPosition, rect: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > rect.x && minX < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height;
}

function segments(points: readonly GraphPosition[]): Array<[GraphPosition, GraphPosition]> {
  return points.slice(1).map((point, index) => [points[index] as GraphPosition, point]);
}

/** Recorre todas las aristas dibujadas y comprueba que ninguna atraviesa tarjetas o cajas ajenas. */
function assertClearRoutes(file: string) {
  const prepared = prepareGraph(load(file));
  const layout = layoutLayered(prepared);
  const flow = layeredFlow(prepared, layout);
  const rects = nodeRects(prepared, layout);
  const routed = flow.edges.filter((edge) => edge.type === "routed");
  assert.ok(routed.length > 0);
  for (const edge of routed) {
    const points = (edge.data as { points: GraphPosition[] }).points;
    assert.ok(points.length >= 2, `${file}: ${edge.id} sin ruta`);
    for (const [a, b] of segments(points)) {
      assert.ok(a.x === b.x || a.y === b.y, `${file}: ${edge.id} tiene un tramo oblicuo`);
      for (const [id, rect] of rects) {
        if (id === edge.source || id === edge.target) continue;
        assert.equal(crosses(a, b, rect), false, `${file}: ${edge.id} cruza ${id}`);
      }
      for (const box of layout.boxes) {
        const own = [edge.source, edge.target].some((id) => prepared.subsystemOf.get(id) === box.id);
        if (own) continue;
        assert.equal(crosses(a, b, box), false, `${file}: ${edge.id} atraviesa la caja ${box.label}`);
      }
    }
  }
}

test("macro: ninguna arista atraviesa tarjetas ni cajas ajenas", () => assertClearRoutes("macro_rag_project"));
test("stress: todas las aristas tienen ruta y no atraviesan tarjetas ni cajas ajenas", () => assertClearRoutes("stress"));

test("macro: aristas entre columnas salen por la derecha y entran por la izquierda", () => {
  const prepared = prepareGraph(load("macro_rag_project"));
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  for (const edge of flow.edges.filter((item) => item.type === "routed")) {
    assert.notEqual(prepared.layerOf.get(edge.source), prepared.layerOf.get(edge.target), edge.id);
    assert.match(edge.sourceHandle ?? "", /^port-right-\d+$/, edge.id);
    assert.match(edge.targetHandle ?? "", /^port-left-\d+$/, edge.id);
  }
  const pipeline = flow.nodes.find((node) => node.type === "module" && node.data.module.label === "RAG Pipeline");
  assert.deepEqual(pipeline?.type === "module" ? [...(pipeline.data.ports ?? [])].sort() : [], ["left", "right"]);
});

/** Tramos de todas las aristas dibujadas, con el id de su arista. */
function drawnSegments(file: string) {
  const prepared = prepareGraph(load(file));
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  return flow.edges
    .filter((item) => item.type === "routed")
    .flatMap((edge) => segments((edge.data as { points: GraphPosition[] }).points).map(([a, b]) => ({ edge: edge.id, a, b })));
}

/** Dos cables distintos nunca recorren a la vez el mismo tramo de línea (tocarse en un punto no cuenta). */
function assertNoOverlaps(file: string) {
  const all = drawnSegments(file);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const left = all[i]!;
      const right = all[j]!;
      if (left.edge === right.edge) continue;
      const vertical = left.a.x === left.b.x && right.a.x === right.b.x && left.a.x === right.a.x;
      const horizontal = left.a.y === left.b.y && right.a.y === right.b.y && left.a.y === right.a.y;
      if (!vertical && !horizontal) continue;
      const key = vertical ? "y" : "x";
      const overlap =
        Math.min(Math.max(left.a[key], left.b[key]), Math.max(right.a[key], right.b[key])) -
        Math.max(Math.min(left.a[key], left.b[key]), Math.min(right.a[key], right.b[key]));
      assert.ok(overlap <= 0, `${file}: ${left.edge} y ${right.edge} se superponen ${overlap.toFixed(1)} px`);
    }
  }
}

test("macro: ningún par de cables comparte carril (vertical ni horizontal)", () => assertNoOverlaps("macro_rag_project"));

test("macro: los cables que salen del mismo lado de un nodo usan ranuras distintas", () => {
  const prepared = prepareGraph(load("macro_rag_project"));
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  const used = new Map<string, Set<string>>();
  for (const edge of flow.edges.filter((item) => item.type === "routed")) {
    for (const [node, handle] of [
      [edge.source, `s:${edge.sourceHandle}`],
      [edge.target, `t:${edge.targetHandle}`],
    ] as const) {
      const set = used.get(node) ?? new Set<string>();
      assert.equal(set.has(handle), false, `${node} repite ${handle}`);
      set.add(handle);
      used.set(node, set);
    }
  }
  const starts = flow.edges
    .filter((item) => item.type === "routed")
    .map((edge) => `${edge.source}@${JSON.stringify((edge.data as { points: GraphPosition[] }).points[0])}`);
  assert.equal(new Set(starts).size, starts.length, "dos cables arrancan en el mismo punto");
});

test("macro: cada cable hereda el color de su nodo origen", () => {
  const prepared = prepareGraph(load("macro_rag_project"));
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  const api = flow.edges.filter((edge) => edge.type === "routed" && edge.source === "src/api/routes.py");
  assert.ok(api.length > 0);
  for (const edge of api) assert.equal((edge.style as { stroke?: string }).stroke, "#3b82f6", edge.id);
});

function syntheticModule(id: string): CodeModule {
  return { id, label: id, filePath: `src/${id}.py`, groupId: "g", language: "python", subBlocks: [] };
}

test("una arista cuyo carril directo atraviesa una caja ajena la rodea por fuera", () => {
  // src (izquierda) y dst (derecha) a la misma altura; entre ambos, una caja con un módulo propio.
  const modules = ["src", "inside", "dst"].map(syntheticModule);
  const prepared: PreparedGraph = {
    graph: { version: 1, projectName: "t", groups: [], modules, edges: [] },
    layerOf: new Map([
      ["src", 0],
      ["inside", 1],
      ["dst", 2],
    ]),
    subsystemOf: new Map([["inside", "core"]]),
    subsystems: [{ id: "core", label: "Core", color: "violet" }],
    hidden: [],
  };
  const box = { id: "core", label: "Core", color: "violet" as const, x: 360, y: -300, width: 340, height: 700 };
  const layout: LayeredLayout = {
    positions: new Map([
      ["src", { x: 0, y: 0 }],
      ["inside", { x: 392, y: 300 }],
      ["dst", { x: 820, y: 0 }],
    ]),
    boxes: [box],
    folds: [[0, 1, 2]],
  };
  const routes = routeLayeredEdges(prepared, layout, [{ id: "e", source: "src", target: "dst", ports: { source: "right", target: "left" } }]);
  const points = routes.get("e");
  assert.ok(points, "hay ruta");
  assert.deepEqual(points[0], { x: CARD_WIDTH, y: CARD_HEIGHT / 2 });
  assert.deepEqual(points[points.length - 1], { x: 820, y: CARD_HEIGHT / 2 });
  for (const [a, b] of segments(points)) assert.equal(crosses(a, b, box), false, `tramo ${JSON.stringify([a, b])}`);
  // Rodea por encima o por debajo de la caja.
  assert.ok(points.some((point) => point.y < box.y || point.y > box.y + box.height));
});

test("pickPortPair: horizontal entre columnas, vertical dentro de una columna", () => {
  const card = (x: number, y: number): Rect => ({ x, y, width: CARD_WIDTH, height: CARD_HEIGHT });
  assert.deepEqual(pickPortPair(card(0, 0), card(400, 300)), { source: "right", target: "left" });
  assert.deepEqual(pickPortPair(card(400, 0), card(0, 0)), { source: "left", target: "right" });
  assert.deepEqual(pickPortPair(card(0, 0), card(0, 200)), { source: "bottom", target: "top" });
  assert.deepEqual(pickPortPair(card(0, 200), card(0, 0)), { source: "top", target: "bottom" });
  // Misma columna con desplazamiento lateral pequeño: sigue siendo vertical.
  assert.deepEqual(pickPortPair(card(0, 0), card(40, 300)), { source: "bottom", target: "top" });
});

test("assignEdgePorts no sale por abajo de una tarjeta con sub-nodos", () => {
  const rects = new Map<string, Rect>([
    ["a", { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT }],
    ["b", { x: 0, y: 300, width: CARD_WIDTH, height: CARD_HEIGHT }],
  ]);
  const edges = [{ id: "e", source: "a", target: "b" }];
  assert.deepEqual(assignEdgePorts(edges, (id) => rects.get(id)).get("e"), { source: "bottom", target: "top" });
  assert.deepEqual(assignEdgePorts(edges, (id) => rects.get(id), (id) => id === "a").get("e"), { source: "right", target: "right" });
});

test("vertical dentro de una columna: ruta recta de abajo a arriba y rodeo si hay una tarjeta en medio", () => {
  const modules = ["top", "middle", "bottom"].map(syntheticModule);
  const prepared: PreparedGraph = {
    graph: { version: 1, projectName: "t", groups: [], modules, edges: [] },
    layerOf: new Map(modules.map((item) => [item.id, 0])),
    subsystemOf: new Map(),
    subsystems: [],
    hidden: [],
  };
  const layout: LayeredLayout = {
    positions: new Map([
      ["top", { x: 0, y: 0 }],
      ["middle", { x: 0, y: 200 }],
      ["bottom", { x: 0, y: 400 }],
    ]),
    boxes: [],
    folds: [[0]],
  };
  const vertical = { source: "bottom", target: "top" } as const;
  const routes = routeLayeredEdges(prepared, layout, [
    { id: "near", source: "top", target: "middle", ports: vertical },
    { id: "far", source: "top", target: "bottom", ports: vertical },
  ]);
  assert.deepEqual(routes.get("near"), [
    { x: CARD_WIDTH / 2, y: CARD_HEIGHT },
    { x: CARD_WIDTH / 2, y: 200 },
  ]);
  const far = routes.get("far");
  assert.ok(far && far.length > 2, "rodea la tarjeta intermedia");
  const middle = { x: 0, y: 200, width: CARD_WIDTH, height: CARD_HEIGHT };
  for (const [a, b] of segments(far)) assert.equal(crosses(a, b, middle), false);
});

test("simplify deja solo extremos y codos", () => {
  assert.deepEqual(
    simplify([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
    ]),
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ],
  );
});

test("caja de herramientas: la pila baja por el flujo y ningún cable sale de la caja", () => {
  const prepared = prepareGraph(TOOL_CALLING_AGENT_DEMO.graph);
  const layout = layoutLayered(prepared);
  const box = layout.boxes.find((item) => item.id === "tools");
  assert.ok(box);
  const y = (id: string) => layout.positions.get(id)?.y ?? NaN;
  const registry = "agent/tools/registry.ts";
  const search = "agent/tools/webSearch.ts";
  const fetcher = "agent/tools/fetchPage.ts";
  assert.ok(y(registry) < y(fetcher) && y(registry) < y(search), "el registro va arriba de lo que despacha");

  const flow = layeredFlow(prepared, layout);
  const inside = (edge: { source: string; target: string }) => [registry, search, fetcher].includes(edge.source) && [search, fetcher].includes(edge.target);
  const internal = flow.edges.filter((edge) => edge.type === "routed" && inside(edge));
  assert.equal(internal.length, 2);
  for (const edge of internal) {
    const points = (edge.data as { points: GraphPosition[] }).points;
    assert.ok(points.length >= 2, `${edge.id} sin ruta`);
    for (const point of points) {
      assert.ok(point.x >= box.x && point.x <= box.x + box.width, `${edge.id} sale de la caja por x=${point.x}`);
      assert.ok(point.y >= box.y && point.y <= box.y + box.height, `${edge.id} sale de la caja por y=${point.y}`);
    }
    // El cable corto (a la tarjeta contigua) va en vertical por el centro; el largo rodea por el lado derecho.
    const adjacent = edge.target === (y(fetcher) < y(search) ? fetcher : search);
    assert.equal(edge.sourceHandle?.startsWith(adjacent ? "port-bottom" : "port-right"), true, `${edge.id} usa ${edge.sourceHandle}`);
  }
});

test("segmentHitsAny: detecta cruce diagonal y deja pasar el tiro libre", () => {
  const wall = { x: 100, y: 0, width: 40, height: 200 };
  assert.equal(segmentHitsAny({ x: 0, y: 100 }, { x: 200, y: 100 }, [wall]), true);
  assert.equal(segmentHitsAny({ x: 0, y: 100 }, { x: 80, y: 100 }, [wall]), false);
  assert.equal(segmentHitsAny({ x: 0, y: 0 }, { x: 50, y: 50 }, [wall]), false);
});

test("routeSystemEdges: recta si no hay obstáculo; rodea si hay tarjeta en medio", () => {
  const clear = routeSystemEdges(
    [
      { id: "a", x: 0, y: 40, width: 200, height: 80 },
      { id: "b", x: 480, y: 40, width: 200, height: 80 },
    ],
    [{ id: "e1", source: "a", target: "b" }],
  );
  assert.equal(clear.get("e1")?.length, 2, "tiro libre = dos puntos (recta)");

  // Hueco suficiente para el stub (20) + pad (14): mid empieza en x=280.
  const nodes = [
    { id: "a", x: 0, y: 40, width: 200, height: 80 },
    { id: "b", x: 480, y: 40, width: 200, height: 80 },
    { id: "mid", x: 280, y: 10, width: 120, height: 140 },
  ];
  const blocked = routeSystemEdges(nodes, [{ id: "e2", source: "a", target: "b" }]);
  const path = blocked.get("e2");
  assert.ok(path && path.length > 2, `con obstáculo en medio, polilínea con codos (len=${path?.length ?? 0})`);
  const mid = { x: 280, y: 10, width: 120, height: 140 };
  for (let index = 1; index < path!.length; index += 1) {
    const from = path![index - 1]!;
    const to = path![index]!;
    if (from.x === to.x || from.y === to.y) {
      assert.equal(segmentHitsAny(from, to, [mid]), false, `tramo ${from.x},${from.y}→${to.x},${to.y} pisa mid`);
    }
  }
});

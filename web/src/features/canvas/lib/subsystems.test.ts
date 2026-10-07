import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { layeredFlow } from "./flow";
import { parseCodeGraph } from "./graph";
import { centerHubs, layoutLayered } from "./layout";
import { intraSubsystemRank, isAiGraph, LAYER, migrateLegacyLayer, orientEdge, prepareGraph, STAGE } from "./subsystems";
import { TOOL_CALLING_AGENT_DEMO } from "@/features/demos/catalog/toolCallingAgent";
import { CARD_HEIGHT, CARD_WIDTH } from "../theme";

function loadSandbox(): CodeGraph {
  const raw: unknown = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "public/graphs/macro_rag_project.json"), "utf8"),
  );
  const parsed = parseCodeGraph(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.graph;
}

function stripHints(graph: CodeGraph): CodeGraph {
  const modules = graph.modules.map((item) => {
    const copy = { ...item };
    delete copy.layer;
    delete copy.subsystem;
    return copy;
  });
  const copy: CodeGraph = { ...graph, modules };
  delete copy.subsystems;
  return copy;
}

test("prepareGraph oculta módulos aislados (Notes Database)", () => {
  const prepared = prepareGraph(loadSandbox());
  assert.deepEqual(prepared.hidden.map((item) => item.label), ["Notes Database"]);
  assert.ok(!prepared.graph.modules.some((item) => item.label === "Notes Database"));
});

for (const [name, load] of [
  ["explícitas", loadSandbox],
  ["inferidas", () => stripHints(loadSandbox())],
] as const) {
  test(`capas ${name}: entrada → orquestación → servicios`, () => {
    const prepared = prepareGraph(load());
    const layerOf = (label: string) => {
      const item = prepared.graph.modules.find((entry) => entry.label === label);
      assert.ok(item, label);
      return prepared.layerOf.get(item.id);
    };
    assert.equal(layerOf("API Routes"), LAYER.entry);
    assert.equal(layerOf("App Bootstrap"), LAYER.entry);
    assert.equal(layerOf("Chunker"), LAYER.services);
    assert.equal(layerOf("Embedder"), LAYER.services);
    assert.equal(layerOf("Vector Store"), LAYER.services);
    assert.equal(layerOf("RAG Pipeline"), LAYER.orchestration);
    assert.equal(layerOf("LLM Service"), LAYER.services);
  });

  test(`subsistemas ${name}: RAG Core e Inference`, () => {
    const prepared = prepareGraph(load());
    const members = (subsystem: string) =>
      prepared.graph.modules
        .filter((item) => prepared.subsystemOf.get(item.supportOf ?? item.id) === subsystem)
        .map((item) => item.label)
        .sort();
    assert.deepEqual(members("rag-core"), ["Chunker", "Embedder", "Vector Store"]);
    assert.deepEqual(members("inference"), ["LLM Service", "Prompts"]);
    // Embedder y Vector Store estaban colgados del pipeline: al cambiar de columna pasan a tarjeta.
    assert.equal(prepared.graph.modules.find((item) => item.label === "Embedder")?.supportOf, undefined);
    assert.ok(prepared.graph.modules.find((item) => item.label === "Prompts")?.supportOf);
  });
}

test("migrateLegacyLayer colapsa las 5 etapas guardadas en 3 columnas", () => {
  assert.equal(migrateLegacyLayer(STAGE.entry), LAYER.entry);
  assert.equal(migrateLegacyLayer(STAGE.preprocess), LAYER.services);
  assert.equal(migrateLegacyLayer(STAGE.index), LAYER.services);
  assert.equal(migrateLegacyLayer(STAGE.orchestration), LAYER.orchestration);
  assert.equal(migrateLegacyLayer(STAGE.generation), LAYER.services);
  assert.equal(migrateLegacyLayer(9), LAYER.services);
  assert.equal(migrateLegacyLayer(-1), LAYER.entry);
});

test("intraSubsystemRank sigue el dato: chunker < embedder < vector < llm < prompts", () => {
  const rank = (filePath: string, label: string) => intraSubsystemRank({ filePath, label });
  const order = [
    rank("src/rag/chunker.py", "Chunker"),
    rank("src/rag/embeddings.py", "Embedder"),
    rank("src/rag/vector_store.py", "Vector Store"),
    rank("src/llm/service.py", "LLM Service"),
    rank("src/llm/prompts.py", "Prompts"),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(new Set(order).size, order.length);
});

test("utilidades sin capa no abren una columna más allá de servicios", () => {
  const graph = stripHints(loadSandbox());
  const llm = graph.modules.find((item) => item.label === "LLM Service");
  assert.ok(llm);
  const util = { ...llm, id: "util:helpers", label: "Helpers", filePath: "src/helpers.py", role: "util" as const };
  delete util.supportOf;
  const deeper = { ...util, id: "util:deeper", label: "Deeper", filePath: "src/deeper.py" };
  const prepared = prepareGraph({
    ...graph,
    modules: [...graph.modules, util, deeper],
    edges: [
      ...graph.edges,
      { id: "e:llm-helpers", source: llm.id, target: util.id, kind: "imports" },
      { id: "e:helpers-deeper", source: util.id, target: deeper.id, kind: "imports" },
    ],
  });
  assert.equal(prepared.layerOf.get(util.id), LAYER.services);
  assert.equal(prepared.layerOf.get(deeper.id), LAYER.services);
});

test("todas las aristas avanzan de izquierda a derecha", () => {
  const prepared = prepareGraph(loadSandbox());
  for (const edge of prepared.graph.edges) {
    const oriented = orientEdge(edge, prepared.layerOf);
    assert.ok((prepared.layerOf.get(oriented.source) ?? 0) <= (prepared.layerOf.get(oriented.target) ?? 0), edge.id);
  }
});

test("layoutLayered: columnas por capa y cajas sin tarjetas ajenas dentro", () => {
  const prepared = prepareGraph(loadSandbox());
  const layout = layoutLayered(prepared);
  const principals = prepared.graph.modules.filter((item) => item.supportOf === undefined);

  // Orden de lectura: una capa posterior va en una fila posterior o más a la derecha en la misma fila.
  const foldOf = (layer: number) => layout.folds.findIndex((fold) => fold.includes(layer));
  for (const left of principals) {
    for (const right of principals) {
      const a = prepared.layerOf.get(left.id) ?? 0;
      const b = prepared.layerOf.get(right.id) ?? 0;
      if (a >= b) continue;
      assert.ok(foldOf(a) <= foldOf(b));
      const aPos = layout.positions.get(left.id);
      const bPos = layout.positions.get(right.id);
      if (foldOf(a) === foldOf(b)) assert.ok((aPos?.x ?? 0) < (bPos?.x ?? 0));
      else assert.ok((aPos?.y ?? 0) < (bPos?.y ?? 0));
    }
  }

  for (const box of layout.boxes) {
    for (const item of principals) {
      const position = layout.positions.get(item.id);
      assert.ok(position);
      const inside =
        position.x >= box.x && position.x <= box.x + box.width && position.y >= box.y && position.y <= box.y + box.height;
      const member = prepared.subsystemOf.get(item.id) === box.id;
      assert.equal(inside, member, `${item.label} dentro de ${box.label}: ${inside}`);
    }
  }
});

test("layoutLayered: RAG Core apila sus tarjetas en vertical por rango semántico", () => {
  const prepared = prepareGraph(loadSandbox());
  const layout = layoutLayered(prepared);
  const members = prepared.graph.modules.filter((item) => prepared.subsystemOf.get(item.id) === "rag-core");
  assert.equal(members.length, 3);
  const placed = members
    .map((item) => ({ rank: intraSubsystemRank(item), position: layout.positions.get(item.id) }))
    .sort((a, b) => a.rank - b.rank);
  for (const [index, entry] of placed.entries()) {
    assert.ok(entry.position);
    const previous = placed[index - 1]?.position;
    if (!previous) continue;
    assert.equal(entry.position.x, previous.x, "misma columna");
    assert.ok(entry.position.y > previous.y, "Y crece con el rango");
  }
});

test("layoutLayered: pipeline centrado entre las cajas de servicios", () => {
  const prepared = prepareGraph(loadSandbox());
  const layout = layoutLayered(prepared);
  const pipeline = prepared.graph.modules.find((item) => item.label === "RAG Pipeline");
  assert.ok(pipeline);
  const position = layout.positions.get(pipeline.id);
  assert.ok(position);
  const top = Math.min(...layout.boxes.map((box) => box.y));
  const bottom = Math.max(...layout.boxes.map((box) => box.y + box.height));
  const center = position.y + CARD_HEIGHT / 2;
  assert.ok(Math.abs(center - (top + bottom) / 2) <= CARD_HEIGHT, `pipeline en ${center}, cajas ${top}–${bottom}`);
});

test("layoutLayered: lienzo equilibrado (ni tira horizontal ni torre) y sin solapes", () => {
  for (const file of ["macro_rag_project", "stress"]) {
    const parsed = parseCodeGraph(
      JSON.parse(readFileSync(path.resolve(process.cwd(), `public/graphs/${file}.json`), "utf8")) as unknown,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const prepared = prepareGraph(parsed.graph);
    const layout = layoutLayered(prepared);
    const cards = prepared.graph.modules
      .filter((item) => item.supportOf === undefined)
      .map((item) => {
        const position = layout.positions.get(item.id);
        assert.ok(position, item.id);
        return { id: item.id, ...position };
      });
    const right = Math.max(...cards.map((card) => card.x + CARD_WIDTH), ...layout.boxes.map((box) => box.x + box.width));
    const left = Math.min(...cards.map((card) => card.x), ...layout.boxes.map((box) => box.x));
    const bottom = Math.max(...cards.map((card) => card.y + CARD_HEIGHT), ...layout.boxes.map((box) => box.y + box.height));
    const top = Math.min(...cards.map((card) => card.y), ...layout.boxes.map((box) => box.y));
    const aspect = (right - left) / (bottom - top);
    assert.ok(aspect > 0.8 && aspect < 3, `${file}: relación ${aspect.toFixed(2)}`);

    for (const [index, a] of cards.entries()) {
      for (const b of cards.slice(index + 1)) {
        const overlap = a.x + CARD_WIDTH > b.x && b.x + CARD_WIDTH > a.x && a.y + CARD_HEIGHT > b.y && b.y + CARD_HEIGHT > a.y;
        assert.equal(overlap, false, `${file}: ${a.id} solapa ${b.id}`);
      }
    }
  }
});

test("layeredFlow: padres antes que hijos, extent parent y posición relativa", () => {
  const prepared = prepareGraph(loadSandbox());
  const flow = layeredFlow(prepared, layoutLayered(prepared));
  const indexOf = new Map(flow.nodes.map((node, index) => [node.id, index]));
  const children = flow.nodes.filter((node) => node.parentId);
  assert.ok(children.length >= 5);
  for (const node of children) {
    assert.equal(node.extent, "parent");
    assert.ok((indexOf.get(node.parentId ?? "") ?? Infinity) < (indexOf.get(node.id) ?? -1));
    const parent = flow.nodes.find((entry) => entry.id === node.parentId);
    assert.equal(parent?.type, "subsystem");
    assert.equal(parent?.zIndex, -1);
    assert.ok(node.position.x >= 0 && node.position.y >= 0);
    assert.ok(node.position.x <= (parent?.width ?? 0) && node.position.y <= (parent?.height ?? 0));
  }
});

test("centerHubs lleva el nodo de mayor grado al centro de su columna sin tocar las demás", () => {
  const items = [
    { id: "hub", column: 0, degree: 6 },
    { id: "x", column: 1, degree: 0 },
    { id: "a", column: 0, degree: 1 },
    { id: "b", column: 0, degree: 2 },
    { id: "c", column: 0, degree: 1 },
    { id: "d", column: 0, degree: 0 },
  ];
  const result = centerHubs(items, (item) => item.column, (item) => item.degree).map((item) => item.id);
  // La columna 0 pasa de [hub, a, b, c, d] a [a, b, hub, c, d]; "x" (columna 1) sigue en su sitio.
  assert.deepEqual(result, ["a", "x", "b", "hub", "c", "d"]);

  const pair = [
    { id: "p", column: 0, degree: 0 },
    { id: "q", column: 0, degree: 9 },
  ];
  assert.deepEqual(centerHubs(pair, (item) => item.column, (item) => item.degree), pair);
});

test("compactación: una tarjeta que solo depende de la entrada va a la columna del orquestador, debajo de él", () => {
  const prepared = prepareGraph(TOOL_CALLING_AGENT_DEMO.graph);
  const layout = layoutLayered(prepared);
  const memory = "agent/memory/conversation.ts";
  const loop = "agent/loop.ts";
  assert.equal(prepared.layerOf.get(memory), LAYER.orchestration);
  const memoryAt = layout.positions.get(memory);
  const loopAt = layout.positions.get(loop);
  assert.ok(memoryAt && loopAt);
  assert.equal(memoryAt.x, loopAt.x);
  assert.ok(memoryAt.y >= loopAt.y + CARD_HEIGHT, "Conversation Memory debe quedar bajo Agent Loop");
  // Las cajas de servicios no se estiran: siguen ocupando solo la última columna.
  const rightmost = Math.max(...[...layout.positions.values()].map((position) => position.x));
  assert.equal(memoryAt.x < rightmost, true);
});

test("grafo no-IA: sin cajas RAG; Kafka y Postgres caen en mensajería y datos", () => {
  const mod = (filePath: string, role?: CodeGraph["modules"][number]["role"]) => ({
    id: filePath,
    label: filePath,
    filePath,
    groupId: "g",
    language: "ts",
    subBlocks: [],
    ...(role ? { role } : {}),
  });
  const graph: CodeGraph = {
    version: 1,
    projectName: "shop",
    groups: [{ id: "g", label: "g", color: "sky" }],
    modules: [
      mod("src/api/orders.ts", "api"),
      mod("src/search/index.ts", "service"),
      mod("src/events/order_producer.ts", "broker"),
      mod("src/events/order_consumer.ts", "broker"),
      mod("src/db/orders_repository.ts", "database"),
      mod("src/cache/redis.ts", "cache"),
    ],
    edges: [
      { id: "e1", source: "src/api/orders.ts", target: "src/search/index.ts", kind: "calls" },
      { id: "e2", source: "src/api/orders.ts", target: "src/events/order_producer.ts", kind: "data-flow" },
      { id: "e3", source: "src/events/order_producer.ts", target: "src/events/order_consumer.ts", kind: "data-flow" },
      { id: "e4", source: "src/events/order_consumer.ts", target: "src/db/orders_repository.ts", kind: "calls" },
      { id: "e5", source: "src/db/orders_repository.ts", target: "src/cache/redis.ts", kind: "calls" },
    ],
  };
  assert.equal(isAiGraph(graph), false);
  const prepared = prepareGraph(graph);
  assert.ok(!prepared.subsystems.some((item) => item.id === "rag-core" || item.id === "inference"));
  assert.equal(prepared.subsystemOf.get("src/events/order_producer.ts"), "messaging");
  assert.equal(prepared.subsystemOf.get("src/db/orders_repository.ts"), "data");
  assert.equal(prepared.subsystemOf.get("src/cache/redis.ts"), "data");
  assert.equal(prepared.subsystemOf.get("src/search/index.ts"), undefined);
});

test("isAiGraph detecta el sandbox RAG", () => {
  assert.equal(isAiGraph(loadSandbox()), true);
});

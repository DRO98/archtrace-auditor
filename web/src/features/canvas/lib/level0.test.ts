import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph, CodeModule, ModuleEdge } from "@core/graph";
import { flowEdgeEndpoints } from "./flow";
import { buildLevel0, focusPrepared, layoutLevel0, level0Flow, LEVEL0_MAX_BLOCKS, OTHER_BLOCK_ID, sampleLabel, shouldUseLevel0 } from "./level0";
import { prepareGraph } from "./subsystems";

function module(id: string, groupId: string, extra: Partial<CodeModule> = {}): CodeModule {
  return { id, label: id, filePath: `src/${groupId}/${id}.ts`, groupId, language: "typescript", role: "code", subBlocks: [], ...extra };
}

/** Carpetas de tamaños dispares; cada carpeta es una cadena interna y todas cuelgan de `g0/m0`. */
function fixture(sizes: readonly number[]): CodeGraph {
  const modules: CodeModule[] = [];
  const edges: ModuleEdge[] = [];
  const edge = (source: string, target: string) => edges.push({ id: `${source}->${target}`, source, target, kind: "imports" });
  sizes.forEach((size, group) => {
    for (let index = 0; index < size; index += 1) {
      modules.push(module(`g${group}m${index}`, `g${group}`));
      if (index > 0) edge(`g${group}m${index - 1}`, `g${group}m${index}`);
    }
    if (group > 0) edge("g0m0", `g${group}m0`);
  });
  return {
    version: 1,
    projectName: "fixture",
    groups: sizes.map((_, group) => ({ id: `g${group}`, label: `g${group}`, color: "sky" })),
    modules,
    edges,
    // Sin catálogo de subsistemas: los bloques salen de las carpetas.
    subsystems: [],
  };
}

test("Level 0 reduce un grafo con muchas carpetas a como mucho 8 bloques, con «Otros»", () => {
  const prepared = prepareGraph(fixture([10, 6, 4, 2, 2, 2, 2, 2, 2, 2, 1, 1]));
  const level0 = buildLevel0(prepared);
  assert.ok(level0.blocks.length <= LEVEL0_MAX_BLOCKS);
  assert.ok(level0.blocks.length >= 4);
  assert.ok(shouldUseLevel0(prepared, level0));
  const other = level0.blocks.find((block) => block.id === OTHER_BLOCK_ID);
  assert.ok(other, "falta el bloque «Otros»");
  // Los bloques de un solo módulo acaban en «Otros».
  assert.equal(level0.blockOf.get("g10m0"), OTHER_BLOCK_ID);
  assert.equal(level0.blockOf.get("g11m0"), OTHER_BLOCK_ID);
  // Todos los módulos pertenecen a exactamente un bloque.
  const total = level0.blocks.reduce((sum, block) => sum + block.moduleIds.length, 0);
  assert.equal(total, prepared.graph.modules.length);
  // El más grande va primero y muestra sus módulos más conectados.
  assert.equal(level0.blocks[0]?.id, "group:g0");
  assert.equal(level0.blocks[0]?.sample[0], "g0m0");
});

test("Level 0 agrega aristas entre bloques y descarta las internas", () => {
  const level0 = buildLevel0(prepareGraph(fixture([4, 3, 3])));
  assert.deepEqual(
    level0.edges.map((edge) => [edge.source, edge.target, edge.weight]),
    [
      ["group:g0", "group:g1", 1],
      ["group:g0", "group:g2", 1],
    ],
  );
  const graph = fixture([4, 3, 3]);
  // Una segunda dependencia g0 → g1 engorda la misma arista agregada.
  graph.edges.push({ id: "extra", source: "g0m3", target: "g1m2", kind: "imports" });
  const heavier = buildLevel0(prepareGraph(graph));
  assert.equal(heavier.edges.find((edge) => edge.target === "group:g1")?.weight, 2);
});

test("los subsistemas visibles son bloques propios, por encima de la carpeta", () => {
  const graph = fixture([6, 6]);
  graph.subsystems = [{ id: "data", label: "Datos", color: "emerald" }];
  graph.modules = graph.modules.map((item) => (item.id === "g1m0" || item.id === "g1m1" ? { ...item, subsystem: "data" } : item));
  const level0 = buildLevel0(prepareGraph(graph));
  assert.equal(level0.blockOf.get("g1m0"), "sub:data");
  assert.equal(level0.blockOf.get("g1m2"), "group:g1");
  assert.equal(level0.blocks.find((block) => block.id === "sub:data")?.label, "Datos");
});

test("una carpeta dominante se parte por subcarpetas", () => {
  const graph = fixture([14, 2]);
  graph.modules = graph.modules.map((item, index) =>
    item.groupId === "g0" ? { ...item, filePath: `src/g0/${index % 2 === 0 ? "users" : "billing"}/${item.id}.ts` } : item,
  );
  const level0 = buildLevel0(prepareGraph(graph));
  const ids = level0.blocks.map((block) => block.id);
  assert.ok(ids.includes("group:g0/users"));
  assert.ok(ids.includes("group:g0/billing"));
});

test("grafos pequeños o de un solo bloque se saltan Level 0", () => {
  const small = prepareGraph(fixture([4, 4]));
  assert.equal(shouldUseLevel0(small, buildLevel0(small)), false);
  const single = prepareGraph(fixture([13]));
  assert.equal(shouldUseLevel0(single, buildLevel0(single)), false);
});

test("drill-down: focusPrepared deja solo los módulos del bloque y sus aristas internas", () => {
  const prepared = prepareGraph(fixture([5, 4, 4]));
  const level0 = buildLevel0(prepared);
  const block = level0.blocks.find((item) => item.id === "group:g1");
  assert.ok(block);
  const focused = focusPrepared(prepared, block);
  assert.deepEqual(
    focused.graph.modules.map((item) => item.id),
    ["g1m0", "g1m1", "g1m2", "g1m3"],
  );
  assert.ok(focused.graph.edges.every((edge) => edge.source.startsWith("g1") && edge.target.startsWith("g1")));
  assert.equal(focused.graph.edges.length, 3);
  // Simulación e impacto siguen viendo el grafo completo.
  assert.equal(flowEdgeEndpoints(prepared).length, prepared.graph.edges.length);
});

test("level0Flow: un nodo clicable por bloque y aristas entre sus handles", () => {
  const level0 = buildLevel0(prepareGraph(fixture([6, 4, 4])));
  const flow = level0Flow(level0, layoutLevel0(level0));
  assert.equal(flow.nodes.length, level0.blocks.length);
  assert.ok(flow.nodes.every((node) => node.type === "subsystem" && node.data.level0 !== undefined));
  const ids = new Set(flow.nodes.map((node) => node.id));
  assert.ok(flow.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)));
});

/** Monorepo multiparte al estilo PISD: cada parte es una cadena interna y todas usan la infraestructura. */
function partsFixture(sizes: Readonly<Record<string, number>>, extra: CodeModule[] = []): CodeGraph {
  const modules: CodeModule[] = [];
  const edges: ModuleEdge[] = [];
  const edge = (source: string, target: string) => edges.push({ id: `${source}->${target}`, source, target, kind: "imports" });
  const infra: CodeModule = { id: "infra:mongodb", label: "MongoDB", filePath: "docker-compose.yml", groupId: "infra", language: "yaml", role: "database", tech: ["mongodb"], subBlocks: [] };
  modules.push(infra);
  for (const [part, size] of Object.entries(sizes)) {
    for (let index = 0; index < size; index += 1) {
      const sub = index % 2 === 0 ? "web" : "bff";
      const filePath = size > 15 ? `${part}/${sub}/m${index}.py` : `${part}/m${index}.py`;
      modules.push({ id: filePath, label: `m${index}`, filePath, groupId: part, language: "python", role: "code", tech: ["fastapi"], subBlocks: [] });
      if (index > 0) edge(modules[modules.length - 2]!.id, filePath);
    }
    edge(`${part}/${size > 15 ? "web/" : ""}m0.py`, infra.id);
  }
  for (const item of extra) {
    modules.push(item);
    edge(item.id, infra.id);
  }
  return {
    version: 1,
    projectName: "pisd",
    groups: [
      { id: "parte1_gestos", label: "Reconocimiento de gestos", color: "sky", summary: "Gestos con MediaPipe" },
      { id: "parte2_plataforma", label: "parte2_plataforma", color: "violet" },
      { id: "infra", label: "Infraestructura", color: "zinc" },
    ],
    modules,
    edges,
  };
}

test("monorepo multiparte: un bloque por parte, nombre humano, infra aparte y lo periférico en «Otros»", () => {
  const tests: CodeModule = { id: "tests/test_x.py", label: "Test X", filePath: "tests/test_x.py", groupId: "tests", language: "python", subBlocks: [] };
  const graph = partsFixture({ parte1_gestos: 5, parte2_plataforma: 6, parte3_chatbot: 4 }, [tests]);
  const level0 = buildLevel0(prepareGraph(graph));
  const byId = new Map(level0.blocks.map((block) => [block.id, block]));
  assert.equal(byId.get("part:parte1_gestos")?.label, "Reconocimiento de gestos");
  assert.equal(byId.get("part:parte1_gestos")?.summary, "Gestos con MediaPipe");
  assert.equal(byId.get("part:parte2_plataforma")?.label, "Plataforma", "sin label propio: carpeta humanizada");
  assert.equal(byId.get("part:parte3_chatbot")?.label, "Chatbot");
  assert.equal(byId.get("part:infra")?.label, "Infraestructura");
  assert.deepEqual(byId.get("part:infra")?.tech, ["MongoDB"]);
  assert.deepEqual(byId.get("part:parte2_plataforma")?.tech, ["FastAPI"]);
  assert.equal(level0.blockOf.get("tests/test_x.py"), OTHER_BLOCK_ID);
  assert.ok(!level0.blocks.some((block) => block.id.startsWith("sub:")), "en modo partes no mandan los subsistemas genéricos");
});

test("monorepo multiparte: una parte de más de 15 módulos se parte por subcarpeta si cabe", () => {
  const graph = partsFixture({ parte4_frontend: 40, parte2_plataforma: 6, parte3_chatbot: 4 });
  const level0 = buildLevel0(prepareGraph(graph));
  const ids = level0.blocks.map((block) => block.id);
  assert.ok(ids.includes("part:parte4_frontend/web"), ids.join(", "));
  assert.ok(ids.includes("part:parte4_frontend/bff"), ids.join(", "));
  assert.ok(!ids.includes("part:parte4_frontend"));
  assert.ok(level0.blocks.every((block) => block.size <= 20));
  assert.equal(level0.blocks.find((block) => block.id === "part:parte4_frontend/bff")?.label, "Frontend · BFF");
  assert.ok(level0.blocks.length <= LEVEL0_MAX_BLOCKS);
});

test("sampleLabel antepone la carpeta a nombres genéricos y la muestra no repite", () => {
  assert.equal(sampleLabel({ label: "App", filePath: "parte2_plataforma/captura/app.py" }), "Captura App");
  assert.equal(sampleLabel({ label: "Index", filePath: "web/src/pages/index.tsx" }), "Pages Index");
  assert.equal(sampleLabel({ label: "Recuperador", filePath: "rag/recuperador.py" }), "Recuperador");
  const graph = fixture([13, 2]);
  graph.modules = graph.modules.map((item) => (item.groupId === "g0" ? { ...item, label: "Index", filePath: `src/g0/index.ts` } : item));
  const block = buildLevel0(prepareGraph(graph)).blocks.find((item) => item.id === "group:g0");
  assert.deepEqual(block?.sample, ["G0 Index"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph, CodeModule, ModuleEdge } from "@core/graph";
import { abstractView } from "./abstractions";
import { filterNoise, isArchitectureModule, isUiSurface, pruneNonArchitectural, serviceLabel, skeletonBlocks } from "./architectureSkeleton";
import { buildSystemScenario, buildSystemScenarios, STEP_TITLE_SEPARATOR } from "@/features/simulation/lib/systemScenario";
import { archResolutionFor, blockNeighbours, buildLevel0, focusPrepared, layoutLevel0, level0Flow, SYSTEM_LAYER, systemLayers } from "./level0";
import { prepareGraph } from "./subsystems";

function code(filePath: string, extra: Partial<CodeModule> = {}): CodeModule {
  const label = (filePath.split("/").pop() ?? filePath).replace(/\.\w+$/, "");
  return { id: filePath, label, filePath, groupId: filePath.split("/")[0] ?? "root", language: "python", role: "code", subBlocks: [], ...extra };
}

function infra(tech: string, label: string, role: CodeModule["role"]): CodeModule {
  return { id: `infra:${tech}`, label, filePath: "docker-compose.yml", groupId: "infra", language: "yaml", role, tech: [tech], subBlocks: [] };
}

/**
 * Sistema estilo PISD: captura → Redpanda → Spark → MongoDB → acceso → chatbot; un BFF con su SPA; gestos sin
 * servicio; tests y `__init__` como ruido.
 */
function pisd(): CodeGraph {
  const modules: CodeModule[] = [
    infra("redpanda", "Redpanda", "broker"),
    infra("spark", "Spark", "stream"),
    infra("mongodb", "MongoDB", "database"),
    code("plataforma/captura/app.py", { role: "api", service: "captura" }),
    code("plataforma/acceso/app.py", { role: "api", service: "acceso" }),
    code("plataforma/acceso/repositorio.py", { role: "database" }),
    code("plataforma/acceso/__init__.py"),
    code("plataforma/comun/esquema.py"),
    code("plataforma/s3/crear_buckets.py", { service: "s3-init" }),
    code("plataforma/spark/job.py", { role: "stream" }),
    code("chatbot/app.py", { role: "app", service: "chatbot" }),
    code("chatbot/agente.py", { role: "ai-model" }),
    code("chatbot/herramientas.py"),
    code("portal/bff/app.py", { role: "api", service: "frontend" }),
    code("portal/bff/rutas.py", { role: "api" }),
    code("portal/web/src/main.tsx", { language: "typescript", role: "ui" }),
    code("portal/web/src/App.tsx", { language: "typescript", role: "ui" }),
    code("gestos/demo.py"),
    code("gestos/modelo.py", { role: "ai-model" }),
    code("gestos/extraccion.py"),
    code("tests/test_acceso.py"),
  ];
  const pairs: Array<[string, string, ModuleEdge["kind"]]> = [
    ["plataforma/captura/app.py", "infra:redpanda", "data-flow"],
    ["plataforma/captura/app.py", "plataforma/comun/esquema.py", "imports"],
    ["infra:spark", "infra:redpanda", "data-flow"],
    ["infra:spark", "infra:mongodb", "data-flow"],
    ["plataforma/spark/job.py", "infra:spark", "calls"],
    ["plataforma/acceso/app.py", "plataforma/acceso/__init__.py", "imports"],
    ["plataforma/acceso/__init__.py", "plataforma/acceso/repositorio.py", "imports"],
    ["plataforma/acceso/repositorio.py", "infra:mongodb", "data-flow"],
    ["plataforma/s3/crear_buckets.py", "plataforma/comun/esquema.py", "imports"],
    ["chatbot/app.py", "chatbot/agente.py", "imports"],
    ["chatbot/agente.py", "chatbot/herramientas.py", "imports"],
    ["chatbot/app.py", "plataforma/acceso/app.py", "calls"],
    ["portal/bff/app.py", "portal/bff/rutas.py", "imports"],
    ["portal/bff/rutas.py", "plataforma/acceso/app.py", "calls"],
    ["portal/web/src/main.tsx", "portal/web/src/App.tsx", "imports"],
    ["gestos/demo.py", "gestos/modelo.py", "imports"],
    ["gestos/modelo.py", "gestos/extraccion.py", "imports"],
    ["tests/test_acceso.py", "plataforma/acceso/app.py", "imports"],
  ];
  const edges: ModuleEdge[] = pairs.map(([source, target, kind]) => ({ id: `${kind}:${source}:${target}`, source, target, kind }));
  return {
    version: 1,
    projectName: "pisd",
    groups: [
      { id: "gestos", label: "Reconocimiento de gestos", color: "sky", summary: "Gestos con MediaPipe" },
      { id: "infra", label: "Infraestructura", color: "zinc" },
    ],
    modules,
    edges,
  };
}

test("isArchitectureModule descarta __init__, tests y configs; la infra siempre cuenta", () => {
  assert.equal(isArchitectureModule(code("pkg/__init__.py")), false);
  assert.equal(isArchitectureModule(code("tests/test_api.py")), false);
  assert.equal(isArchitectureModule(code("pkg/test_utils.py")), false);
  assert.equal(isArchitectureModule(code("web/vite.config.ts")), false);
  assert.equal(isArchitectureModule(code("web/src/Button.stories.tsx")), false);
  assert.equal(isArchitectureModule(code("pkg/api/app.py")), true);
  assert.equal(isArchitectureModule(infra("mongodb", "MongoDB", "database")), true);
});

test("serviceLabel: nombre humano y «API x» para las APIs", () => {
  assert.equal(serviceLabel("acceso", "api"), "API acceso");
  assert.equal(serviceLabel("chatbot-rag", "app"), "Chatbot RAG");
  assert.equal(serviceLabel("frontend", "api"), "Frontend");
  assert.equal(serviceLabel("api-gateway", "api"), "API gateway");
});

test("skeletonBlocks: un nodo por infra y por servicio; las carpetas del monorepo no son el eje", () => {
  const blocks = skeletonBlocks(prepareGraph(pisd()));
  assert.ok(blocks);
  const byLabel = new Map(blocks.map((block) => [block.label, block]));
  assert.deepEqual(
    blocks.map((block) => `${block.kind}:${block.label}`).sort(),
    [
      "infra:MongoDB",
      "infra:Redpanda",
      "infra:Spark",
      "part:Reconocimiento de gestos",
      "service:API acceso",
      "service:API captura",
      "service:Chatbot",
    ],
  );
  const ids = (label: string) => byLabel.get(label)?.modules.map((item) => item.id).sort();
  // BFS por imports (a través de __init__) + carpeta del servicio.
  assert.deepEqual(ids("API acceso"), ["plataforma/acceso/__init__.py", "plataforma/acceso/app.py", "plataforma/acceso/repositorio.py"]);
  assert.deepEqual(ids("API captura"), ["plataforma/captura/app.py", "plataforma/comun/esquema.py"]);
  assert.deepEqual(ids("Chatbot"), ["chatbot/agente.py", "chatbot/app.py", "chatbot/herramientas.py"]);
  // BFF / portal / SPA: periferia de UI, fuera del mapa de sistema.
  assert.ok(!blocks.some((block) => /front|portal|bff/i.test(block.label)));
  // Los jobs que ejecuta Spark viven en su nodo.
  assert.deepEqual(ids("Spark"), ["infra:spark", "plataforma/spark/job.py"]);
  // Una parte sin servicio desplegado queda como un nodo de app con la descripción del README.
  assert.equal(byLabel.get("Reconocimiento de gestos")?.summary, "Gestos con MediaPipe");
  // El trabajo de arranque (`s3-init`) y los tests no son nodos.
  assert.ok(!blocks.some((block) => block.modules.some((item) => item.id.startsWith("tests/"))));
  assert.ok(!blocks.some((block) => /s3|init/i.test(block.label)));
});

test("skeletonBlocks: sin servicios del compose no hay esqueleto (sigue el Level 0 por partes)", () => {
  const graph = pisd();
  for (const item of graph.modules) delete item.service;
  assert.equal(skeletonBlocks(prepareGraph(graph)), null);
});

test("buildLevel0 en modo sistema: nodos compactos, aristas entre servicios y un solo módulo = selección", () => {
  const prepared = prepareGraph(pisd());
  const level0 = buildLevel0(prepared);
  assert.equal(level0.style, "system");
  const idOf = (label: string) => level0.blocks.find((block) => block.label === label)?.id ?? "";
  const edges = level0.edges.map((edge) => `${edge.source}→${edge.target}`);
  assert.ok(edges.includes(`${idOf("API captura")}→${idOf("Redpanda")}`));
  assert.ok(edges.includes(`${idOf("Spark")}→${idOf("MongoDB")}`));
  assert.ok(edges.includes(`${idOf("Chatbot")}→${idOf("API acceso")}`));
  assert.ok(!idOf("Frontend"), "Frontend/BFF no entra en el mapa de sistema");
  // `size` cuenta solo módulos con peso: el __init__ de acceso no.
  assert.equal(level0.blocks.find((block) => block.label === "API acceso")?.size, 2);

  const flow = level0Flow(level0, layoutLevel0(level0));
  const mongo = flow.nodes.find((node) => node.type === "subsystem" && node.data.label === "MongoDB");
  assert.equal(mongo?.type === "subsystem" ? mongo.data.level0?.primaryModuleId : undefined, "infra:mongodb");
  const acceso = flow.nodes.find((node) => node.type === "subsystem" && node.data.label === "API acceso");
  assert.equal(acceso?.type === "subsystem" ? acceso.data.level0?.primaryModuleId : "x", undefined, "con varios módulos, click = detalle");
  assert.ok(flow.edges.every((edge) => edge.label === undefined), "sin números en las aristas del esqueleto");

  const neighbours = blockNeighbours(level0, idOf("API acceso")).map((item) => `${item.direction}:${item.block.label}`);
  assert.deepEqual(neighbours.sort(), ["in:Chatbot", "out:MongoDB"]);
});

test("focusPrepared: sin ruido, con el hilo a través de __init__ y la infra vecina (solo la directa)", () => {
  const prepared = prepareGraph(pisd());
  const level0 = buildLevel0(prepared);
  const acceso = level0.blocks.find((block) => block.label === "API acceso");
  assert.ok(acceso);
  const focused = focusPrepared(prepared, acceso);
  assert.deepEqual(focused.graph.modules.map((item) => item.id).sort(), ["infra:mongodb", "plataforma/acceso/app.py", "plataforma/acceso/repositorio.py"]);
  assert.ok(focused.graph.edges.some((edge) => edge.source === "plataforma/acceso/app.py" && edge.target === "plataforma/acceso/repositorio.py"));
});

test("filterNoise no vacía una vista que solo tiene ruido", () => {
  const graph: CodeGraph = {
    version: 1,
    projectName: "t",
    groups: [{ id: "tests", label: "tests", color: "sky" }],
    modules: [code("tests/test_a.py"), code("tests/test_b.py")],
    edges: [{ id: "e", source: "tests/test_a.py", target: "tests/test_b.py", kind: "imports" }],
  };
  const prepared = prepareGraph(graph);
  assert.equal(filterNoise(prepared).graph.modules.length, 2);
});

test("archResolutionFor: lejos solo nombres, cerca los módulos clave", () => {
  assert.equal(archResolutionFor(0.4), 0);
  assert.equal(archResolutionFor(0.9), 1);
  assert.equal(archResolutionFor(1.3), 2);
});

/** PISD de la fase 3: además hay un indexador en la carpeta del RAG, Airflow con su Postgres y Grafana sobre Prometheus. */
function pisdFull(): CodeGraph {
  const graph = pisd();
  const add = (item: CodeModule) => graph.modules.push(item);
  const link = (source: string, target: string, kind: ModuleEdge["kind"] = "imports", label?: string) =>
    graph.edges.push({ id: `${kind}:${source}:${target}`, source, target, kind, ...(label ? { label } : {}) });
  add(infra("qdrant", "Qdrant", "database"));
  add(infra("ollama", "Ollama", "ai-model"));
  add({ ...infra("airflow", "Airflow", "pipeline"), subBlocks: [{ id: "a", kind: "block", name: "airflow-apiserver", range: { startLine: 1, endLine: 2 } }] });
  add({ ...infra("postgres", "PostgreSQL", "database"), subBlocks: [{ id: "p", kind: "block", name: "airflow-db", range: { startLine: 3, endLine: 4 } }] });
  add({ ...infra("seaweedfs", "SeaweedFS · S3", "database"), subBlocks: [{ id: "s", kind: "block", name: "s3", range: { startLine: 5, endLine: 6 } }] });
  add(infra("prometheus", "Prometheus", "util"));
  add(infra("grafana", "Grafana", "util"));
  add(code("rag/app.py", { role: "app", service: "chatbot-rag", tech: ["chainlit"] }));
  add(code("rag/agente_rag.py", { role: "ai-model", tech: ["langchain"] }));
  add(code("rag/recuperador.py", { role: "database", tech: ["qdrant"] }));
  add(code("rag/prompts_rag.py", { role: "prompt" }));
  add(code("rag/indexar.py", { role: "code", service: "rag-indexar" }));
  add(code("rag/__init__.py"));
  add(code("rag/config.py"));
  link("rag/app.py", "rag/agente_rag.py");
  link("rag/app.py", "rag/__init__.py");
  link("rag/__init__.py", "rag/config.py");
  link("rag/agente_rag.py", "rag/recuperador.py");
  link("rag/agente_rag.py", "rag/prompts_rag.py");
  link("rag/indexar.py", "rag/recuperador.py");
  link("rag/recuperador.py", "infra:qdrant", "data-flow");
  link("rag/agente_rag.py", "infra:ollama", "calls");
  link("rag/app.py", "plataforma/acceso/app.py", "calls", "HTTP");
  link("infra:airflow", "infra:postgres", "data-flow");
  link("infra:airflow", "infra:seaweedfs", "data-flow");
  link("infra:airflow", "infra:spark", "calls");
  link("infra:grafana", "infra:prometheus", "calls");
  link("plataforma/acceso/app.py", "infra:prometheus", "calls");
  link("plataforma/captura/app.py", "infra:prometheus", "calls");
  return graph;
}

test("fase 3 · L0 = solo servicios: nada de Portal gigante ni «Otros», cada tecnología una vez", () => {
  const level0 = buildLevel0(prepareGraph(pisdFull()));
  const labels = level0.blocks.map((block) => block.label);
  for (const expected of ["Spark", "MongoDB", "Redpanda", "Qdrant", "Ollama", "API captura", "API acceso", "Chatbot", "Chatbot RAG"]) {
    assert.ok(labels.includes(expected), `falta ${expected}: ${labels.join(", ")}`);
  }
  assert.ok(!labels.some((label) => /front|portal|bff|corporativo/i.test(label)), "UI/BFF/portal fuera del mapa");
  assert.ok(!level0.blocks.some((block) => block.id === "other" || /^otros$/i.test(block.label)), "«Otros» no es arquitectura");
  // Cada tecnología aparece una vez: Airflow con su Postgres dentro; Grafana junto a Prometheus.
  assert.equal(labels.filter((label) => /airflow/i.test(label)).length, 1);
  assert.ok(!labels.includes("PostgreSQL"), "el Postgres de Airflow no es un nodo del sistema");
  assert.ok(labels.includes("Prometheus · Grafana"));
  // El S3 que solo toca Airflow sigue siendo un nodo: es el data lake, no una pieza interna.
  assert.ok(labels.includes("SeaweedFS · S3"));
  // El indexador vive en la carpeta del RAG: un solo servicio lógico.
  assert.ok(!labels.some((label) => /indexar/i.test(label)));
  assert.equal(new Set(labels).size, labels.length, "etiquetas únicas");
});

test("fase 3 · drill = abstracciones: Chatbot RAG → Agente / LLM, Recuperación, Prompts + Qdrant y Ollama", () => {
  const prepared = prepareGraph(pisdFull());
  const level0 = buildLevel0(prepared);
  const rag = level0.blocks.find((block) => block.label === "Chatbot RAG");
  assert.ok(rag);
  const view = abstractView(prepared, rag.moduleIds);
  const labels = view.graph.modules.map((item) => item.label);
  assert.ok(labels.includes("Agente / LLM (LangChain)"), labels.join(", "));
  assert.ok(labels.includes("Recuperación (RAG)"));
  assert.ok(labels.includes("Qdrant"));
  assert.ok(labels.includes("Ollama"));
  const facets = view.graph.modules.filter((item) => !item.id.startsWith("infra:"));
  assert.ok(facets.length >= 2 && facets.length <= 5, `${facets.length} abstracciones`);
  // Nunca archivos sueltos ni ruido: ni __init__, ni config, ni nombres de archivo como nodo.
  assert.ok(!labels.some((label) => /init|config|\.py/i.test(label)));
  // Cada abstracción es un módulo real (seleccionarla abre su código) y resume sus archivos.
  const retrieval = view.graph.modules.find((item) => item.label === "Recuperación (RAG)");
  assert.equal(retrieval?.id, "rag/recuperador.py");
  assert.ok(view.graph.edges.some((edge) => edge.source === "rag/recuperador.py" && edge.target === "infra:qdrant"));
  assert.deepEqual(level0.blocks.find((block) => block.label === "Chatbot RAG")?.facets.slice(0, 2), ["Agente / LLM (LangChain)", "Recuperación (RAG)"]);
});

test("fase 3 · Gestos se abre como modelo y datos, no como carpeta de archivos", () => {
  const graph = pisdFull();
  graph.modules = graph.modules.map((item) =>
    item.id === "gestos/modelo.py" ? { ...item, tech: ["keras", "mediapipe"] } : item.id === "gestos/extraccion.py" ? { ...item, role: "code" } : item,
  );
  const prepared = prepareGraph(graph);
  const gestos = buildLevel0(prepared).blocks.find((block) => block.kind === "part");
  assert.ok(gestos);
  const labels = abstractView(prepared, gestos.moduleIds).graph.modules.map((item) => item.label);
  assert.ok(labels.includes("Modelo ML (Keras, MediaPipe)"), labels.join(", "));
  assert.ok(labels.includes("Datos y preprocesado"), labels.join(", "));
});

test("fase 3 · un grafo importado antes de `service` también da el esqueleto (por las aristas del compose)", () => {
  const graph = pisdFull();
  for (const item of graph.modules) delete item.service;
  graph.edges.push(
    { id: "c1", source: "plataforma/captura/app.py", target: "infra:redpanda", kind: "data-flow", label: "depends_on" },
    { id: "c2", source: "chatbot/app.py", target: "plataforma/acceso/app.py", kind: "calls", label: "HTTP" },
  );
  const level0 = buildLevel0(prepareGraph(graph));
  assert.equal(level0.style, "system");
  const labels = level0.blocks.map((block) => block.label);
  assert.ok(labels.includes("API acceso") && labels.includes("API captura") && labels.includes("Chatbot"), labels.join(", "));
});

test("fase 4 · capas LR: entrada → ingesta → cola → procesado → almacenamiento → API → consumidores → observabilidad", () => {
  const level0 = buildLevel0(prepareGraph(pisdFull()));
  const layers = systemLayers(level0);
  const layerOf = (label: string) => layers.get(level0.blocks.find((block) => block.label === label)?.id ?? "") ?? -1;
  assert.equal(layerOf("Reconocimiento de gestos"), SYSTEM_LAYER.entry);
  assert.equal(layerOf("API captura"), SYSTEM_LAYER.ingest);
  assert.equal(layerOf("Redpanda"), SYSTEM_LAYER.queue);
  assert.equal(layerOf("Spark"), SYSTEM_LAYER.process);
  assert.equal(layerOf("Airflow"), SYSTEM_LAYER.process);
  assert.equal(layerOf("MongoDB"), SYSTEM_LAYER.store);
  assert.equal(layerOf("Qdrant"), SYSTEM_LAYER.store);
  assert.equal(layerOf("API acceso"), SYSTEM_LAYER.api);
  assert.equal(layerOf("Chatbot"), SYSTEM_LAYER.consumers);
  assert.equal(layerOf("Chatbot RAG"), SYSTEM_LAYER.consumers);
  assert.equal(layerOf("Prometheus · Grafana"), SYSTEM_LAYER.observability);

  // Columnas de izquierda a derecha en ese orden, sin huecos.
  const positions = layoutLevel0(level0);
  const x = (label: string) => positions.get(level0.blocks.find((block) => block.label === label)?.id ?? "")?.x ?? Number.NaN;
  const chain = ["API captura", "Redpanda", "Spark", "MongoDB", "API acceso", "Chatbot", "Prometheus · Grafana"].map(x);
  assert.deepEqual([...chain].sort((left, right) => left - right), chain);
  assert.equal(new Set(chain).size, chain.length);

  // La flecha sigue al dato: «Spark usa Redpanda» se dibuja Redpanda → Spark; «Chatbot usa API acceso», API acceso → Chatbot.
  const flow = level0Flow(level0, positions);
  const name = new Map(level0.blocks.map((block) => [`subsystem:${block.id}`, block.label]));
  const arrows = flow.edges.map((edge) => `${name.get(edge.source)}→${name.get(edge.target)}`);
  assert.ok(arrows.includes("Redpanda→Spark"), arrows.join(", "));
  assert.ok(arrows.includes("API acceso→Chatbot"), arrows.join(", "));
  assert.ok(arrows.includes("API captura→Redpanda"));
});

test("fase 5 · pruneNonArchitectural: fuera tests, __init__, configs, ejemplos y huérfanos; el hilo se conserva", () => {
  const graph = pisdFull();
  graph.modules.push(code("scripts/informe.py"), code("examples/demo_api.py"), code("web/vite.config.ts"));
  graph.edges.push({ id: "e:ex", source: "examples/demo_api.py", target: "plataforma/acceso/app.py", kind: "imports" });
  const pruned = pruneNonArchitectural(graph);
  const ids = new Set(pruned.modules.map((item) => item.id));
  for (const gone of ["tests/test_acceso.py", "plataforma/acceso/__init__.py", "rag/__init__.py", "scripts/informe.py", "examples/demo_api.py", "web/vite.config.ts"]) {
    assert.ok(!ids.has(gone), `${gone} debería omitirse`);
  }
  // Infra y entradas de servicio se quedan aunque estén sueltas; el resto del sistema, intacto.
  for (const kept of ["infra:mongodb", "infra:redpanda", "plataforma/acceso/app.py", "plataforma/acceso/repositorio.py", "chatbot/agente.py"]) {
    assert.ok(ids.has(kept), `${kept} debería seguir`);
  }
  // app → __init__ → repositorio queda como app → repositorio.
  assert.ok(pruned.edges.some((edge) => edge.source === "plataforma/acceso/app.py" && edge.target === "plataforma/acceso/repositorio.py"));
  assert.ok(pruned.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)));
  assert.equal(pruned.omitted?.count, pruned.omitted?.paths.length);
  assert.ok(pruned.omitted?.paths.includes("tests/test_acceso.py"));
  // Sin módulos sueltos: nada que el lienzo tenga que esconder.
  assert.equal(prepareGraph(pruned).hidden.filter((item) => !item.id.startsWith("infra:")).length, 0);
});

test("fase 5 · pruneNonArchitectural no deja sin mapa un repo pequeño sin imports resolubles", () => {
  const graph: CodeGraph = {
    version: 1,
    projectName: "mini",
    groups: [{ id: "src", label: "src", color: "sky" }],
    modules: [code("src/a.py"), code("src/b.py"), code("src/__init__.py")],
    edges: [],
  };
  const pruned = pruneNonArchitectural(graph);
  assert.deepEqual(pruned.modules.map((item) => item.id), ["src/a.py", "src/b.py"]);
});

test("fase 5 · recorrido de sistema: servicios de Level 0 en orden de dato, con narración", () => {
  const level0 = buildLevel0(prepareGraph(pisdFull()));
  const scenario = buildSystemScenario(level0, pisdFull());
  assert.ok(scenario, "debe existir escenario de sistema");
  const names = scenario.steps.map((step) => step.title.split(STEP_TITLE_SEPARATOR)[0]);
  assert.deepEqual(names.slice(0, 6), ["API captura", "Redpanda", "Spark", "MongoDB", "API acceso", "Chatbot"]);
  const nodeIds = new Set(level0Flow(level0, layoutLevel0(level0)).nodes.map((node) => node.id));
  const edgeIds = new Set(level0.edges.map((edge) => edge.id));
  assert.ok(scenario.steps.every((step) => nodeIds.has(step.nodeId)), "pasos = nodos L0");
  for (const step of scenario.steps.slice(0, -1)) {
    assert.ok(step.edgeIdToNext !== undefined && edgeIds.has(step.edgeIdToNext), `arista ${step.edgeIdToNext} desde ${step.title}`);
  }
  assert.equal(scenario.entryNodeId, scenario.steps[0]?.nodeId);
  assert.match(scenario.steps[1]?.description ?? "", /Desacopla la captura del procesado|absorbe picos/i);
  assert.match(scenario.steps[0]?.description ?? "", /Redpanda|valida el esquema|publica/i);
  assert.equal(typeof scenario.steps[0]?.mockPayload.output, "object");
  assert.ok(
    scenario.steps.every((step) => typeof step.mockPayload.output === "object" && step.mockPayload.output !== null),
    "cada paso lleva un payload JSON de ejemplo (no una frase suelta)",
  );
  const last = scenario.steps[scenario.steps.length - 1]!;
  assert.ok(
    typeof last.mockPayload.output === "object" &&
      last.mockPayload.output !== null &&
      ("text" in last.mockPayload.output || "prompt_para_llm" in last.mockPayload.output || "finish_reason" in last.mockPayload.output || "body" in last.mockPayload.output),
    "el último paso deja un resultado concreto",
  );
  assert.equal(buildSystemScenario(level0, pisdFull(), "en")?.name, "Data journey");
});

test("fase 5 · varios flujos de sistema (dato, pregunta, lote)", () => {
  const level0 = buildLevel0(prepareGraph(pisdFull()));
  const list = buildSystemScenarios(level0, pisdFull());
  assert.ok(list.length >= 2, `esperaba ≥2 escenarios, hay ${list.length}`);
  assert.ok(list.some((item) => item.id === "system-flow"));
  assert.ok(list.some((item) => item.id === "system-query" || item.id === "system-batch"));
});

test("isUiSurface: portal corporativo / frontend no son arquitectura", () => {
  assert.equal(isUiSurface("parte4_frontend", "Portal corporativo web"), true);
  assert.equal(isUiSurface("portal", "Portal web corporativo"), true);
  assert.equal(isUiSurface("gestos", "Reconocimiento de gestos"), false);
});

test("vista Arquitectura: el mismo mapa de sistema con cada servicio desplegado en sus abstracciones", () => {
  const prepared = prepareGraph(pisdFull());
  const level0 = buildLevel0(prepared);
  const compact = level0Flow(level0, layoutLevel0(level0));
  const expanded = level0Flow(level0, layoutLevel0(level0, { expanded: true }), { expanded: true });
  // Mismos nodos y flechas que «Sistema»: cambiar de vista no cambia el mapa, solo cuánto se ve de cada servicio.
  assert.deepEqual(expanded.nodes.map((node) => node.id), compact.nodes.map((node) => node.id));
  assert.deepEqual(expanded.edges.map((edge) => edge.id), compact.edges.map((edge) => edge.id));
  const byLabel = new Map(expanded.nodes.map((node) => [node.type === "subsystem" ? node.data.label : node.id, node]));
  const rag = byLabel.get("Chatbot RAG");
  assert.ok(rag && rag.type === "subsystem");
  assert.equal(rag.data.level0?.expanded, true);
  assert.ok((rag.data.level0?.facets.length ?? 0) >= 2 && (rag.data.level0?.facets.length ?? 0) <= 5);
  assert.ok((rag.height ?? 0) > (compact.nodes.find((node) => node.id === rag.id)?.height ?? 0), "el nodo crece para listar sus componentes");
  // La infra (sin abstracciones) no crece, y las columnas no se solapan al desplegar.
  const mongo = byLabel.get("MongoDB");
  assert.equal(mongo?.height, compact.nodes.find((node) => node.id === mongo?.id)?.height);
  const positions = layoutLevel0(level0, { expanded: true });
  const heightOf = new Map(expanded.nodes.map((node) => [node.id.replace("subsystem:", ""), node.height ?? 0]));
  const columns = new Map<number, Array<{ y: number; h: number }>>();
  for (const [id, point] of positions) columns.set(point.x, [...(columns.get(point.x) ?? []), { y: point.y, h: heightOf.get(id) ?? 0 }]);
  for (const column of columns.values()) {
    column.sort((left, right) => left.y - right.y);
    column.slice(1).forEach((item, index) => assert.ok(item.y >= (column[index]?.y ?? 0) + (column[index]?.h ?? 0), "nodos solapados"));
  }
});

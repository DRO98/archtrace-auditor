import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph, CodeModule, ModuleEdge } from "@core/graph";
import { architectureCheck, splitForPlan, stronglyConnected, sortFindings, type Finding } from "./lib/architectureCheck";
import { detectDrift } from "./lib/drift";

const mod = (id: string, role?: CodeModule["role"]): CodeModule => ({
  id,
  label: id.split("/").pop() ?? id,
  filePath: id,
  groupId: "g",
  language: "typescript",
  subBlocks: [],
  ...(role ? { role } : {}),
});

function graphOf(modules: CodeModule[], pairs: Array<[string, string]>): CodeGraph {
  const edges: ModuleEdge[] = pairs.map(([source, target]) => ({ id: `${source}->${target}`, source, target, kind: "imports" }));
  return { version: 1, projectName: "fixture", groups: [{ id: "g", label: "g", color: "sky" }], modules, edges };
}

/** Ciclo a→b→c→a, un hub con 9 consumidores, una capa invertida (db → api) y un huérfano. */
function fixture(): CodeGraph {
  const consumers = Array.from({ length: 9 }, (_, index) => mod(`src/feature${index}.ts`, "service"));
  const modules = [
    mod("src/a.ts", "service"),
    mod("src/b.ts", "service"),
    mod("src/c.ts", "service"),
    mod("src/hub.ts", "service"),
    mod("src/api/orders.ts", "api"),
    mod("src/db/orders.ts", "database"),
    mod("src/lonely.ts", "service"),
    ...consumers,
  ];
  return graphOf(modules, [
    ["src/a.ts", "src/b.ts"],
    ["src/b.ts", "src/c.ts"],
    ["src/c.ts", "src/a.ts"],
    ...consumers.map((item): [string, string] => [item.id, "src/hub.ts"]),
    ["src/api/orders.ts", "src/db/orders.ts"],
    ["src/db/orders.ts", "src/api/orders.ts"],
  ]);
}

test("stronglyConnected: encuentra los ciclos y deja fuera los nodos acíclicos", () => {
  const out = new Map([
    ["a", new Set(["b"])],
    ["b", new Set(["a", "c"])],
    ["c", new Set<string>()],
  ]);
  assert.deepEqual(stronglyConnected(out).map((component) => component.sort()), [["a", "b"]]);
});

test("architectureCheck: ciclo, hub y capa invertida anclados a módulos reales", () => {
  const findings = architectureCheck(fixture(), { lang: "en" });
  const byKind = (kind: Finding["kind"]) => findings.filter((item) => item.kind === kind);

  const cycles = byKind("cycle");
  assert.equal(cycles.length, 2, "a→b→c→a y api↔db");
  const triangle = cycles.find((item) => item.moduleIds.length === 3);
  assert.ok(triangle);
  assert.equal(triangle.severity, "high");
  assert.deepEqual([...triangle.moduleIds].sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.match(triangle.title, /a\.ts → b\.ts → c\.ts → a\.ts/);

  const hubs = byKind("god-node");
  assert.deepEqual(hubs.map((item) => item.moduleIds[0]), ["src/hub.ts"]);
  assert.match(hubs[0]!.title, /Critical hub/);

  const inversions = byKind("layer-inversion");
  assert.deepEqual(inversions.map((item) => item.moduleIds[0]), ["src/db/orders.ts"]);
  assert.equal(inversions[0]!.severity, "high");

  for (const finding of findings) {
    assert.ok(finding.title && finding.why && finding.fixHint, `texto completo en ${finding.id}`);
    assert.ok(finding.moduleIds.length > 0);
  }
});

test("architectureCheck: el drift entra en la misma lista como drift-*", () => {
  const graph = fixture();
  const findings = architectureCheck(graph, { drift: detectDrift(graph, null), lang: "es" });
  const orphan = findings.find((item) => item.kind === "drift-disconnected");
  assert.ok(orphan);
  assert.deepEqual(orphan.moduleIds, ["src/lonely.ts"]);
  assert.match(orphan.title, /Huérfano/);
});

test("architectureCheck: un grafo sano (cadena por capas, utils compartidos) no da hallazgos", () => {
  const modules = [mod("src/api/users.ts", "api"), mod("src/services/users.ts", "service"), mod("src/db/users.ts", "database"), mod("src/utils/log.ts", "util")];
  const graph = graphOf(modules, [
    ["src/api/users.ts", "src/services/users.ts"],
    ["src/services/users.ts", "src/db/users.ts"],
    ["src/api/users.ts", "src/utils/log.ts"],
    ["src/db/users.ts", "src/utils/log.ts"],
  ]);
  assert.deepEqual(architectureCheck(graph), []);
});

test("sortFindings y splitForPlan: Free enseña el drift y los 3 primeros hallazgos del grafo", () => {
  const finding = (id: string, kind: Finding["kind"], severity: Finding["severity"]): Finding => ({
    id,
    kind,
    severity,
    moduleIds: [id],
    title: id,
    why: "",
    fixHint: "",
  });
  const sorted = sortFindings([
    finding("d", "drift-disconnected", "low"),
    finding("c1", "cycle", "high"),
    finding("h1", "god-node", "medium"),
    finding("i1", "layer-inversion", "medium"),
    finding("i2", "layer-inversion", "high"),
    finding("h2", "god-node", "medium"),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["c1", "i2", "h1", "h2", "i1", "d"]);

  const free = splitForPlan(sorted, 3);
  assert.deepEqual(free.visible.map((item) => item.id), ["c1", "i2", "h1", "d"]);
  assert.equal(free.locked, 2);
  assert.equal(splitForPlan(sorted, Number.POSITIVE_INFINITY).locked, 0);
});

test("architectureCheck: con muchos huérfanos sale UN hallazgo agregado con el núcleo conectado", () => {
  const graph = fixture();
  const lonely = Array.from({ length: 12 }, (_, index) => mod(`scripts/tool${index}.py`, "service"));
  graph.modules.push(...lonely);
  const findings = architectureCheck(graph, { drift: detectDrift(graph, null), lang: "es" });
  const orphans = findings.filter((item) => item.kind === "drift-disconnected");
  assert.equal(orphans.length, 1);
  const [summary] = orphans;
  assert.equal(summary?.id, "drift-disconnected:aggregate");
  assert.deepEqual(summary?.moduleIds, []);
  // 13 huérfanos (12 scripts + src/lonely.ts) y los 15 módulos restantes conectados.
  assert.match(summary?.title ?? "", /^13 módulos sin dependencias en el mapa \(núcleo conectado = 15\)$/);
  assert.match(summary?.why ?? "", /y 8 más/);
  assert.equal(summary?.severity, "low");
});

test("architectureCheck: una llamada entre servicios (calls/data-flow) no es capa invertida y la infra no es hub", () => {
  const consumers = Array.from({ length: 10 }, (_, index) => mod(`src/svc${index}.ts`, "service"));
  const infra: CodeModule = { ...mod("infra:mongodb", "database"), filePath: "docker-compose.yml", groupId: "infra" };
  const worker = mod("src/jobs/indexer.ts", "pipeline");
  const api = mod("src/api/app.ts", "api");
  const graph = graphOf([...consumers, infra, worker, api], consumers.map((item): [string, string] => [item.id, "infra:mongodb"]));
  graph.edges.push({ id: "calls:indexer:api", source: worker.id, target: api.id, kind: "calls", label: "HTTP" });
  const findings = architectureCheck(graph, { lang: "es" });
  assert.deepEqual(findings, []);
});

test("architectureCheck en mapa de sistema: hubs entre servicios sí, hubs de archivos internos y huérfanos no", () => {
  const svc = (id: string, service: string, role: CodeModule["role"] = "api"): CodeModule => ({ ...mod(id, role), service });
  const infraMod = (tech: string, role: CodeModule["role"]): CodeModule => ({ ...mod(`infra:${tech}`, role), filePath: "docker-compose.yml", groupId: "infra", tech: [tech] });
  const tools = Array.from({ length: 10 }, (_, index) => mod(`bot/tool${index}.py`, "service"));
  const modules = [
    infraMod("mongodb", "database"),
    infraMod("redpanda", "broker"),
    infraMod("qdrant", "database"),
    infraMod("ollama", "ai-model"),
    infraMod("prometheus", "util"),
    svc("api/app.py", "acceso"),
    svc("ingest/app.py", "captura"),
    svc("bot/app.py", "chatbot", "app"),
    mod("bot/agente.py", "ai-model"),
    ...tools,
    svc("bff/app.py", "frontend", "app"),
    mod("scripts/lonely.py", "service"),
  ];
  const graph = graphOf(modules, [
    // Hub interno: 10 herramientas usan el agente del chatbot (era «Hub crítico: Agente»).
    ...tools.map((item): [string, string] => [item.id, "bot/agente.py"]),
    ["bot/app.py", "bot/agente.py"],
    ["bot/agente.py", "infra:ollama"],
    ["bot/app.py", "api/app.py"],
    ["api/app.py", "infra:mongodb"],
    ["ingest/app.py", "infra:redpanda"],
    // El BFF habla con 6 servicios: eso sí es un olor de arquitectura.
    ["bff/app.py", "api/app.py"],
    ["bff/app.py", "ingest/app.py"],
    ["bff/app.py", "bot/app.py"],
    ["bff/app.py", "infra:mongodb"],
    ["bff/app.py", "infra:qdrant"],
    ["bff/app.py", "infra:prometheus"],
  ]);
  const findings = architectureCheck(graph, { drift: detectDrift(graph, null), lang: "es" });
  assert.deepEqual(
    findings.map((item) => item.title),
    ["Hace demasiado: Frontend"],
  );
  assert.match(findings[0]?.why ?? "", /Depende de 6 servicios/);
});

test("architectureCheck en mapa de sistema: «sin mapear» y sueltos no son hallazgos; «ya no existe» sí", () => {
  const svc = (id: string, service: string): CodeModule => ({ ...mod(id, "api"), service });
  const infraMod = (tech: string, role: CodeModule["role"]): CodeModule => ({ ...mod(`infra:${tech}`, role), filePath: "docker-compose.yml", groupId: "infra", tech: [tech] });
  const graph = graphOf(
    [infraMod("mongodb", "database"), infraMod("redpanda", "broker"), svc("api/app.py", "acceso"), svc("ingest/app.py", "captura")],
    [
      ["api/app.py", "infra:mongodb"],
      ["ingest/app.py", "infra:redpanda"],
    ],
  );
  const drift = {
    checkedSource: true,
    items: [
      ...Array.from({ length: 300 }, (_, index) => ({ kind: "unmapped" as const, id: `web/src/c${index}.tsx`, label: `c${index}`, filePath: `web/src/c${index}.tsx`, endpoint: false })),
      { kind: "disconnected" as const, id: "scripts/x.py", label: "x", filePath: "scripts/x.py", endpoint: false },
      { kind: "stale" as const, id: "api/app.py", label: "app", filePath: "api/app.py", endpoint: true },
    ],
  };
  const findings = architectureCheck(graph, { drift, lang: "es" });
  assert.deepEqual(findings.map((item) => item.kind), ["drift-stale"]);
});

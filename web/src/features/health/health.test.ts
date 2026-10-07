import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph, CodeModule } from "@core/graph";
import type { MapFile, ProjectMap } from "@core/projectMap";
import { buildRunRecord, type RunInput } from "@/features/runs/lib/runLog";
import { detectDrift } from "./lib/drift";
import { describeBreach, nodeHealth, slaAlerts } from "./lib/sla";

function run(stages: RunInput["stages"], id: string) {
  return buildRunRecord(
    {
      profile: "http",
      graphName: "shop",
      finishedAt: "2026-09-27T10:00:00.000Z",
      question: "{}",
      answer: "{}",
      provider: "simulado",
      model: "-",
      demo: false,
      entryLabel: null,
      stages,
      costUsd: null,
    },
    id,
  );
}

test("SLA: latencia media > 1000 ms y errores > 1 % marcan el nodo; lo demás no", () => {
  const runs = [
    run(
      [
        { stage: "api", label: "API", nodeId: "api.ts", latencyMs: 12 },
        { stage: "pricing", label: "Pricing", nodeId: "pricing.py", latencyMs: 700 },
        // El mismo nodo dos veces en una ejecución: se suma (900 + 700 = 1600 ms en esta ejecución).
        { stage: "pricing", label: "Pricing", nodeId: "pricing.py", latencyMs: 900 },
      ],
      "r1",
    ),
    run(
      [
        { stage: "api", label: "API", nodeId: "api.ts", latencyMs: 10 },
        { stage: "pricing", label: "Pricing", nodeId: "pricing.py", latencyMs: 800 },
        { stage: "db", label: "DB", nodeId: "db.ts", latencyMs: 20, status: "error", detail: "timeout" },
      ],
      "r2",
    ),
  ];
  const health = nodeHealth(runs);
  assert.equal(health.get("pricing.py")?.avgLatencyMs, 1200);
  assert.deepEqual(health.get("pricing.py")?.breaches, ["latency"]);
  assert.deepEqual(health.get("db.ts")?.breaches, ["errors"]);
  assert.deepEqual(health.get("api.ts")?.breaches, []);
  assert.deepEqual(slaAlerts(health).map((item) => item.nodeId), ["pricing.py", "db.ts"]);
  assert.match(describeBreach(health.get("db.ts")!), /errores 100\.0 % \(> 1 %\) en 1 ejecución/);
});

const mod = (filePath: string, role?: CodeModule["role"]): CodeModule => ({
  id: filePath,
  label: filePath.split("/").pop() ?? filePath,
  filePath,
  groupId: "g",
  language: "python",
  subBlocks: [],
  ...(role ? { role } : {}),
});

const mapFile = (filePath: string, symbols = 1): MapFile => ({
  filePath,
  language: "python",
  lineCount: 10,
  imports: [],
  symbols: Array.from({ length: symbols }, (_, index) => ({
    id: `${filePath}::f${index}`,
    kind: "function" as const,
    name: `f${index}`,
    qualifiedName: `f${index}`,
    range: { startLine: 1, endLine: 2 },
    signature: "",
    calls: [],
    instantiations: [],
  })),
  moduleScope: { calls: [], instantiations: [] },
});

const projectMap = (files: MapFile[], truncated = false): ProjectMap => ({
  version: 1,
  workspaceName: "ws",
  generatedAt: "2026-09-27T00:00:00.000Z",
  revision: "r",
  truncated,
  stats: { files: files.length, symbols: 0, skippedFiles: 0, unresolvedCalls: 0, ambiguousCalls: 0 },
  files,
});

test("drift: endpoints sin mapear, módulos borrados y módulos sin conexiones", () => {
  const graph: CodeGraph = {
    version: 1,
    projectName: "shop",
    groups: [{ id: "g", label: "g", color: "sky" }],
    modules: [mod("src/api/orders.py", "api"), mod("src/domain/orders_service.py", "service"), mod("src/db/legacy.py", "database"), mod("src/util/lonely.py")],
    edges: [
      { id: "e1", source: "src/api/orders.py", target: "src/domain/orders_service.py", kind: "calls" },
      { id: "e2", source: "src/domain/orders_service.py", target: "src/db/legacy.py", kind: "calls" },
    ],
  };
  const map = projectMap([
    mapFile("backend/src/api/orders.py"),
    mapFile("backend/src/domain/orders_service.py"),
    mapFile("backend/src/util/lonely.py"),
    mapFile("backend/src/api/payments_routes.py"),
    mapFile("backend/src/tests/test_orders.py"),
    mapFile("backend/src/api/__init__.py"),
    mapFile("backend/src/constants.py", 0),
    mapFile("other/tooling/script.py"),
  ]);
  const report = detectDrift(graph, map);
  assert.equal(report.checkedSource, true);
  assert.deepEqual(
    report.items.map((item) => `${item.kind}:${item.filePath}:${item.endpoint}`),
    ["unmapped:backend/src/api/payments_routes.py:true", "disconnected:src/util/lonely.py:false", "stale:src/db/legacy.py:false"],
  );

  // Mapa truncado: faltar en él no significa haber desaparecido.
  assert.ok(!detectDrift(graph, projectMap(map.files, true)).items.some((item) => item.kind === "stale"));
  // Sin mapa: solo desconectados.
  assert.deepEqual(detectDrift(graph, null).items.map((item) => item.kind), ["disconnected"]);
});

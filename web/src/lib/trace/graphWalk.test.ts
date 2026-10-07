import assert from "node:assert/strict";
import test from "node:test";
import type { TraceModuleRef } from "@core/trace";
import { defaultEntry, simulatedLatency, walkGraph, type TraceGraphEdge } from "./graphWalk";
import { RAG_STAGES, stageLabel } from "./profiles";
import { resolveStageNodeFor, resolveStageNodesFor } from "./stageNodes";

const modules: TraceModuleRef[] = [
  { id: "api.ts", label: "Orders API", filePath: "src/api/orders.ts", role: "api" },
  { id: "svc.ts", label: "Order Service", filePath: "src/domain/order_service.ts", role: "service" },
  { id: "producer.ts", label: "Order Producer", filePath: "src/events/producer.ts", role: "broker" },
  { id: "consumer.ts", label: "Billing Consumer", filePath: "src/events/consumer.ts", role: "broker" },
  { id: "db.ts", label: "Orders DB", filePath: "src/db/orders.ts", role: "database" },
  { id: "cache.ts", label: "Redis", filePath: "src/cache/redis.ts", role: "cache" },
];

const edges: TraceGraphEdge[] = [
  { id: "calls:api:svc", source: "api.ts", target: "svc.ts", kind: "calls" },
  { id: "imports:svc:db", source: "svc.ts", target: "db.ts", kind: "imports" },
  { id: "calls:svc:cache", source: "svc.ts", target: "cache.ts", kind: "calls" },
  { id: "data-flow:svc:producer", source: "svc.ts", target: "producer.ts", kind: "data-flow" },
  { id: "data-flow:producer:consumer", source: "producer.ts", target: "consumer.ts", kind: "data-flow" },
  { id: "imports:consumer:db", source: "consumer.ts", target: "db.ts", kind: "imports" },
];

test("walkGraph http: BFS desde la API, llamadas antes que imports, cada nodo una vez", () => {
  const hops = walkGraph("http", "api.ts", edges);
  assert.deepEqual(
    hops.map((hop) => hop.nodeId),
    ["api.ts", "svc.ts", "cache.ts", "db.ts", "producer.ts", "consumer.ts"],
  );
  assert.equal(hops[0]?.from, null);
  assert.equal(hops[1]?.edgeId, "calls:api:svc");
});

test("walkGraph event: con data-flow explícito solo sigue el flujo de datos", () => {
  const hops = walkGraph("event", "producer.ts", edges);
  assert.deepEqual(
    hops.map((hop) => hop.nodeId),
    ["producer.ts", "consumer.ts", "db.ts"],
  );
});

test("defaultEntry elige por rol del perfil y cae a una raíz", () => {
  assert.equal(defaultEntry("http", modules, edges), "api.ts");
  assert.equal(defaultEntry("event", modules, edges), "producer.ts");
  const plain = modules.map(({ id, label, filePath }) => ({ id, label, filePath }));
  assert.equal(defaultEntry("http", plain, edges), "api.ts");
});

test("simulatedLatency es determinista y respeta el orden de magnitud por rol", () => {
  assert.equal(simulatedLatency("cache", "a"), simulatedLatency("cache", "a"));
  assert.ok(simulatedLatency("cache", "x") < simulatedLatency("database", "x"));
  assert.ok(simulatedLatency("database", "x") < simulatedLatency("ai-model", "x"));
});

test("resolución de etapas: tokens primero y rol como respaldo", () => {
  assert.equal(resolveStageNodeFor({ tokens: ["redis"] }, modules), "cache.ts");
  assert.equal(resolveStageNodeFor({ tokens: ["kafka"], roles: ["broker"] }, modules), "producer.ts");
  assert.equal(resolveStageNodeFor({ tokens: ["nada"] }, modules), null);
  const rag = resolveStageNodesFor(RAG_STAGES, modules);
  assert.equal(rag.api, "api.ts");
  assert.equal(stageLabel("rag", "vector_store"), "Vector Store");
  assert.equal(stageLabel("http", "svc.ts"), "svc.ts");
});

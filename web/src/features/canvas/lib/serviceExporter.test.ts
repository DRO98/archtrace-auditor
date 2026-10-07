import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_DRIVEN_SHOP_DEMO } from "@/features/demos/catalog/eventDrivenShop";
import { SERVICE_TEMPLATE_IDS, buildServiceSpec, generateServiceCode, pascalCase, resourceOf, snakeCase } from "./serviceExporter";

const graph = EVENT_DRIVEN_SHOP_DEMO.graph;

test("buildServiceSpec: endpoints, dependencias por rol, topics y jobs desde la demo event-driven", () => {
  const spec = buildServiceSpec(graph);
  assert.deepEqual(spec.endpoints.map((item) => item.path), ["/orders"]);
  const kinds = spec.endpoints[0]?.calls.map((item) => `${item.label}:${item.kind}`).sort();
  assert.deepEqual(kinds, ["Order Service:service", "Orders Repository:repository", "Outbox Publisher:publisher"]);
  assert.equal(spec.endpoints[0]?.calls.find((item) => item.kind === "publisher")?.topic, "orders.created");

  const topic = spec.topics.find((item) => item.name === "orders.created");
  assert.ok(topic);
  assert.deepEqual(topic.producers.map((item) => item.label), ["Outbox Publisher"]);
  assert.deepEqual(topic.consumers.map((item) => item.label).sort(), ["Billing Consumer", "Stock Job (Flink)"]);
  assert.deepEqual(spec.streamJobs.map((item) => item.inputs), [["orders.created"]]);
});

test("identificadores seguros para cualquier etiqueta", () => {
  assert.equal(pascalCase("Stock Job (Flink)"), "StockJobFlink");
  assert.equal(pascalCase("3D renderer"), "C3DRenderer");
  assert.equal(snakeCase("Orders API"), "orders_api");
  assert.equal(resourceOf({ label: "Orders API", filePath: "gateway/orders_controller.ts" }), "orders");
  assert.equal(resourceOf({ label: "API", filePath: "src/api/payments_routes.py" }), "payments");
});

test("cada plantilla genera código con los nombres del grafo", () => {
  const spec = buildServiceSpec(graph);
  const code = Object.fromEntries(SERVICE_TEMPLATE_IDS.map((id) => [id, generateServiceCode(id, spec)]));
  assert.match(code.express ?? "", /app\.post\("\/orders"/);
  assert.match(code.fastapi ?? "", /@app\.post\("\/orders", status_code=201\)/);
  assert.match(code["spring-boot"] ?? "", /@RequestMapping\("\/orders"\)[\s\S]*class OrdersController/);
  assert.match(code["kafka-python"] ?? "", /TOPICS = \["orders\.created"\]/);
  assert.match(code["kafka-node"] ?? "", /group: "billing_consumer"/);
  assert.match(code["flink-job"] ?? "", /\.setTopics\("orders\.created"\)/);
  for (const [id, text] of Object.entries(code)) assert.doesNotMatch(text, /undefined|NaN/, id);
});

test("sin api ni topics en el lienzo se generan ejemplos que arrancan igual", () => {
  const empty = buildServiceSpec({ version: 1, projectName: "vacío", groups: [], modules: [], edges: [] });
  assert.match(generateServiceCode("express", empty), /app\.post\("\/items"/);
  assert.match(generateServiceCode("kafka-node", empty), /TOPICS = \["events"\]/);
});

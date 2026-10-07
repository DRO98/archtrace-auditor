import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import test from "node:test";
import { classifyImage, discoverLocalServices, mergeServices, parseDockerPs, parsePublishedPorts, probePort } from "./localServices.js";

const DOCKER_PS = [
  JSON.stringify({ Names: "shop-postgres-1", Image: "postgres:16", Ports: "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp" }),
  JSON.stringify({ Names: "shop-kafka-ui-1", Image: "provectuslabs/kafka-ui:latest", Ports: "0.0.0.0:8082->8080/tcp" }),
  JSON.stringify({ Names: "internal", Image: "busybox", Ports: "" }),
  "no es json",
].join("\n");

test("parsePublishedPorts lee IPv4, IPv6 y deduplica", () => {
  assert.deepEqual(parsePublishedPorts("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp, 0.0.0.0:9092->9092/tcp"), [5432, 9092]);
  assert.deepEqual(parsePublishedPorts("6379/tcp"), []);
});

test("classifyImage distingue kafka-ui de kafka", () => {
  assert.equal(classifyImage("provectuslabs/kafka-ui").kind, "kafka-ui");
  assert.equal(classifyImage("confluentinc/cp-kafka:7.6").kind, "kafka");
  assert.equal(classifyImage("bitnami/redis").kind, "redis");
  assert.equal(classifyImage("my/app").kind, "unknown");
});

test("parseDockerPs: servicios con contenedor, imagen, URL y rol sugerido", () => {
  const services = parseDockerPs(DOCKER_PS);
  assert.deepEqual(
    services.map((item) => `${item.id}|${item.container}|${item.url ?? "-"}|${item.suggestedRole ?? "-"}`),
    ["postgres:5432|shop-postgres-1|-|database", "kafka-ui:8082|shop-kafka-ui-1|http://127.0.0.1:8082|broker"],
  );
  assert.ok(services.every((item) => item.host === "127.0.0.1" && item.source === "docker"));
});

test("mergeServices: Docker sustituye al sondeo del mismo puerto", () => {
  const merged = mergeServices(
    [{ id: "redis:6379", kind: "redis", label: "Redis", host: "127.0.0.1", port: 6379, source: "port" }],
    parseDockerPs(DOCKER_PS),
  );
  assert.deepEqual(merged.map((item) => item.port), [5432, 6379, 8082]);
});

test("discoverLocalServices: excluye el puerto propio y marca Docker no disponible", async () => {
  const result = await discoverLocalServices({
    ownPort: 11434,
    probe: async (port) => port === 11434 || port === 6379,
    docker: async () => null,
    now: () => new Date("2026-09-27T10:00:00.000Z"),
  });
  assert.equal(result.dockerAvailable, false);
  assert.equal(result.scannedAt, "2026-09-27T10:00:00.000Z");
  assert.deepEqual(result.services.map((item) => item.id), ["redis:6379"]);
});

test("probePort detecta un puerto abierto en loopback y uno cerrado", async () => {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    assert.equal(await probePort(address.port), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(await probePort(address.port), false);
});

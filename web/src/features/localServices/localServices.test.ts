import assert from "node:assert/strict";
import test from "node:test";
import type { LocalService } from "@core/protocol";
import { buildRequestLocalServices, parseIdeMessage } from "@/lib/protocol";
import { actionsFor, templateForService } from "./lib/suggestions";

function frame(payload: unknown): string {
  return JSON.stringify({ protocol: "TEACHER_CANVAS_v1", action: "LOCAL_SERVICES_DISCOVERED", payload });
}

const OLLAMA: LocalService = {
  id: "ollama:11434",
  kind: "ollama",
  label: "Ollama",
  host: "127.0.0.1",
  port: 11434,
  url: "http://127.0.0.1:11434",
  source: "port",
  suggestedRole: "ai-model",
};

test("LOCAL_SERVICES_DISCOVERED válido se acepta (también sin requestId)", () => {
  const message = parseIdeMessage(frame({ requestId: null, services: [OLLAMA], scannedAt: "2026-09-27T10:00:00.000Z", dockerAvailable: true }));
  assert.equal(message?.action, "LOCAL_SERVICES_DISCOVERED");
  if (message?.action !== "LOCAL_SERVICES_DISCOVERED") return;
  assert.deepEqual(message.payload.services, [OLLAMA]);
});

test("servicios fuera de loopback o con URL a otro host/puerto se descartan", () => {
  const message = parseIdeMessage(
    frame({
      requestId: "abc123",
      scannedAt: "2026-09-27T10:00:00.000Z",
      dockerAvailable: false,
      services: [
        { ...OLLAMA, host: "10.0.0.5" },
        { ...OLLAMA, url: "http://evil.example:11434" },
        { ...OLLAMA, url: "http://127.0.0.1:9999" },
        { ...OLLAMA, port: 70000 },
        { ...OLLAMA, kind: "desconocido" },
        { id: "redis:6379", kind: "redis", label: "Redis", host: "127.0.0.1", port: 6379, source: "docker", suggestedRole: "admin" },
      ],
    }),
  );
  assert.equal(message?.action, "LOCAL_SERVICES_DISCOVERED");
  if (message?.action !== "LOCAL_SERVICES_DISCOVERED") return;
  assert.deepEqual(
    message.payload.services.map((item) => `${item.id}|${item.suggestedRole ?? "-"}`),
    ["redis:6379|-"],
  );
});

test("payload mal formado se rechaza entero", () => {
  assert.equal(parseIdeMessage(frame({ requestId: "../x", services: [], scannedAt: "2026-09-27T10:00:00.000Z", dockerAvailable: true })), null);
  assert.equal(parseIdeMessage(frame({ requestId: null, services: [], scannedAt: "ayer", dockerAvailable: true })), null);
  assert.equal(parseIdeMessage(frame({ requestId: null, services: "x", scannedAt: "2026-09-27T10:00:00.000Z", dockerAvailable: true })), null);
  assert.equal(buildRequestLocalServices("no válido!"), null);
  assert.equal(buildRequestLocalServices("abc")?.action, "REQUEST_LOCAL_SERVICES");
});

test("sugerencias: Ollama → URL del LLM; Postgres → nodo BD; Kafka UI → abrir consola", () => {
  assert.deepEqual(actionsFor(OLLAMA), [{ kind: "use-ollama", url: "http://127.0.0.1:11434" }]);
  const postgres: LocalService = { id: "postgres:5432", kind: "postgres", label: "PostgreSQL", host: "127.0.0.1", port: 5432, source: "port" };
  assert.deepEqual(actionsFor(postgres), [{ kind: "add-node", template: "database" }]);
  const kafkaUi: LocalService = { ...postgres, id: "kafka-ui:8082", kind: "kafka-ui", port: 8082, url: "http://127.0.0.1:8082" };
  assert.deepEqual(actionsFor(kafkaUi), [{ kind: "open", url: "http://127.0.0.1:8082" }]);
  assert.equal(templateForService({ ...postgres, kind: "kafka" }), "broker");
  const api: LocalService = { ...postgres, id: "http:8000", kind: "http", port: 8000, url: "http://127.0.0.1:8000" };
  assert.deepEqual(actionsFor(api), [{ kind: "use-endpoint", url: "http://127.0.0.1:8000" }]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { blockLogo, firstStackLogo, readableHex, stackLogo } from "./stackLogos";

const PISD_STACK: Readonly<Record<string, string>> = {
  redpanda: "Redpanda",
  spark: "Apache Spark",
  airflow: "Apache Airflow",
  mongodb: "MongoDB",
  seaweedfs: "SeaweedFS",
  qdrant: "Qdrant",
  ollama: "Ollama",
  prometheus: "Prometheus",
  grafana: "Grafana",
  postgres: "PostgreSQL",
  fastapi: "FastAPI",
  langchain: "LangChain",
  chainlit: "Chainlit",
  mediapipe: "MediaPipe",
  keras: "Keras",
  pytorch: "PyTorch",
  kafka: "Apache Kafka",
  openai: "OpenAI",
};

test("stackLogo: todo el stack de PISD tiene logo oficial", () => {
  for (const [tech, title] of Object.entries(PISD_STACK)) {
    const logo = stackLogo(tech);
    assert.equal(logo?.title, title, tech);
    if (logo?.kind === "glyph") assert.ok(logo.path.length > 20, `ruta SVG de ${tech}`);
  }
});

test("los SVG locales existen en public/stack", () => {
  for (const tech of ["redpanda", "seaweedfs", "chainlit"]) {
    const logo = stackLogo(tech);
    assert.equal(logo?.kind, "file", tech);
    if (logo?.kind === "file") assert.ok(existsSync(join(process.cwd(), "public", logo.src)), logo.src);
  }
});

test("sin logo oficial no se inventa", () => {
  assert.equal(stackLogo("s3"), null);
  assert.equal(stackLogo(undefined), null);
  assert.equal(firstStackLogo(["orm"]), null);
  assert.equal(firstStackLogo(["orm", "langchain", "qdrant"])?.tech, "langchain");
});

test("blockLogo: infra por su tecnología, id o nombre; servicio por su primera tecnología con logo", () => {
  assert.equal(blockLogo({ kind: "infra", techIds: ["redpanda"], label: "Redpanda" })?.title, "Redpanda");
  // Grafos antiguos sin `tech`: el id `infra:<tech>` o el propio nombre del nodo.
  assert.equal(blockLogo({ kind: "infra", techIds: [], primaryModuleId: "infra:mongodb", label: "MongoDB" })?.title, "MongoDB");
  assert.equal(blockLogo({ kind: "infra", techIds: [], label: "SeaweedFS · S3" })?.title, "SeaweedFS");
  assert.equal(blockLogo({ kind: "infra", techIds: [], label: "Prometheus · Grafana" })?.title, "Prometheus");
  // La infra no toma el logo de otra tecnología que use.
  assert.equal(blockLogo({ kind: "infra", techIds: ["redpanda", "kafka"], label: "Redpanda" })?.title, "Redpanda");
  assert.equal(blockLogo({ kind: "service", techIds: ["orm", "langchain"], label: "Chatbot RAG" })?.title, "LangChain");
  assert.equal(blockLogo({ kind: "service", techIds: [], label: "Simulador" }), null);
});

test("readableHex oscurece marcas casi blancas y respeta el resto", () => {
  assert.equal(readableHex("FFFFFF"), "171717");
  assert.equal(readableHex("47A248"), "47A248");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphFromSources } from "../github/buildGraph";
import { classifyService, infraEdgesByTech, isComposePath, parseCompose, scanCompose } from "./composeScan";

/** Compose mínimo al estilo PISD: anclas, fusión `<<:`, trabajos de arranque y servicios que ejecutan código. */
const COMPOSE = `# Plataforma
name: pids

x-python: &python
  build:
    context: .
    dockerfile: docker/servicio-python.Dockerfile
  restart: unless-stopped

x-spark: &spark
  image: pids/spark:local
  environment:
    PIDS_MONGO_URI: mongodb://spark:\${PASS}@mongo:27017/?authSource=admin
    PIDS_KAFKA_BROKERS: redpanda:9092

services:
  s3:
    image: chrislusf/seaweedfs:4.47
  s3-init:
    <<: *python
    command: ["python", "-m", "plataforma.s3.crear_buckets"]
    depends_on:
      s3:
        condition: service_healthy
  redpanda:
    image: redpandadata/redpanda:v25.2.1
    command:
      - redpanda
      - start
  redpanda-init:
    image: redpandadata/redpanda:v25.2.1
    depends_on:
      redpanda:
        condition: service_healthy
  mongo:
    image: mongo:8.0
  captura:
    <<: *python
    command: ["uvicorn", "plataforma.captura.app:app", "--port", "8000"]
    environment:
      KAFKA_BROKERS: redpanda:9092
    depends_on:
      redpanda-init:
        condition: service_completed_successfully
  acceso:
    <<: *python
    command: ["uvicorn", "plataforma.acceso.app:app"]
    environment:
      MONGO_URI: mongodb://acceso:\${PASS}@mongo:27017/
  spark-master:
    <<: *spark
    command: >-
      /opt/spark/bin/spark-class org.apache.spark.deploy.master.Master
    depends_on:
      s3-init:
        condition: service_completed_successfully
      mongo:
        condition: service_healthy
  spark-worker-1:
    <<: *spark
    depends_on: [spark-master]
  ollama:
    image: ollama/ollama:0.34.1
  chatbot:
    <<: *python
    working_dir: /app/chatbot
    command: ["chainlit", "run", "app.py"]
    environment:
      OLLAMA_URL: http://ollama:11434
      ACCESO_URL: http://acceso:8000
    depends_on:
      - acceso
  frontend:
    build:
      context: .
      dockerfile: portal/bff/Dockerfile
    environment:
      - ACCESO_URL=http://acceso:8000
`;

const CODE = new Set([
  "plataforma/s3/crear_buckets.py",
  "plataforma/captura/app.py",
  "plataforma/acceso/app.py",
  "chatbot/app.py",
  "portal/bff/app.py",
]);

test("isComposePath reconoce docker-compose y compose con variantes", () => {
  assert.ok(isComposePath("docker-compose.yml"));
  assert.ok(isComposePath("deploy/docker-compose.prod.yaml"));
  assert.ok(isComposePath("compose.yml"));
  assert.ok(isComposePath("docker-compose.sin-gpu.yml"));
  assert.equal(isComposePath("k8s/deployment.yml"), false);
  assert.equal(isComposePath("docker-compose.md"), false);
});

test("parseCompose resuelve anclas, fusión y los tres formatos de depends_on / environment", () => {
  const services = new Map(parseCompose(COMPOSE).map((item) => [item.name, item]));
  assert.equal(services.size, 12);
  const captura = services.get("captura");
  assert.equal(captura?.dockerfile, "docker/servicio-python.Dockerfile", "hereda build de x-python");
  assert.match(captura?.command ?? "", /plataforma\.captura\.app:app/);
  assert.deepEqual(captura?.dependsOn, ["redpanda-init"]);
  assert.deepEqual(captura?.oneShot, ["redpanda-init"]);
  assert.deepEqual(captura?.envRefs, ["redpanda"]);
  assert.deepEqual(services.get("spark-worker-1")?.dependsOn, ["spark-master"]);
  assert.deepEqual(services.get("spark-worker-1")?.envRefs, ["mongo", "redpanda"], "hereda environment de x-spark");
  assert.deepEqual(services.get("chatbot")?.dependsOn, ["acceso"]);
  assert.deepEqual(services.get("frontend")?.envRefs, ["acceso"], "environment en forma de lista");
  assert.match(services.get("spark-master")?.command ?? "", /spark-class/, "bloque plegado >-");
  const lines = services.get("s3")?.lines;
  assert.ok(lines && lines.start < lines.end);
});

test("classifyService: por imagen primero, luego por el nombre", () => {
  assert.equal(classifyService({ name: "s3", image: "chrislusf/seaweedfs:4.47" })?.tech, "seaweedfs");
  assert.equal(classifyService({ name: "airflow-db", image: "postgres:17" })?.tech, "postgres");
  assert.equal(classifyService({ name: "consola", image: "redpandadata/console:v3" })?.tech, "redpanda");
  assert.equal(classifyService({ name: "spark-master", image: "pids/spark:local" })?.tech, "spark");
  assert.equal(classifyService({ name: "qdrant" })?.tech, "qdrant");
  assert.equal(classifyService({ name: "captura", image: "pids/captura:local" }), null);
});

test("scanCompose: un módulo infra por tecnología y servicios de código enlazados a su archivo", () => {
  const scan = scanCompose(new Map([["docker-compose.yml", COMPOSE]]), CODE);
  assert.deepEqual(
    scan.modules.map((item) => [item.id, item.role]),
    [
      ["infra:mongodb", "database"],
      ["infra:ollama", "ai-model"],
      ["infra:redpanda", "broker"],
      ["infra:seaweedfs", "database"],
      ["infra:spark", "stream"],
    ],
  );
  const spark = scan.modules.find((item) => item.id === "infra:spark");
  assert.equal(spark?.groupId, "infra");
  assert.deepEqual(spark?.subBlocks.map((block) => block.name), ["spark-master", "spark-worker-1"], "master y workers en un solo módulo");

  const edges = scan.edges.map((edge) => `${edge.source} -> ${edge.target} [${edge.kind}]`);
  assert.ok(edges.includes("plataforma/captura/app.py -> infra:redpanda [data-flow]"));
  assert.ok(edges.includes("plataforma/acceso/app.py -> infra:mongodb [data-flow]"));
  assert.ok(edges.includes("chatbot/app.py -> plataforma/acceso/app.py [calls]"), "working_dir + script");
  assert.ok(edges.includes("chatbot/app.py -> infra:ollama [calls]"));
  assert.ok(edges.includes("portal/bff/app.py -> plataforma/acceso/app.py [calls]"), "entrypoint junto al Dockerfile");
  assert.ok(edges.includes("infra:spark -> infra:mongodb [data-flow]"));
  assert.ok(edges.includes("plataforma/s3/crear_buckets.py -> infra:seaweedfs [data-flow]"));
  // Esperar a que termine un trabajo de arranque del repo no es arquitectura.
  assert.ok(!edges.some((edge) => edge.startsWith("infra:spark -> plataforma/s3")));
  // Una arista con host en environment se etiqueta por el protocolo, no por depends_on.
  assert.equal(scan.edges.find((edge) => edge.source === "chatbot/app.py" && edge.target === "plataforma/acceso/app.py")?.label, "HTTP");
});

test("infraEdgesByTech une el código que usa un cliente con su servicio (kafka → Redpanda)", () => {
  const scan = scanCompose(new Map([["docker-compose.yml", COMPOSE]]), CODE);
  const edges = infraEdgesByTech(
    new Map([
      ["plataforma/spark/job.py", ["spark", "kafka"]],
      ["lib/nada.py", ["fastapi"]],
    ]),
    scan,
  );
  assert.deepEqual(
    edges.map((edge) => [edge.source, edge.target, edge.label]),
    [
      ["plataforma/spark/job.py", "infra:redpanda", "Redpanda"],
      ["plataforma/spark/job.py", "infra:spark", "Spark"],
    ],
  );
});

test("buildGraphFromSources: compose + README dan infra, aristas y nombres humanos de las partes", () => {
  const readme = [
    "# Proyecto",
    "",
    "| Parte | Qué es | Carpeta |",
    "|---|---|---|",
    "| 2 | Plataforma: captura, procesado y acceso | [`plataforma/`](plataforma/) |",
    "| 3 | Chatbot con LLM local (Ollama) | [`chatbot/`](chatbot/) |",
    "| API | http://localhost:8002/docs | — |",
  ].join("\n");
  const sources = new Map<string, string>([
    ["README.md", readme],
    ["portal/README.md", "# Portal\n\nPortal web corporativo para operaciones. Más detalles abajo.\n"],
    ["docker-compose.yml", COMPOSE],
    ["plataforma/s3/crear_buckets.py", "import boto3\ns3 = boto3.client('s3')\n"],
    ["plataforma/captura/app.py", "from fastapi import FastAPI\nfrom confluent_kafka import Producer\napp = FastAPI()\n"],
    ["plataforma/acceso/app.py", "from fastapi import FastAPI\nimport pymongo\napp = FastAPI()\n"],
    ["chatbot/app.py", "import chainlit as cl\n"],
    ["portal/bff/app.py", "from fastapi import FastAPI\n"],
  ]);
  const graph = buildGraphFromSources("acme/pisd", sources);
  assert.ok(graph.modules.some((item) => item.id === "infra:redpanda"));
  assert.ok(!graph.modules.some((item) => item.filePath === "README.md"), "el README no es un módulo");
  const labels = Object.fromEntries(graph.groups.map((group) => [group.id, group.label]));
  assert.equal(labels.plataforma, "Plataforma");
  assert.equal(labels.chatbot, "Chatbot");
  assert.equal(labels.portal, "Portal web corporativo");
  assert.equal(labels.infra, "Infraestructura");
  assert.equal(graph.groups.find((group) => group.id === "chatbot")?.summary, "Chatbot con LLM local (Ollama)");
  assert.deepEqual(graph.modules.find((item) => item.id === "plataforma/captura/app.py")?.tech, ["fastapi", "kafka"]);
  const ids = new Set(graph.edges.map((edge) => edge.id));
  assert.equal(ids.size, graph.edges.length, "ids de arista únicos");
  assert.ok(graph.edges.some((edge) => edge.source === "plataforma/acceso/app.py" && edge.target === "infra:mongodb"));
});

test("scanCompose.serviceOf: el archivo que arranca cada servicio (para el esqueleto de sistema)", () => {
  const scan = scanCompose(new Map([["docker-compose.yml", COMPOSE]]), CODE);
  assert.deepEqual(Object.fromEntries(scan.serviceOf), {
    "chatbot/app.py": "chatbot",
    "plataforma/acceso/app.py": "acceso",
    "plataforma/captura/app.py": "captura",
    "plataforma/s3/crear_buckets.py": "s3-init",
    "portal/bff/app.py": "frontend",
  });
});

test("buildGraphFromSources: un nombre por cosa (sin «App» repetidos ni un segundo «Airflow»)", () => {
  const compose = "services:\n  airflow:\n    image: apache/airflow:3\n  acceso:\n    command: [\"uvicorn\", \"plataforma.acceso.app:app\"]\n";
  const graph = buildGraphFromSources(
    "acme/x",
    new Map([
      ["docker-compose.yml", compose],
      ["plataforma/acceso/app.py", "from fastapi import FastAPI\n"],
      ["plataforma/captura/app.py", "from fastapi import FastAPI\n"],
      ["portal/bff/servicios/airflow.py", "import httpx\n"],
    ]),
  );
  const label = (id: string) => graph.modules.find((item) => item.id === id)?.label;
  assert.equal(label("plataforma/acceso/app.py"), "Acceso App");
  assert.equal(label("plataforma/captura/app.py"), "Captura App");
  assert.equal(label("portal/bff/servicios/airflow.py"), "Cliente Airflow");
  assert.equal(label("infra:airflow"), "Airflow");
});

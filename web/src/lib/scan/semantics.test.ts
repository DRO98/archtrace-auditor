import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphFromSources } from "../github/buildGraph";
import { resolvePolyImports, scanPolySource } from "./polyScan";
import { detectSemantics, refineRole, semanticEdges } from "./semantics";

const PY_PRODUCER = `from confluent_kafka import Producer

producer = Producer({"bootstrap.servers": "localhost:9092"})

def publish_order(order):
    producer.produce("orders.created", value=order)
`;

const JS_CONSUMER = `import { Kafka } from "kafkajs";
const kafka = new Kafka({ brokers: ["localhost:9092"] });
const consumer = kafka.consumer({ groupId: "billing" });
await consumer.subscribe({ topics: ["orders.created"] });
// producer.send({ topic: "commented.out" })
`;

const PY_GRPC_SERVER = `import grpc
from protos import billing_pb2_grpc

class BillingServicer(billing_pb2_grpc.BillingServicer):
    def Charge(self, request, context):
        return None

def serve():
    server = grpc.server(None)
    billing_pb2_grpc.add_BillingServicer_to_server(BillingServicer(), server)
`;

const GO_CLIENT = `package main

import (
\t"context"
\t"google.golang.org/grpc"
\tpb "github.com/acme/shop/gen/billing"
\t"github.com/acme/shop/internal/orders"
)

type Server struct{}

func (s *Server) Handle(ctx context.Context) error {
\tclient := pb.NewBillingClient(conn)
\treturn nil
}

func main() {
\torders.Run()
}
`;

const PROTO = `syntax = "proto3";
package billing;

service Billing {
  rpc Charge (ChargeRequest) returns (ChargeReply);
  rpc Refund (RefundRequest) returns (RefundReply);
}

message ChargeRequest {
  string order_id = 1;
}
`;

test("detectSemantics: productor Kafka en Python", () => {
  const found = detectSemantics(PY_PRODUCER);
  assert.deepEqual(found.tech, ["kafka"]);
  assert.deepEqual(found.produces, ["orders.created"]);
  assert.equal(found.role, "broker");
});

test("detectSemantics: consumidor kafkajs ignora comentarios", () => {
  const found = detectSemantics(JS_CONSUMER);
  assert.deepEqual(found.consumes, ["orders.created"]);
  assert.deepEqual(found.produces, []);
});

test("detectSemantics: servidor y cliente gRPC; endpoints HTTP", () => {
  const server = detectSemantics(PY_GRPC_SERVER);
  assert.deepEqual(server.serves, ["Billing"]);
  assert.equal(server.role, "rpc");
  const client = detectSemantics(GO_CLIENT);
  assert.deepEqual(client.callsServices, ["Billing"]);
  const api = detectSemantics(`from fastapi import FastAPI\napp = FastAPI()\n@app.post("/orders")\ndef create(): ...\n`);
  assert.equal(api.httpEndpoints, true);
  assert.equal(api.role, "api");
});

test("sin cliente de mensajería, .send/.subscribe no son evidencia", () => {
  const found = detectSemantics(`socket.send("hello", data)\nobservable.subscribe("x")\n`);
  assert.deepEqual(found.produces, []);
  assert.deepEqual(found.consumes, []);
  assert.equal(found.role, undefined);
});

test("refineRole: solo sustituye roles débiles; api que sirve gRPC pasa a rpc", () => {
  const broker = detectSemantics(PY_PRODUCER);
  assert.equal(refineRole("code", broker), "broker");
  assert.equal(refineRole("database", broker), "database");
  assert.equal(refineRole("api", detectSemantics(PY_GRPC_SERVER)), "rpc");
});

test("semanticEdges: data-flow por topic y calls por servicio gRPC", () => {
  const edges = semanticEdges(
    new Map([
      ["producer.py", detectSemantics(PY_PRODUCER)],
      ["consumer.ts", detectSemantics(JS_CONSUMER)],
      ["server.py", detectSemantics(PY_GRPC_SERVER)],
      ["main.go", detectSemantics(GO_CLIENT)],
    ]),
  );
  assert.deepEqual(
    edges.map((edge) => `${edge.id} [${edge.label}]`),
    ["calls:main.go:server.py [gRPC Billing]", "data-flow:producer.py:consumer.ts [orders.created]"],
  );
});

test("scanPolySource: Go (métodos con receptor) y Proto (servicios, rpc y mensajes)", () => {
  const go = scanPolySource(GO_CLIENT, "go");
  assert.deepEqual(
    go.map((block) => `${block.kind}:${block.name}${block.parentName ? `<${block.parentName}` : ""}`),
    ["class:Server", "method:Server.Handle<Server", "function:main"],
  );
  const proto = scanPolySource(PROTO, "protobuf");
  assert.deepEqual(
    proto.map((block) => `${block.kind}:${block.name}:${block.startLine}-${block.endLine}`),
    ["class:Billing:4-7", "method:Billing.Charge:5-5", "method:Billing.Refund:6-6", "class:ChargeRequest:9-11"],
  );
  const java = scanPolySource("package a;\n\nimport x.Y;\n\npublic final class OrderService {\n  void run() {}\n}\n", "java");
  assert.deepEqual(java.map((block) => block.name), ["OrderService"]);
});

test("resolvePolyImports: JVM por paquete, Go por directorio (≥ 2 segmentos)", () => {
  const known = new Set([
    "src/main/java/com/acme/orders/OrderService.java",
    "src/main/java/com/acme/billing/Billing.java",
    "src/main/java/com/acme/billing/Invoice.java",
    "internal/orders/run.go",
    "internal/orders/run_test.go",
    "cmd/main.go",
  ]);
  assert.deepEqual(
    resolvePolyImports("import com.acme.orders.OrderService;\nimport com.acme.billing.*;\n", "src/main/java/com/acme/App.java", known, "java"),
    [
      "src/main/java/com/acme/billing/Billing.java",
      "src/main/java/com/acme/billing/Invoice.java",
      "src/main/java/com/acme/orders/OrderService.java",
    ],
  );
  assert.deepEqual(resolvePolyImports(GO_CLIENT, "cmd/main.go", known, "go"), ["internal/orders/run.go"]);
});

test("buildGraphFromSources: stack Kafka + gRPC con roles y aristas semánticas", () => {
  const graph = buildGraphFromSources(
    "shop",
    new Map([
      ["orders/producer.py", PY_PRODUCER],
      ["billing/consumer.ts", JS_CONSUMER],
      ["billing/server.py", PY_GRPC_SERVER],
      ["cmd/main.go", GO_CLIENT],
      ["protos/billing.proto", PROTO],
      ["README.md", "# nada"],
    ]),
  );
  const roleOf = (id: string) => graph.modules.find((item) => item.id === id)?.role;
  assert.equal(roleOf("orders/producer.py"), "broker");
  assert.equal(roleOf("billing/server.py"), "rpc");
  assert.equal(roleOf("protos/billing.proto"), "rpc");
  assert.equal(graph.modules.find((item) => item.id === "cmd/main.go")?.language, "go");
  const ids = graph.edges.map((edge) => edge.id);
  assert.ok(ids.includes("data-flow:orders/producer.py:billing/consumer.ts"));
  assert.ok(ids.includes("calls:cmd/main.go:billing/server.py"));
  assert.ok(ids.includes("imports:billing/server.py:protos/billing.proto"));
  assert.ok(ids.includes("imports:cmd/main.go:protos/billing.proto"));
  assert.ok(!graph.modules.some((item) => item.id === "README.md"));
});

test("detectSemantics: stack de datos e IA (Qdrant, Ollama, LangChain, MediaPipe, S3, Airflow)", () => {
  assert.deepEqual(detectSemantics("from qdrant_client import QdrantClient\nfrom langchain_core.messages import AIMessage\n").tech, ["langchain", "qdrant"]);
  assert.equal(detectSemantics("from langchain_core.messages import AIMessage\n").role, "ai-model");
  assert.equal(detectSemantics("OLLAMA_URL = os.environ['OLLAMA_URL']\n").role, "ai-model");
  assert.deepEqual(detectSemantics("import mediapipe as mp\nimport torch\n").tech, ["mediapipe", "pytorch"]);
  const s3 = detectSemantics("import boto3\nclient = boto3.client('s3', endpoint_url=URL)\n");
  assert.deepEqual([s3.tech, s3.role], [["s3"], "database"]);
  assert.equal(detectSemantics("from airflow import DAG\nfrom airflow.operators.python import PythonOperator\n").role, "pipeline");
  // Un job de Spark que escribe en S3 es procesado de streams, no almacenamiento.
  assert.equal(detectSemantics("from pyspark.sql import SparkSession\nimport boto3\nboto3.client('s3')\n").role, "stream");
  // Prometheus y FastAPI se anotan como tecnología sin cambiar el rol.
  const metrics = detectSemantics("from prometheus_client import Counter\n");
  assert.deepEqual([metrics.tech, metrics.role], [["prometheus"], undefined]);
});

test("detectSemantics: Redpanda por su dirección de broker, no por texto de la UI", () => {
  assert.deepEqual(detectSemantics('BROKERS = "redpanda:9092"\n').tech, ["redpanda"]);
  assert.deepEqual(detectSemantics('export const label = "Cola de eventos (Redpanda)";\n').tech, []);
});

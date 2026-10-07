/**
 * Plantillas de código agnósticas del stack: esqueletos ejecutables para microservicios HTTP (Express,
 * FastAPI, Spring Boot) y para procesamiento de eventos (productor/consumidor Kafka en Python o Node,
 * job de Flink). Se generan desde el grafo: endpoints desde los módulos `api`, dependencias por rol,
 * topics desde las aristas `data-flow` y jobs desde los módulos `stream`. Funciones puras.
 *
 * Son un punto de partida: la lógica de negocio queda como TODO con la ruta del módulo original.
 */
import type { CodeGraph, CodeModule, ModuleRole } from "@core/graph";
import { inferRole } from "./architecture";

export type ServiceFamily = "http" | "event";
export type ServiceTemplateId = "express" | "fastapi" | "spring-boot" | "kafka-python" | "kafka-node" | "flink-job";

export interface ServiceTemplate {
  id: ServiceTemplateId;
  family: ServiceFamily;
  label: string;
  language: "typescript" | "python" | "java";
  mime: string;
  filename: (slug: string) => string;
}

const snakeSlug = (slug: string): string => slug.replace(/-/g, "_") || "app";

export const SERVICE_TEMPLATES: Readonly<Record<ServiceTemplateId, ServiceTemplate>> = {
  express: { id: "express", family: "http", label: "Express (Node.js)", language: "typescript", mime: "text/typescript", filename: (slug) => `${slug}-api.ts` },
  fastapi: { id: "fastapi", family: "http", label: "FastAPI (Python)", language: "python", mime: "text/x-python", filename: (slug) => `${snakeSlug(slug)}_api.py` },
  "spring-boot": { id: "spring-boot", family: "http", label: "Spring Boot (Java)", language: "java", mime: "text/x-java", filename: () => "Application.java" },
  "kafka-python": { id: "kafka-python", family: "event", label: "Kafka · Python (confluent-kafka)", language: "python", mime: "text/x-python", filename: (slug) => `${snakeSlug(slug)}_events.py` },
  "kafka-node": { id: "kafka-node", family: "event", label: "Kafka · Node.js (kafkajs)", language: "typescript", mime: "text/typescript", filename: (slug) => `${slug}-events.ts` },
  "flink-job": { id: "flink-job", family: "event", label: "Flink Job (Java DataStream)", language: "java", mime: "text/x-java", filename: () => "StreamJob.java" },
};

export const SERVICE_TEMPLATE_IDS = Object.keys(SERVICE_TEMPLATES) as ServiceTemplateId[];

export type DependencyKind = "repository" | "cache" | "publisher" | "client" | "service";

export interface DependencySpec {
  id: string;
  label: string;
  filePath: string;
  kind: DependencyKind;
  /** Nombre de clase (PascalCase) del stub generado. */
  className: string;
  /** Topic, si es un publicador conectado por `data-flow`. */
  topic?: string;
}

export interface EndpointSpec {
  label: string;
  filePath: string;
  /** "/orders". */
  path: string;
  /** "orders" (identificador válido). */
  resource: string;
  calls: DependencySpec[];
}

export interface TopicSpec {
  name: string;
  producers: { label: string; filePath: string }[];
  consumers: { label: string; filePath: string; role: ModuleRole }[];
}

export interface StreamJobSpec {
  label: string;
  filePath: string;
  className: string;
  inputs: string[];
  outputs: string[];
}

export interface ServiceExportSpec {
  projectName: string;
  endpoints: EndpointSpec[];
  dependencies: DependencySpec[];
  topics: TopicSpec[];
  streamJobs: StreamJobSpec[];
}

function words(text: string): string[] {
  return text
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

export function pascalCase(text: string): string {
  const joined = words(text).map((word) => word[0]?.toUpperCase() + word.slice(1)).join("");
  return /^[A-Za-z]/.test(joined) ? joined : `C${joined || "Component"}`;
}

export function snakeCase(text: string): string {
  const joined = words(text).join("_");
  return /^[a-z]/.test(joined) ? joined : `m_${joined || "module"}`;
}

const camelCase = (text: string): string => {
  const pascal = pascalCase(text);
  return pascal[0]?.toLowerCase() + pascal.slice(1);
};

const ROUTE_NOISE = new Set(["api", "apis", "route", "routes", "router", "controller", "controllers", "handler", "handlers", "endpoint", "endpoints", "rest", "http", "gateway", "server"]);

/** Recurso REST a partir del módulo: "Orders API" / `orders_controller.ts` → "orders". */
export function resourceOf(module: Pick<CodeModule, "label" | "filePath">): string {
  const fromLabel = words(module.label).filter((word) => !ROUTE_NOISE.has(word));
  const base = module.filePath.split("/").pop() ?? module.filePath;
  const fromFile = words(base).filter((word) => !ROUTE_NOISE.has(word));
  const picked = fromLabel.length > 0 ? fromLabel : fromFile.length > 0 ? fromFile : ["items"];
  return picked.join("_");
}

const KIND_BY_ROLE: Partial<Record<ModuleRole, DependencyKind>> = {
  database: "repository",
  cache: "cache",
  broker: "publisher",
  rpc: "client",
};

/** Nombres de topic plausibles en una arista `data-flow` ("orders.created", "stock"), no frases. */
function isTopicLabel(label: string | undefined): label is string {
  return typeof label === "string" && /^[A-Za-z0-9._-]{2,80}$/.test(label);
}

/** Lee el grafo y extrae endpoints, dependencias, topics y jobs de streaming. */
export function buildServiceSpec(graph: CodeGraph): ServiceExportSpec {
  const roleOf = (module: CodeModule): ModuleRole => module.role ?? inferRole(module);
  const byId = new Map(graph.modules.map((item) => [item.id, item]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  // Topics: etiquetas de aristas data-flow. Un módulo que recibe y reenvía el mismo topic es la declaración del topic.
  const producers = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind !== "data-flow" || !isTopicLabel(edge.label)) continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    // Un topic pasa por un broker; lo que un job de streaming escribe en Redis o ClickHouse es un sink, no un topic.
    if (roleOf(source) !== "broker" && roleOf(target) !== "broker") continue;
    producers.set(edge.label, (producers.get(edge.label) ?? new Set()).add(source.id));
    consumers.set(edge.label, (consumers.get(edge.label) ?? new Set()).add(target.id));
  }
  const topics: TopicSpec[] = [...producers.keys()].sort().map((name) => {
    const inbound = consumers.get(name) ?? new Set<string>();
    const outbound = producers.get(name) ?? new Set<string>();
    const relays = new Set([...outbound].filter((id) => inbound.has(id)));
    return {
      name,
      producers: [...outbound].filter((id) => !relays.has(id)).flatMap((id) => {
        const item = byId.get(id);
        return item ? [{ label: item.label, filePath: item.filePath }] : [];
      }),
      consumers: [...inbound].filter((id) => !relays.has(id)).flatMap((id) => {
        const item = byId.get(id);
        return item ? [{ label: item.label, filePath: item.filePath, role: roleOf(item) }] : [];
      }),
    };
  });
  const topicProducedBy = new Map<string, string>();
  for (const topic of topics) for (const producer of topic.producers) topicProducedBy.set(producer.filePath, topic.name);

  const dependencyOf = (module: CodeModule): DependencySpec => {
    const kind = KIND_BY_ROLE[roleOf(module)] ?? "service";
    const dependency: DependencySpec = { id: module.id, label: module.label, filePath: module.filePath, kind, className: pascalCase(module.label) };
    const topic = topicProducedBy.get(module.filePath);
    if (topic && kind === "publisher") dependency.topic = topic;
    return dependency;
  };

  const entries = graph.modules.filter((item) => roleOf(item) === "api" && item.supportOf === undefined);
  const dependencies = new Map<string, DependencySpec>();
  const seenResources = new Set<string>();
  const endpoints = entries.map((entry): EndpointSpec => {
    // Dependencias directas y las de sus servicios (dos saltos): lo que el handler orquesta.
    const direct = outgoing.get(entry.id) ?? [];
    const reached = new Set<string>();
    for (const id of direct) {
      reached.add(id);
      const item = byId.get(id);
      if (item && roleOf(item) === "service") for (const next of outgoing.get(id) ?? []) reached.add(next);
    }
    const calls = [...reached]
      .map((id) => byId.get(id))
      .filter((item): item is CodeModule => item !== undefined && roleOf(item) !== "api")
      .map(dependencyOf);
    for (const call of calls) dependencies.set(call.id, call);
    let resource = resourceOf(entry);
    for (let n = 2; seenResources.has(resource); n += 1) resource = `${resourceOf(entry)}_${n}`;
    seenResources.add(resource);
    return { label: entry.label, filePath: entry.filePath, path: `/${resource.replace(/_/g, "-")}`, resource, calls };
  });

  const streamJobs = graph.modules
    .filter((item) => roleOf(item) === "stream")
    .map((item): StreamJobSpec => ({
      label: item.label,
      filePath: item.filePath,
      className: pascalCase(item.label),
      inputs: topics.filter((topic) => topic.consumers.some((consumer) => consumer.filePath === item.filePath)).map((topic) => topic.name),
      outputs: (outgoing.get(item.id) ?? []).map((id) => byId.get(id)?.label ?? id),
    }));

  return {
    projectName: graph.projectName,
    endpoints,
    dependencies: [...dependencies.values()],
    topics,
    streamJobs,
  };
}

// ---------------------------------------------------------------------------------------------
// Generadores

const q = (value: string): string => JSON.stringify(value);
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

function header(prefix: string, spec: ServiceExportSpec, title: string, run: string[]): string {
  return [
    `${prefix} ${title} — generado por ArchTrace desde «${oneLine(spec.projectName)}».`,
    `${prefix} Esqueleto de partida: la lógica de negocio queda como TODO con la ruta del módulo original.`,
    ...run.map((line) => `${prefix} ${line}`),
  ].join("\n");
}

/** Sin endpoints en el grafo se genera uno de ejemplo para que el esqueleto arranque igual. */
function endpointsOrSample(spec: ServiceExportSpec): EndpointSpec[] {
  if (spec.endpoints.length > 0) return spec.endpoints;
  return [{ label: "Items API", filePath: "(sin módulo api en el lienzo)", path: "/items", resource: "items", calls: [] }];
}

function topicsOrSample(spec: ServiceExportSpec): TopicSpec[] {
  if (spec.topics.length > 0) return spec.topics;
  return [{ name: "events", producers: [{ label: "Producer", filePath: "(sin topics en el lienzo)" }], consumers: [{ label: "Consumer", filePath: "(sin topics en el lienzo)", role: "broker" }] }];
}

function generateExpress(spec: ServiceExportSpec): string {
  const endpoints = endpointsOrSample(spec);
  const lines = [
    header("//", spec, "API HTTP con Express", ["npm i express && npm i -D tsx @types/express", "npx tsx <archivo>.ts  →  http://localhost:3000"]),
    "",
    'import express, { type Request, type Response } from "express";',
    "",
  ];
  for (const dep of spec.dependencies) {
    lines.push(`/** ${dep.label} (${dep.kind}) · ${dep.filePath} */`);
    lines.push(`class ${dep.className} {`);
    lines.push(`  async handle(payload: unknown): Promise<unknown> {`);
    lines.push(`    // TODO: ${dep.kind === "publisher" ? `publicar en ${q(dep.topic ?? "topic")}` : dep.kind === "repository" ? "consultar / guardar en la base de datos" : dep.kind === "cache" ? "leer / escribir en caché" : dep.kind === "client" ? "llamar al servicio remoto" : "lógica de negocio"}`);
    lines.push(`    return payload;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }
  lines.push("const app = express();", "app.use(express.json());", "");
  for (const dep of spec.dependencies) lines.push(`const ${camelCase(dep.label)} = new ${dep.className}();`);
  if (spec.dependencies.length > 0) lines.push("");
  for (const endpoint of endpoints) {
    lines.push(`// ${endpoint.label} · ${endpoint.filePath}`);
    lines.push(`app.post(${q(endpoint.path)}, async (req: Request, res: Response) => {`);
    lines.push(`  try {`);
    lines.push(`    let result: unknown = req.body;`);
    for (const dep of endpoint.calls) lines.push(`    result = await ${camelCase(dep.label)}.handle(result);`);
    lines.push(`    res.status(201).json({ ok: true, result });`);
    lines.push(`  } catch (error) {`);
    lines.push(`    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push(`app.get(${q(`${endpoint.path}/:id`)}, (req: Request, res: Response) => {`);
    lines.push(`  res.json({ id: req.params.id }); // TODO: leer ${endpoint.resource}`);
    lines.push(`});`);
    lines.push("");
  }
  lines.push('app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));', "");
  lines.push("const port = Number(process.env.PORT ?? 3000);");
  lines.push("app.listen(port, () => console.log(`API en http://localhost:${port}`));", "");
  return lines.join("\n");
}

function generateFastApi(spec: ServiceExportSpec): string {
  const endpoints = endpointsOrSample(spec);
  const lines = [
    header("#", spec, "API HTTP con FastAPI", ["pip install fastapi uvicorn", "uvicorn <archivo>:app --reload  →  http://localhost:8000/docs"]),
    "",
    "from typing import Any",
    "",
    "from fastapi import FastAPI, HTTPException",
    "",
    "",
  ];
  for (const dep of spec.dependencies) {
    lines.push(`class ${dep.className}:`);
    lines.push(`    """${dep.label} (${dep.kind}) · ${dep.filePath}"""`);
    lines.push("");
    lines.push("    async def handle(self, payload: Any) -> Any:");
    lines.push(`        # TODO: ${dep.kind === "publisher" ? `publicar en ${q(dep.topic ?? "topic")}` : dep.kind === "repository" ? "consultar / guardar en la base de datos" : dep.kind === "cache" ? "leer / escribir en caché" : dep.kind === "client" ? "llamar al servicio remoto" : "lógica de negocio"}`);
    lines.push("        return payload");
    lines.push("", "");
  }
  lines.push(`app = FastAPI(title=${q(oneLine(spec.projectName))})`);
  for (const dep of spec.dependencies) lines.push(`${snakeCase(dep.label)} = ${dep.className}()`);
  lines.push("", "");
  for (const endpoint of endpoints) {
    lines.push(`# ${endpoint.label} · ${endpoint.filePath}`);
    lines.push(`@app.post(${q(endpoint.path)}, status_code=201)`);
    lines.push(`async def create_${endpoint.resource}(body: dict[str, Any]) -> dict[str, Any]:`);
    lines.push("    try:");
    lines.push("        result: Any = body");
    for (const dep of endpoint.calls) lines.push(`        result = await ${snakeCase(dep.label)}.handle(result)`);
    lines.push('        return {"ok": True, "result": result}');
    lines.push("    except Exception as error:  # noqa: BLE001 — esqueleto: devuelve el fallo como 500");
    lines.push("        raise HTTPException(status_code=500, detail=str(error)) from error");
    lines.push("", "");
    lines.push(`@app.get(${q(`${endpoint.path}/{item_id}`)})`);
    lines.push(`async def get_${endpoint.resource}(item_id: str) -> dict[str, Any]:`);
    lines.push(`    return {"id": item_id}  # TODO: leer ${endpoint.resource}`);
    lines.push("", "");
  }
  lines.push('@app.get("/health")', "async def health() -> dict[str, str]:", '    return {"status": "ok"}', "");
  return lines.join("\n");
}

function generateSpringBoot(spec: ServiceExportSpec): string {
  const endpoints = endpointsOrSample(spec);
  const lines = [
    header("//", spec, "API HTTP con Spring Boot", ["Dependencias: spring-boot-starter-web (Spring Initializr).", "Un solo archivo para leerlo de un vistazo: sepáralo en paquetes al crecer.", "./mvnw spring-boot:run  →  http://localhost:8080"]),
    "",
    "package com.example.app;",
    "",
    "import java.util.Map;",
    "import org.springframework.boot.SpringApplication;",
    "import org.springframework.boot.autoconfigure.SpringBootApplication;",
    "import org.springframework.http.HttpStatus;",
    "import org.springframework.stereotype.Service;",
    "import org.springframework.web.bind.annotation.*;",
    "",
    "@SpringBootApplication",
    "public class Application {",
    "  public static void main(String[] args) {",
    "    SpringApplication.run(Application.class, args);",
    "  }",
    "}",
    "",
  ];
  for (const dep of spec.dependencies) {
    lines.push(`/** ${dep.label} (${dep.kind}) · ${dep.filePath} */`);
    lines.push("@Service");
    lines.push(`class ${dep.className} {`);
    lines.push("  Object handle(Object payload) {");
    lines.push(`    // TODO: ${dep.kind === "publisher" ? `publicar en ${q(dep.topic ?? "topic")}` : dep.kind === "repository" ? "consultar / guardar con un JpaRepository" : dep.kind === "cache" ? "leer / escribir en caché" : dep.kind === "client" ? "llamar al servicio remoto" : "lógica de negocio"}`);
    lines.push("    return payload;");
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }
  for (const endpoint of endpoints) {
    const controller = `${pascalCase(endpoint.resource)}Controller`;
    lines.push(`/** ${endpoint.label} · ${endpoint.filePath} */`);
    lines.push("@RestController");
    lines.push(`@RequestMapping(${q(endpoint.path)})`);
    lines.push(`class ${controller} {`);
    for (const dep of endpoint.calls) lines.push(`  private final ${dep.className} ${camelCase(dep.label)};`);
    if (endpoint.calls.length > 0) {
      lines.push("");
      lines.push(`  ${controller}(${endpoint.calls.map((dep) => `${dep.className} ${camelCase(dep.label)}`).join(", ")}) {`);
      for (const dep of endpoint.calls) lines.push(`    this.${camelCase(dep.label)} = ${camelCase(dep.label)};`);
      lines.push("  }");
    }
    lines.push("");
    lines.push("  @PostMapping");
    lines.push("  @ResponseStatus(HttpStatus.CREATED)");
    lines.push("  Map<String, Object> create(@RequestBody Map<String, Object> body) {");
    lines.push("    Object result = body;");
    for (const dep of endpoint.calls) lines.push(`    result = ${camelCase(dep.label)}.handle(result);`);
    lines.push('    return Map.of("ok", true, "result", result);');
    lines.push("  }");
    lines.push("");
    lines.push('  @GetMapping("/{id}")');
    lines.push("  Map<String, Object> get(@PathVariable String id) {");
    lines.push(`    return Map.of("id", id); // TODO: leer ${endpoint.resource}`);
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n");
}

function generateKafkaPython(spec: ServiceExportSpec): string {
  const topics = topicsOrSample(spec);
  const lines = [
    header("#", spec, "Productores y consumidores Kafka (confluent-kafka)", ["pip install confluent-kafka", "python <archivo>.py produce <topic> '{\"id\": 1}'   |   python <archivo>.py consume <topic>"]),
    "",
    "import json",
    "import os",
    "import sys",
    "from typing import Any, Callable",
    "",
    "from confluent_kafka import Consumer, KafkaError, Producer",
    "",
    'BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")',
    "",
    `TOPICS = [${topics.map((topic) => q(topic.name)).join(", ")}]`,
    "",
    "",
    "def produce(topic: str, event: dict[str, Any], key: str | None = None) -> None:",
    '    producer = Producer({"bootstrap.servers": BOOTSTRAP, "enable.idempotence": True})',
    "    producer.produce(topic, key=key, value=json.dumps(event).encode())",
    "    producer.flush(10)",
    "",
    "",
  ];
  const handlers: string[] = [];
  for (const topic of topics) {
    for (const consumer of topic.consumers) {
      const name = `handle_${snakeCase(consumer.label)}_${snakeCase(topic.name)}`;
      handlers.push(`    (${q(topic.name)}, ${q(snakeCase(consumer.label))}): ${name},`);
      lines.push(`def ${name}(event: dict[str, Any]) -> None:`);
      lines.push(`    """${consumer.label} consume ${topic.name} · ${consumer.filePath}"""`);
      lines.push(`    # TODO: lógica del consumidor`);
      lines.push(`    print("${consumer.label} ←", event)`);
      lines.push("", "");
    }
  }
  lines.push("HANDLERS: dict[tuple[str, str], Callable[[dict[str, Any]], None]] = {", ...handlers, "}", "", "");
  lines.push("def consume(topic: str) -> None:");
  lines.push("    for (handled_topic, group), handler in HANDLERS.items():");
  lines.push("        if handled_topic != topic:");
  lines.push("            continue");
  lines.push('        consumer = Consumer({"bootstrap.servers": BOOTSTRAP, "group.id": group, "auto.offset.reset": "earliest"})');
  lines.push("        consumer.subscribe([topic])");
  lines.push('        print(f"{group} escuchando {topic}…")');
  lines.push("        try:");
  lines.push("            while True:");
  lines.push("                message = consumer.poll(1.0)");
  lines.push("                if message is None:");
  lines.push("                    continue");
  lines.push("                if message.error():");
  lines.push("                    if message.error().code() != KafkaError._PARTITION_EOF:");
  lines.push('                        print("error:", message.error(), file=sys.stderr)');
  lines.push("                    continue");
  lines.push("                handler(json.loads(message.value()))");
  lines.push("        finally:");
  lines.push("            consumer.close()");
  lines.push("        return");
  lines.push('    raise SystemExit(f"No hay consumidor para {topic}. Topics: {TOPICS}")');
  lines.push("", "");
  for (const topic of topics) {
    for (const producer of topic.producers) lines.push(`# Productor de ${topic.name}: ${producer.label} · ${producer.filePath}`);
  }
  lines.push('if __name__ == "__main__":');
  lines.push('    if len(sys.argv) >= 3 and sys.argv[1] == "produce":');
  lines.push('        produce(sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {"hello": "world"})');
  lines.push('    elif len(sys.argv) >= 3 and sys.argv[1] == "consume":');
  lines.push("        consume(sys.argv[2])");
  lines.push("    else:");
  lines.push('        print("uso: produce <topic> [json] | consume <topic>")');
  lines.push("");
  return lines.join("\n");
}

function generateKafkaNode(spec: ServiceExportSpec): string {
  const topics = topicsOrSample(spec);
  const lines = [
    header("//", spec, "Productores y consumidores Kafka (kafkajs)", ["npm i kafkajs && npm i -D tsx", "npx tsx <archivo>.ts produce <topic> '{\"id\":1}'   |   npx tsx <archivo>.ts consume <topic>"]),
    "",
    'import { Kafka, type EachMessagePayload } from "kafkajs";',
    "",
    'const kafka = new Kafka({ clientId: "archtrace", brokers: (process.env.KAFKA_BOOTSTRAP ?? "localhost:9092").split(",") });',
    "",
    `export const TOPICS = [${topics.map((topic) => q(topic.name)).join(", ")}] as const;`,
    "",
    "export async function produce(topic: string, event: unknown, key?: string): Promise<void> {",
    "  const producer = kafka.producer({ idempotent: true });",
    "  await producer.connect();",
    "  try {",
    "    await producer.send({ topic, messages: [{ key, value: JSON.stringify(event) }] });",
    "  } finally {",
    "    await producer.disconnect();",
    "  }",
    "}",
    "",
    "type Handler = (event: unknown) => Promise<void>;",
    "",
  ];
  const handlers: string[] = [];
  for (const topic of topics) {
    for (const consumer of topic.consumers) {
      const name = camelCase(`handle ${consumer.label} ${topic.name}`);
      handlers.push(`  { topic: ${q(topic.name)}, group: ${q(snakeCase(consumer.label))}, handler: ${name} },`);
      lines.push(`/** ${consumer.label} consume ${topic.name} · ${consumer.filePath} */`);
      lines.push(`async function ${name}(event: unknown): Promise<void> {`);
      lines.push(`  // TODO: lógica del consumidor`);
      lines.push(`  console.log(${q(`${consumer.label} ←`)}, event);`);
      lines.push("}");
      lines.push("");
    }
  }
  lines.push("const HANDLERS: readonly { topic: string; group: string; handler: Handler }[] = [", ...handlers, "];", "");
  lines.push("export async function consume(topic: string): Promise<void> {");
  lines.push("  const entry = HANDLERS.find((item) => item.topic === topic);");
  lines.push("  if (!entry) throw new Error(`No hay consumidor para ${topic}. Topics: ${TOPICS.join(\", \")}`);");
  lines.push("  const consumer = kafka.consumer({ groupId: entry.group });");
  lines.push("  await consumer.connect();");
  lines.push("  await consumer.subscribe({ topics: [topic], fromBeginning: true });");
  lines.push("  await consumer.run({");
  lines.push("    eachMessage: async ({ message }: EachMessagePayload) => {");
  lines.push("      if (!message.value) return;");
  lines.push("      await entry.handler(JSON.parse(message.value.toString()));");
  lines.push("    },");
  lines.push("  });");
  lines.push("}");
  lines.push("");
  for (const topic of topics) {
    for (const producer of topic.producers) lines.push(`// Productor de ${topic.name}: ${producer.label} · ${producer.filePath}`);
  }
  lines.push("const [command, topic, json] = process.argv.slice(2);");
  lines.push('if (command === "produce" && topic) {');
  lines.push('  await produce(topic, json ? JSON.parse(json) : { hello: "world" });');
  lines.push('} else if (command === "consume" && topic) {');
  lines.push("  await consume(topic);");
  lines.push("} else {");
  lines.push('  console.log("uso: produce <topic> [json] | consume <topic>");');
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function generateFlinkJob(spec: ServiceExportSpec): string {
  const topics = topicsOrSample(spec);
  const job = spec.streamJobs[0];
  const inputs = job && job.inputs.length > 0 ? job.inputs : [topics[0]?.name ?? "events"];
  const outputTopic = `${snakeCase(job?.label ?? "stream")}.out`.replace(/_/g, "-");
  const lines = [
    header("//", spec, `Job de Flink${job ? ` · ${oneLine(job.label)}` : ""}`, [
      "Dependencias: flink-streaming-java, flink-connector-kafka (misma versión que tu clúster).",
      job ? `Módulo original: ${job.filePath}` : "El lienzo no tiene un módulo `stream`: se genera un job de ejemplo.",
      ...(job && job.outputs.length > 0 ? [`Destinos en el lienzo: ${job.outputs.join(", ")}`] : []),
    ]),
    "",
    "package com.example.stream;",
    "",
    "import java.time.Duration;",
    "import org.apache.flink.api.common.eventtime.WatermarkStrategy;",
    "import org.apache.flink.api.common.serialization.SimpleStringSchema;",
    "import org.apache.flink.connector.base.DeliveryGuarantee;",
    "import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;",
    "import org.apache.flink.connector.kafka.sink.KafkaSink;",
    "import org.apache.flink.connector.kafka.source.KafkaSource;",
    "import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;",
    "import org.apache.flink.streaming.api.datastream.DataStream;",
    "import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;",
    "",
    `public class StreamJob {`,
    '  private static final String BOOTSTRAP = System.getenv().getOrDefault("KAFKA_BOOTSTRAP", "localhost:9092");',
    "",
    "  public static void main(String[] args) throws Exception {",
    "    StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();",
    "",
    "    KafkaSource<String> source = KafkaSource.<String>builder()",
    "        .setBootstrapServers(BOOTSTRAP)",
    `        .setTopics(${inputs.map(q).join(", ")})`,
    `        .setGroupId(${q(snakeCase(job?.label ?? "stream_job"))})`,
    "        .setStartingOffsets(OffsetsInitializer.earliest())",
    "        .setValueOnlyDeserializer(new SimpleStringSchema())",
    "        .build();",
    "",
    "    DataStream<String> events = env.fromSource(",
    "        source, WatermarkStrategy.forBoundedOutOfOrderness(Duration.ofSeconds(5)), \"kafka-source\");",
    "",
    "    // TODO: la transformación del job (keyBy + window + reduce, enriquecimiento, filtros…).",
    "    DataStream<String> processed = events.map(value -> value);",
    "",
    "    KafkaSink<String> sink = KafkaSink.<String>builder()",
    "        .setBootstrapServers(BOOTSTRAP)",
    "        .setRecordSerializer(KafkaRecordSerializationSchema.builder()",
    `            .setTopic(${q(outputTopic)})`,
    "            .setValueSerializationSchema(new SimpleStringSchema())",
    "            .build())",
    "        .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)",
    "        .build();",
    "",
    "    processed.sinkTo(sink);",
    `    env.execute(${q(job?.label ?? "stream-job")});`,
    "  }",
    "}",
    "",
  ];
  return lines.join("\n");
}

export function generateServiceCode(template: ServiceTemplateId, spec: ServiceExportSpec): string {
  switch (template) {
    case "express":
      return generateExpress(spec);
    case "fastapi":
      return generateFastApi(spec);
    case "spring-boot":
      return generateSpringBoot(spec);
    case "kafka-python":
      return generateKafkaPython(spec);
    case "kafka-node":
      return generateKafkaNode(spec);
    case "flink-job":
      return generateFlinkJob(spec);
  }
}

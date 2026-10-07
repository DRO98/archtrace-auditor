import type { ModuleEdge, ModuleRole } from "@core/graph";

/**
 * Detección semántica any-stack sobre el texto fuente (sin AST, igual que `pyScan`/`jsScan`): qué
 * clientes de infraestructura usa un módulo (Kafka, RabbitMQ, Flink, gRPC, Postgres, Redis…) y qué
 * topics/colas produce o consume. De ahí salen un rol más preciso que el de la ruta y aristas
 * `data-flow` (productor → consumidor del mismo topic) y `calls` (cliente gRPC → servidor).
 *
 * Es heurística a propósito: solo se emite una arista cuando hay evidencia en ambos extremos
 * (mismo nombre de topic o de servicio), nunca por parecido de nombres de archivo.
 */

export interface ModuleSemantics {
  /** Rol sugerido por la evidencia del código; ausente si no hay nada concluyente. */
  role?: ModuleRole;
  /** Tecnologías detectadas ("kafka", "grpc", "postgres"…), para el resumen del módulo. */
  tech: string[];
  /** Topics / colas / streams a los que publica. */
  produces: string[];
  /** Topics / colas / streams de los que consume. */
  consumes: string[];
  /** Servicios gRPC que implementa (servidor). */
  serves: string[];
  /** Servicios gRPC que llama (cliente). */
  callsServices: string[];
  /** true si declara endpoints HTTP (decoradores/rutas). */
  httpEndpoints: boolean;
}

const NAME = String.raw`["'\x60]([\w.\-/:]+)["'\x60]`;

/**
 * Tecnología → patrones de import/uso que la delatan (cualquier lenguaje). Sin `role`, la tecnología solo se anota
 * (resumen del módulo, badges de Level 0, enlace con el compose) sin cambiar el rol.
 */
const TECH_PATTERNS: ReadonlyArray<{ tech: string; role?: ModuleRole; re: RegExp }> = [
  { tech: "kafka", role: "broker", re: /\b(kafkajs|confluent_kafka|aiokafka|kafka-python|from kafka import|import kafka\b|org\.apache\.kafka|KafkaProducer|KafkaConsumer|@KafkaListener|segmentio\/kafka-go|Shopify\/sarama|IBM\/sarama|confluent-kafka-go)/ },
  { tech: "redpanda", role: "broker", re: /(\bredpanda:\d{2,5}\b|\brpk topic\b|\bREDPANDA_\w+|\bredpanda[_-]?(client|brokers?)\b)/i },
  { tech: "rabbitmq", role: "broker", re: /\b(amqplib|import pika|from pika|aio_pika|RabbitTemplate|@RabbitListener|amqp091-go|streadway\/amqp)/ },
  { tech: "pulsar", role: "broker", re: /\b(pulsar-client|import pulsar|org\.apache\.pulsar)/ },
  { tech: "nats", role: "broker", re: /\b(nats\.connect|from nats|nats-io\/nats\.go|["']nats["'])/ },
  { tech: "sqs", role: "broker", re: /\b(client-sqs|SQSClient|sqs\.send_message|boto3\.client\(\s*["']sqs)/ },
  { tech: "flink", role: "stream", re: /\b(pyflink|org\.apache\.flink|StreamExecutionEnvironment)/ },
  { tech: "spark", role: "stream", re: /\b(pyspark|org\.apache\.spark|SparkSession|readStream|writeStream)/ },
  { tech: "kafka-streams", role: "stream", re: /\b(KafkaStreams|StreamsBuilder|faust\.App)/ },
  { tech: "beam", role: "stream", re: /\b(apache_beam|org\.apache\.beam)/ },
  { tech: "airflow", role: "pipeline", re: /\b(from airflow\b|import airflow\b|airflow\.(models|decorators|operators|sdk)|@dag\b)/ },
  { tech: "grpc", role: "rpc", re: /\b(import grpc\b|from grpc|@grpc\/grpc-js|grpc-go|google\.golang\.org\/grpc|io\.grpc|_pb2_grpc|ServicerContext)/ },
  { tech: "redis", role: "cache", re: /\b(ioredis|import redis\b|from redis|["']redis["']|go-redis|Jedis|Lettuce|RedisTemplate)/ },
  { tech: "memcached", role: "cache", re: /\b(pymemcache|memjs|memcached)/ },
  { tech: "postgres", role: "database", re: /\b(psycopg2?|asyncpg|["']pg["']|postgresql:\/\/|jackc\/pgx|lib\/pq|org\.postgresql)/ },
  { tech: "mysql", role: "database", re: /\b(pymysql|mysql2?|mysql:\/\/|go-sql-driver\/mysql)/ },
  { tech: "mongodb", role: "database", re: /\b(pymongo|motor\.motor_asyncio|["']mongodb["']|mongoose|mongo-driver|mongodb:\/\/)/ },
  { tech: "clickhouse", role: "database", re: /\b(clickhouse[_-]?(driver|connect|client|go)?|@clickhouse\/client)/ },
  { tech: "sqlite", role: "database", re: /\b(sqlite3|better-sqlite3)/ },
  { tech: "qdrant", role: "database", re: /(\bqdrant_client\b|\bQdrantClient\b|@qdrant\/|\blangchain_qdrant\b|\bQdrantVectorStore\b)/ },
  { tech: "chroma", role: "database", re: /\b(chromadb|langchain_chroma)\b/ },
  { tech: "elasticsearch", role: "database", re: /(\belasticsearch\b|\bopensearchpy\b|@elastic\/elasticsearch)/ },
  { tech: "s3", role: "database", re: /(boto3\.(client|resource)\(\s*["']s3|@aws-sdk\/client-s3|\bfrom minio\b|\bimport minio\b|\bseaweedfs\b|\bs3fs\b|\bS3Client\b)/ },
  { tech: "orm", role: "database", re: /\b(sqlalchemy|@prisma\/client|typeorm|sequelize|knex|drizzle-orm|gorm\.io|javax\.persistence|jakarta\.persistence|@Entity\b|JpaRepository)/ },
  { tech: "ollama", role: "ai-model", re: /(\bimport ollama\b|\bfrom ollama\b|\bChatOllama\b|\bOllamaLLM\b|\bOLLAMA_(URL|HOST|MODELO?)\b)/ },
  { tech: "langchain", role: "ai-model", re: /(\bfrom langchain|\bimport langchain|@langchain\/|\blanggraph\b)/ },
  { tech: "openai", role: "ai-model", re: /(\bfrom openai\b|\bimport openai\b|\bOpenAI\(|["']openai["']|\bChatOpenAI\b)/ },
  { tech: "anthropic", role: "ai-model", re: /(\bfrom anthropic\b|\bimport anthropic\b|@anthropic-ai\/sdk)/ },
  { tech: "mediapipe", role: "ai-model", re: /\b(import mediapipe|from mediapipe|@mediapipe\/)/ },
  { tech: "keras", role: "ai-model", re: /\b(import keras\b|from keras\b|tensorflow\.keras|import tensorflow|from tensorflow)/ },
  { tech: "pytorch", role: "ai-model", re: /\b(import torch\b|from torch\b)/ },
  { tech: "prometheus", re: /\b(prometheus_client|prom-client|prometheus_fastapi_instrumentator|client_golang\/prometheus)/ },
  { tech: "fastapi", re: /\b(from fastapi\b|import fastapi\b)/ },
  { tech: "chainlit", re: /\b(import chainlit|from chainlit)/ },
];

/** Nombre para mostrar de cada tecnología (badges de Level 0 y resúmenes). */
export const TECH_LABEL: Readonly<Record<string, string>> = {
  kafka: "Kafka",
  redpanda: "Redpanda",
  rabbitmq: "RabbitMQ",
  pulsar: "Pulsar",
  nats: "NATS",
  sqs: "SQS",
  flink: "Flink",
  spark: "Spark",
  "kafka-streams": "Kafka Streams",
  beam: "Beam",
  airflow: "Airflow",
  grpc: "gRPC",
  redis: "Redis",
  memcached: "Memcached",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  clickhouse: "ClickHouse",
  sqlite: "SQLite",
  qdrant: "Qdrant",
  chroma: "Chroma",
  elasticsearch: "Elasticsearch",
  s3: "S3",
  seaweedfs: "SeaweedFS",
  minio: "MinIO",
  orm: "ORM",
  ollama: "Ollama",
  langchain: "LangChain",
  openai: "OpenAI API",
  anthropic: "Anthropic",
  mediapipe: "MediaPipe",
  keras: "Keras",
  pytorch: "PyTorch",
  prometheus: "Prometheus",
  grafana: "Grafana",
  fastapi: "FastAPI",
  chainlit: "Chainlit",
};

export function techLabel(tech: string): string {
  return TECH_LABEL[tech] ?? tech.charAt(0).toUpperCase() + tech.slice(1);
}

/** Endpoints HTTP: decoradores y registros de ruta de los frameworks habituales. */
const HTTP_ENDPOINT_RE =
  /(@(app|router|api|bp|blueprint)\.(get|post|put|patch|delete|route)\s*\(|\b(app|router|server|fastify)\.(get|post|put|patch|delete)\s*\(\s*["'`/]|@(Get|Post|Put|Patch|Delete|Request)Mapping\b|@RestController\b|@(Get|Post|Put|Patch|Delete)\(\s*["'`]?|\bhttp\.HandleFunc\(|\.HandleFunc\(\s*"|gin\.(Default|New)\(|echo\.New\(|export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b)/;

/** Publicar: nombre del topic/cola como primer argumento o como `topic:` / `routing_key=`. */
const PRODUCE_RES: readonly RegExp[] = [
  new RegExp(String.raw`\.(?:produce|publish|send_and_wait|sendToQueue)\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`\.send\s*\(\s*` + NAME + String.raw`\s*,`, "g"),
  new RegExp(String.raw`\.send\s*\(\s*\{[^}]*?\btopic\s*:\s*` + NAME, "g"),
  new RegExp(String.raw`\bbasic_publish\s*\([^)]*?routing_key\s*=\s*` + NAME, "g"),
  new RegExp(String.raw`new\s+ProducerRecord\s*<[^>]*>\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`kafkaTemplate\.send\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`kafka\.Writer\s*\{[^}]*?\bTopic\s*:\s*` + NAME, "g"),
  new RegExp(String.raw`\.(?:sink_to|to|addSink)\s*\(\s*` + NAME, "g"),
];

/** Consumir: `subscribe([...])`, `topics: [...]`, listeners anotados, `basic_consume(queue=...)`. */
const CONSUME_RES: readonly RegExp[] = [
  new RegExp(String.raw`\.subscribe\s*\(\s*\[?\s*` + NAME, "g"),
  new RegExp(String.raw`\.subscribe\s*\(\s*\{[^}]*?\btopics?\s*:\s*\[?\s*` + NAME, "g"),
  new RegExp(String.raw`\bKafkaConsumer\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`@KafkaListener\s*\([^)]*?topics\s*=\s*\{?\s*` + NAME, "g"),
  new RegExp(String.raw`@RabbitListener\s*\([^)]*?queues\s*=\s*\{?\s*` + NAME, "g"),
  new RegExp(String.raw`\bbasic_consume\s*\([^)]*?queue\s*=\s*` + NAME, "g"),
  new RegExp(String.raw`\.consume\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`@app\.agent\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`\.(?:stream|from_source|addSource)\s*\(\s*` + NAME, "g"),
  new RegExp(String.raw`kafka\.ReaderConfig\s*\{[^}]*?\bTopic\s*:\s*` + NAME, "g"),
];

/** gRPC: servidor (`add_XServicer_to_server`, `RegisterXServer`, `extends XImplBase`, `addService(x.X.service`). */
const GRPC_SERVE_RES: readonly RegExp[] = [
  /\badd_(\w+?)Servicer_to_server\b/g,
  /\bclass\s+\w+\s*\(\s*(?:\w+\.)?(\w+?)Servicer\s*\)/g,
  /\bRegister(\w+?)Server\s*\(/g,
  /\bextends\s+(\w+?)Grpc\.\1ImplBase\b/g,
  /\.addService\s*\(\s*(?:\w+\.)*(\w+?)\.service\b/g,
];

/** gRPC: cliente (`XStub(`, `NewXClient(`, `XGrpc.newBlockingStub`, `new x.X(` con credenciales). */
const GRPC_CALL_RES: readonly RegExp[] = [
  /\b(\w+?)Stub\s*\(/g,
  /\bNew(\w+?)Client\s*\(/g,
  /\b(\w+?)Grpc\.new(?:Blocking|Future)?Stub\s*\(/g,
];

/** Topics que no son nombres de verdad (plantillas, rutas HTTP, valores de ejemplo). */
function isPlausibleTopic(name: string): boolean {
  if (name.length < 2 || name.length > 120) return false;
  if (name.startsWith("/") || name.includes("://")) return false;
  return /[a-z]/i.test(name);
}

function collect(source: string, patterns: readonly RegExp[], accept: (name: string) => boolean = () => true): string[] {
  const found = new Set<string>();
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      const name = match[1];
      if (name && accept(name)) found.add(name);
    }
  }
  return [...found].sort();
}

/** Sin comentarios de línea ni de bloque: un `# producer.send("x")` comentado no es evidencia. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/^\s*#.*$/gm, "");
}

/** Con varias tecnologías, gana la más estructural: un job de Spark que escribe en Mongo es `stream`, no `database`. */
const ROLE_PRIORITY: readonly ModuleRole[] = ["rpc", "stream", "pipeline", "broker", "ai-model", "database", "cache"];

export function detectSemantics(source: string): ModuleSemantics {
  const code = stripComments(source);
  const techHits = TECH_PATTERNS.filter((item) => item.re.test(code));
  const tech = [...new Set(techHits.map((item) => item.tech))].sort();
  const usesMessaging = techHits.some((item) => item.role === "broker" || item.role === "stream");
  const usesGrpc = tech.includes("grpc");

  // Sin cliente de mensajería, `.send("x", …)` o `.subscribe("x")` son demasiado genéricos (sockets, RxJS…).
  const produces = usesMessaging ? collect(code, PRODUCE_RES, isPlausibleTopic) : [];
  const consumes = usesMessaging ? collect(code, CONSUME_RES, isPlausibleTopic) : [];
  const serves = usesGrpc ? collect(code, GRPC_SERVE_RES) : [];
  const callsServices = usesGrpc ? collect(code, GRPC_CALL_RES).filter((name) => !serves.includes(name)) : [];
  const httpEndpoints = HTTP_ENDPOINT_RE.test(code);

  const semantics: ModuleSemantics = { tech, produces, consumes, serves, callsServices, httpEndpoints };
  if (serves.length > 0) semantics.role = "rpc";
  else if (httpEndpoints) semantics.role = "api";
  else {
    const roles = new Set(techHits.flatMap((item) => (item.role ? [item.role] : [])));
    const role = ROLE_PRIORITY.find((item) => roles.has(item));
    if (role) semantics.role = role;
  }
  return semantics;
}

/** Roles débiles (inferidos solo por la ruta): la evidencia del código puede sustituirlos. */
const WEAK_ROLES: ReadonlySet<ModuleRole> = new Set(["code", "util", "service", "app"]);

/**
 * Rol final: el de la ruta salvo que sea débil y el código diga algo más concreto. Un `api` por ruta
 * que en realidad sirve gRPC pasa a `rpc`.
 */
export function refineRole(pathRole: ModuleRole, semantics: ModuleSemantics): ModuleRole {
  if (!semantics.role) return pathRole;
  if (semantics.role === "rpc" && pathRole === "api") return "rpc";
  return WEAK_ROLES.has(pathRole) ? semantics.role : pathRole;
}

/**
 * Aristas semánticas entre módulos: `data-flow` del productor al consumidor de cada topic y `calls`
 * del cliente gRPC al módulo que implementa el servicio. Ids `<kind>:<origen>:<destino>` (únicos).
 */
export function semanticEdges(byModule: ReadonlyMap<string, ModuleSemantics>): ModuleEdge[] {
  const producers = new Map<string, string[]>();
  const consumers = new Map<string, string[]>();
  const servers = new Map<string, string[]>();
  for (const [id, semantics] of byModule) {
    for (const topic of semantics.produces) producers.set(topic, [...(producers.get(topic) ?? []), id]);
    for (const topic of semantics.consumes) consumers.set(topic, [...(consumers.get(topic) ?? []), id]);
    for (const service of semantics.serves) servers.set(service, [...(servers.get(service) ?? []), id]);
  }

  const edges = new Map<string, ModuleEdge>();
  const add = (kind: ModuleEdge["kind"], source: string, target: string, label: string): void => {
    if (source === target) return;
    const id = `${kind}:${source}:${target}`;
    const existing = edges.get(id);
    if (existing) {
      if (existing.label && !existing.label.split(", ").includes(label)) existing.label = `${existing.label}, ${label}`;
      return;
    }
    edges.set(id, { id, source, target, kind, label });
  };

  for (const [topic, from] of producers) {
    for (const source of from) for (const target of consumers.get(topic) ?? []) add("data-flow", source, target, topic);
  }
  for (const [id, semantics] of byModule) {
    for (const service of semantics.callsServices) {
      for (const target of servers.get(service) ?? []) add("calls", id, target, `gRPC ${service}`);
    }
  }
  return [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
}

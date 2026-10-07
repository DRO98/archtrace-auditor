import type { LineRange } from "./protocol.js";

export type GroupColor = "sky" | "emerald" | "violet" | "amber" | "rose" | "zinc";
export type SubBlockKind = "class" | "function" | "method" | "block";
export type EdgeKind = "imports" | "calls" | "data-flow";
export type ModuleRole =
  | "api"
  | "pipeline"
  | "database"
  /** Almacén clave-valor / caché (Redis, Memcached). Separado de `database` a propósito. */
  | "cache"
  /** Broker de mensajería / colas (Kafka, RabbitMQ, Pulsar, SQS). */
  | "broker"
  /** Procesamiento de streams (Flink, Spark Streaming, Kafka Streams, Beam). */
  | "stream"
  /** Servicio o cliente RPC (gRPC, Thrift, protobuf). */
  | "rpc"
  | "ai-model"
  | "transform"
  | "prompt"
  | "app"
  | "service"
  | "ui"
  | "util"
  | "code";

export interface ModuleGroup {
  id: string;
  label: string;
  color: GroupColor;
  /** Qué es la carpeta en una frase (p. ej. la columna «Qué es» del README). */
  summary?: string;
}

/**
 * Subsistema visual (caja contenedora en el lienzo). Distinto de ModuleGroup, que refleja la carpeta:
 * un subsistema agrupa módulos que colaboran ("RAG Core" = chunker + embedder + vector store).
 */
export interface ModuleSubsystem {
  id: string;
  label: string;
  color: GroupColor;
}

export interface CodeSubBlock {
  id: string;
  kind: SubBlockKind;
  name: string;
  range: LineRange;
  parentId?: string;
  summary?: string;
}

export interface CodeModule {
  id: string;
  /** Título humano ("RAG Pipeline"), no el nombre de archivo. */
  label: string;
  filePath: string;
  groupId: string;
  language: string;
  summary?: string;
  role?: ModuleRole;
  /** Tecnologías detectadas en el código o en el compose ("mongodb", "qdrant"…). */
  tech?: string[];
  /** Servicio de docker-compose que arranca este archivo ("acceso", "chatbot-rag"): es la entrada de ese servicio. */
  service?: string;
  /** Línea secundaria de la tarjeta ("ingest · retrieve · answer"). */
  subtitle?: string;
  /** Si existe, este módulo se dibuja como sub-nodo circular de ese módulo. */
  supportOf?: string;
  /** Capa de ejecución (0 = entrada) que fija la columna izquierda→derecha. Si falta, se infiere. */
  layer?: number;
  /** Id de un ModuleSubsystem. Si falta, se infiere por rol/ruta. */
  subsystem?: string;
  subBlocks: CodeSubBlock[];
}

export interface ModuleEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

export interface CodeGraph {
  version: 1;
  projectName: string;
  groups: ModuleGroup[];
  modules: CodeModule[];
  edges: ModuleEdge[];
  subsystems?: ModuleSubsystem[];
  /**
   * Archivos analizados que no entran en el mapa por no aportar arquitectura (tests, `__init__`, configs, huérfanos).
   * Siguen en el repo: solo no se dibujan, no se simulan ni cuentan en el Check.
   */
  omitted?: { count: number; paths: string[] };
}

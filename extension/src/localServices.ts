import { execFile } from "node:child_process";
import { Socket } from "node:net";
import type { LocalService, LocalServiceKind, LocalServicesDiscoveredPayload } from "@core/protocol";
import type { ModuleRole } from "@core/graph";

/**
 * Descubrimiento de servicios locales para el lienzo (`LOCAL_SERVICES_DISCOVERED`).
 *
 * Guardarraíles:
 * - Solo se sondea 127.0.0.1 y solo una lista fija de puertos conocidos: no es un escáner de red.
 * - Sin dependencias: `node:net` para el sondeo TCP y, si existe, la CLI de Docker (`docker ps`).
 * - Todo con timeouts cortos: el sondeo completo tarda lo que el puerto más lento (≈ 300 ms).
 */

export const LOOPBACK = "127.0.0.1";
const PROBE_TIMEOUT_MS = 300;
const DOCKER_TIMEOUT_MS = 2500;

interface KnownPort {
  port: number;
  kind: LocalServiceKind;
  label: string;
  /** Si habla HTTP y el navegador puede usarlo directamente. */
  http?: boolean;
}

/** Puertos por defecto de los servicios habituales en desarrollo. */
export const KNOWN_PORTS: readonly KnownPort[] = [
  { port: 11434, kind: "ollama", label: "Ollama", http: true },
  { port: 5432, kind: "postgres", label: "PostgreSQL" },
  { port: 3306, kind: "mysql", label: "MySQL" },
  { port: 27017, kind: "mongodb", label: "MongoDB" },
  { port: 6379, kind: "redis", label: "Redis" },
  { port: 9092, kind: "kafka", label: "Kafka" },
  { port: 29092, kind: "kafka", label: "Kafka (host)" },
  { port: 8081, kind: "schema-registry", label: "Schema Registry", http: true },
  { port: 8082, kind: "kafka-ui", label: "Kafka UI", http: true },
  { port: 5672, kind: "rabbitmq", label: "RabbitMQ" },
  { port: 15672, kind: "rabbitmq", label: "RabbitMQ Management", http: true },
  { port: 8123, kind: "clickhouse", label: "ClickHouse (HTTP)", http: true },
  { port: 9200, kind: "elasticsearch", label: "Elasticsearch", http: true },
  { port: 4317, kind: "otel-collector", label: "OpenTelemetry Collector (gRPC)" },
  { port: 4318, kind: "otel-collector", label: "OpenTelemetry Collector (HTTP)", http: true },
  { port: 16686, kind: "jaeger", label: "Jaeger UI", http: true },
  { port: 9090, kind: "prometheus", label: "Prometheus", http: true },
  { port: 50051, kind: "grpc", label: "Servicio gRPC" },
  { port: 8000, kind: "http", label: "API HTTP (:8000)", http: true },
  { port: 5000, kind: "http", label: "API HTTP (:5000)", http: true },
];

const ROLE_OF: Readonly<Record<LocalServiceKind, ModuleRole | undefined>> = {
  ollama: "ai-model",
  postgres: "database",
  mysql: "database",
  mongodb: "database",
  clickhouse: "database",
  elasticsearch: "database",
  redis: "cache",
  kafka: "broker",
  "kafka-ui": "broker",
  "schema-registry": "broker",
  rabbitmq: "broker",
  grpc: "rpc",
  http: "api",
  "otel-collector": undefined,
  jaeger: undefined,
  prometheus: undefined,
  unknown: undefined,
};

/** Imagen de Docker → tipo de servicio. El orden importa (kafka-ui antes que kafka). */
const IMAGE_KINDS: ReadonlyArray<{ re: RegExp; kind: LocalServiceKind; label: string }> = [
  { re: /ollama/, kind: "ollama", label: "Ollama" },
  { re: /kafka-ui|kafdrop|redpanda-console|akhq/, kind: "kafka-ui", label: "Kafka UI" },
  { re: /schema-registry/, kind: "schema-registry", label: "Schema Registry" },
  { re: /kafka|redpanda/, kind: "kafka", label: "Kafka" },
  { re: /postgres|postgis|timescale/, kind: "postgres", label: "PostgreSQL" },
  { re: /mysql|mariadb/, kind: "mysql", label: "MySQL" },
  { re: /mongo/, kind: "mongodb", label: "MongoDB" },
  { re: /redis|valkey|keydb/, kind: "redis", label: "Redis" },
  { re: /rabbitmq/, kind: "rabbitmq", label: "RabbitMQ" },
  { re: /clickhouse/, kind: "clickhouse", label: "ClickHouse" },
  { re: /elasticsearch|opensearch/, kind: "elasticsearch", label: "Elasticsearch" },
  { re: /otel|opentelemetry/, kind: "otel-collector", label: "OpenTelemetry Collector" },
  { re: /jaeger/, kind: "jaeger", label: "Jaeger" },
  { re: /prometheus/, kind: "prometheus", label: "Prometheus" },
];

export function classifyImage(image: string): { kind: LocalServiceKind; label: string } {
  const lower = image.toLowerCase();
  return IMAGE_KINDS.find((item) => item.re.test(lower)) ?? { kind: "unknown", label: image };
}

/** Puertos publicados en el host a partir de la columna Ports de `docker ps` ("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"). */
export function parsePublishedPorts(ports: string): number[] {
  const found = new Set<number>();
  for (const match of ports.matchAll(/(?:[\d.]+|\[?::\]?):(\d+)->\d+\/tcp/g)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) found.add(port);
  }
  return [...found].sort((left, right) => left - right);
}

function makeService(kind: LocalServiceKind, label: string, port: number, source: LocalService["source"], http: boolean): LocalService {
  const service: LocalService = { id: `${kind}:${port}`, kind, label, host: LOOPBACK, port, source };
  if (http) service.url = `http://${LOOPBACK}:${port}`;
  const role = ROLE_OF[kind];
  if (role) service.suggestedRole = role;
  return service;
}

/** Contenedores de `docker ps --format '{{json .}}'` (una línea JSON por contenedor) → servicios. */
export function parseDockerPs(stdout: string): LocalService[] {
  const services: LocalService[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const image = typeof record.Image === "string" ? record.Image : "";
    const name = typeof record.Names === "string" ? record.Names : "";
    const ports = typeof record.Ports === "string" ? parsePublishedPorts(record.Ports) : [];
    const { kind, label } = classifyImage(image);
    for (const port of ports) {
      const known = KNOWN_PORTS.find((item) => item.port === port);
      const finalKind = kind === "unknown" && known ? known.kind : kind;
      const http = known?.http ?? (finalKind === "ollama" || finalKind === "kafka-ui");
      const service = makeService(finalKind, kind === "unknown" && known ? known.label : label, port, "docker", http);
      if (name) service.container = name;
      if (image) service.image = image;
      services.push(service);
    }
  }
  return services;
}

/** Une sondeo y Docker por puerto: Docker aporta contenedor e imagen (y un tipo más fiable). */
export function mergeServices(probed: readonly LocalService[], docker: readonly LocalService[]): LocalService[] {
  const byPort = new Map<number, LocalService>();
  for (const service of probed) byPort.set(service.port, service);
  for (const service of docker) {
    const existing = byPort.get(service.port);
    byPort.set(service.port, existing && service.kind === "unknown" ? { ...existing, container: service.container, image: service.image } : service);
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port);
}

/** true si algo acepta conexiones TCP en 127.0.0.1:`port`. */
export function probePort(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, LOOPBACK);
  });
}

function dockerPs(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("docker", ["ps", "--format", "{{json .}}"], { timeout: DOCKER_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

export interface DiscoverOptions {
  /** Puerto del propio puente WebSocket: se excluye del sondeo. */
  ownPort?: number;
  probe?: (port: number) => Promise<boolean>;
  docker?: () => Promise<string | null>;
  now?: () => Date;
}

/** Sondea los puertos conocidos y (si hay) Docker. Nunca lanza: un fallo es "no encontrado". */
export async function discoverLocalServices(options: DiscoverOptions = {}): Promise<Omit<LocalServicesDiscoveredPayload, "requestId">> {
  const probe = options.probe ?? probePort;
  const candidates = KNOWN_PORTS.filter((item) => item.port !== options.ownPort);
  const [open, dockerOut] = await Promise.all([
    Promise.all(candidates.map(async (item) => ((await probe(item.port).catch(() => false)) ? item : null))),
    (options.docker ?? dockerPs)().catch(() => null),
  ]);
  const probed = open
    .filter((item): item is KnownPort => item !== null)
    .map((item) => makeService(item.kind, item.label, item.port, "port", item.http === true));
  const docker = dockerOut === null ? [] : parseDockerPs(dockerOut).filter((service) => service.port !== options.ownPort);
  return {
    services: mergeServices(probed, docker),
    scannedAt: (options.now?.() ?? new Date()).toISOString(),
    dockerAvailable: dockerOut !== null,
  };
}

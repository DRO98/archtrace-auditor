import type { LocalService, LocalServiceKind } from "@core/protocol";
import type { ComponentTemplateId } from "@/features/canvas/edit/components";

/** Nodo de infraestructura que representaría el servicio en el lienzo (null si no aporta un nodo). */
const TEMPLATE_OF: Readonly<Record<LocalServiceKind, ComponentTemplateId | null>> = {
  postgres: "database",
  mysql: "database",
  mongodb: "database",
  clickhouse: "database",
  elasticsearch: "database",
  redis: "cache",
  kafka: "broker",
  rabbitmq: "broker",
  "kafka-ui": null,
  "schema-registry": null,
  grpc: "rpc-service",
  ollama: null,
  http: null,
  "otel-collector": null,
  jaeger: null,
  prometheus: null,
  unknown: null,
};

export function templateForService(service: LocalService): ComponentTemplateId | null {
  return TEMPLATE_OF[service.kind];
}

export type ServiceAction =
  /** Guardar la URL como base del LLM local (Ajustes → Ollama / vLLM). */
  | { kind: "use-ollama"; url: string }
  /** Usarla como endpoint real del perfil HTTP de "Probar / Simular". */
  | { kind: "use-endpoint"; url: string }
  /** Abrir la consola web del servicio (Kafka UI, Jaeger, RabbitMQ Management…). */
  | { kind: "open"; url: string }
  /** Añadir un nodo de infraestructura al lienzo. */
  | { kind: "add-node"; template: ComponentTemplateId };

const CONSOLE_KINDS: ReadonlySet<LocalServiceKind> = new Set(["kafka-ui", "jaeger", "prometheus", "rabbitmq", "schema-registry", "elasticsearch", "clickhouse"]);

/** Acciones que tienen sentido para un servicio detectado (las URL siempre son loopback, validadas al recibirlas). */
export function actionsFor(service: LocalService): ServiceAction[] {
  const actions: ServiceAction[] = [];
  if (service.url && service.kind === "ollama") actions.push({ kind: "use-ollama", url: service.url });
  if (service.url && service.kind === "http") actions.push({ kind: "use-endpoint", url: service.url });
  if (service.url && CONSOLE_KINDS.has(service.kind)) actions.push({ kind: "open", url: service.url });
  const template = templateForService(service);
  if (template) actions.push({ kind: "add-node", template });
  return actions;
}

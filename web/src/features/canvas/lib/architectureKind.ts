import type { CodeGraph, ModuleRole } from "@core/graph";
import type { TraceProfileId } from "@core/trace";
import { inferRole } from "./architecture";
import { isAiGraph } from "./subsystems";
import type { ServiceTemplateId } from "./serviceExporter";

/**
 * Tipo de arquitectura de un grafo. Decide los valores por defecto que antes asumían RAG: el perfil de
 * "Probar / Simular", la plantilla de "Exportar código" y cómo se etiqueta el pipeline en el dashboard.
 */
export type ArchitectureKind = "distributed" | "api-backend" | "ai-pipeline" | "generic";

export const ARCHITECTURE_KINDS: readonly ArchitectureKind[] = ["distributed", "api-backend", "ai-pipeline", "generic"];

export interface ArchitectureKindInfo {
  label: string;
  short: string;
  description: string;
  /** Perfil de "Probar / Simular" que encaja. */
  traceProfile: TraceProfileId;
  /** Plantilla de código por defecto; null = la muestra RAG. */
  template: ServiceTemplateId | null;
}

export const ARCHITECTURE_KIND_INFO: Readonly<Record<ArchitectureKind, ArchitectureKindInfo>> = {
  distributed: {
    label: "Sistema distribuido / Kafka",
    short: "Distribuido",
    description: "Microservicios que se comunican por eventos (Kafka, RabbitMQ), streams o gRPC.",
    traceProfile: "event",
    template: "kafka-node",
  },
  "api-backend": {
    label: "API Backend",
    short: "API",
    description: "Servicio HTTP con lógica de dominio, base de datos y caché.",
    traceProfile: "http",
    template: "express",
  },
  "ai-pipeline": {
    label: "Pipeline RAG / IA",
    short: "RAG / IA",
    description: "Ingesta, embeddings, recuperación y generación con modelos de lenguaje.",
    traceProfile: "rag",
    template: null,
  },
  generic: {
    label: "Arquitectura general",
    short: "General",
    description: "Módulos y dependencias sin un patrón dominante.",
    traceProfile: "http",
    template: "express",
  },
};

export function isArchitectureKind(value: unknown): value is ArchitectureKind {
  return typeof value === "string" && (ARCHITECTURE_KINDS as readonly string[]).includes(value);
}

const MESSAGING: ReadonlySet<ModuleRole> = new Set(["broker", "stream"]);
const BACKEND: ReadonlySet<ModuleRole> = new Set(["api", "rpc", "database", "cache", "service"]);

/**
 * Detección por la evidencia del grafo. Mensajería o streaming ganan (un backend con Kafka es un sistema
 * distribuido aunque también tenga IA); después IA; después API/BD; si no, general.
 */
export function detectArchitectureKind(graph: Pick<CodeGraph, "modules" | "edges">): ArchitectureKind {
  const roles = graph.modules.map((item) => item.role ?? inferRole(item));
  const messaging = roles.filter((role) => MESSAGING.has(role)).length;
  const rpc = roles.filter((role) => role === "rpc").length;
  if (messaging > 0 || rpc >= 2) return "distributed";
  if (isAiGraph(graph)) return "ai-pipeline";
  if (roles.filter((role) => BACKEND.has(role)).length >= 2) return "api-backend";
  return "generic";
}

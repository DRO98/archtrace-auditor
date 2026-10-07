import type { ModuleRole } from "./graph.js";
import type { ProjectMap } from "./projectMap.js";

export type ProtocolVersion = "TEACHER_CANVAS_v1";

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface NavigateToCodePayload {
  filePath: string;
  range: LineRange;
  highlightColor?: string;
  focusEditor?: boolean;
}

export interface IdeStateChangedPayload {
  activeFile: string;
  cursorLine: number;
  status: "clean" | "dirty";
}

export type ClearHighlightsPayload = Record<string, never>;

export interface RequestProjectMapPayload {
  requestId: string;
}

export interface ProjectMapPayload {
  requestId: string;
  map: ProjectMap;
}

export interface ProjectMapErrorPayload {
  requestId: string;
  message: string;
}

/** Archivos fuente creados, modificados o borrados en el workspace (rutas relativas POSIX). */
export interface SourceFilesChangedPayload {
  changedPaths: string[];
  /** Fecha ISO 8601 del último cambio del lote. */
  changedAt: string;
}

/** Servicios locales que la extensión sabe reconocer (por puerto conocido o por imagen de Docker). */
export type LocalServiceKind =
  | "ollama"
  | "postgres"
  | "mysql"
  | "mongodb"
  | "redis"
  | "kafka"
  | "kafka-ui"
  | "schema-registry"
  | "rabbitmq"
  | "clickhouse"
  | "elasticsearch"
  | "otel-collector"
  | "jaeger"
  | "prometheus"
  | "grpc"
  | "http"
  | "unknown";

export interface LocalService {
  /** `<kind>:<port>`. */
  id: string;
  kind: LocalServiceKind;
  label: string;
  /** Siempre loopback: la extensión solo sondea 127.0.0.1. */
  host: "127.0.0.1";
  port: number;
  /** URL base utilizable desde el navegador si el servicio habla HTTP (Ollama, Kafka UI…). */
  url?: string;
  /** `port` = respondió al sondeo TCP · `docker` = contenedor en marcha con el puerto publicado. */
  source: "port" | "docker";
  container?: string;
  image?: string;
  /** Rol de nodo que representaría el servicio en el lienzo. */
  suggestedRole?: ModuleRole;
}

export interface RequestLocalServicesPayload {
  requestId: string;
}

export interface LocalServicesDiscoveredPayload {
  /** null = envío espontáneo (al conectar), sin petición previa. */
  requestId: string | null;
  services: LocalService[];
  /** Fecha ISO 8601 del sondeo. */
  scannedAt: string;
  /** false si no hay CLI de Docker o el daemon no respondió. */
  dockerAvailable: boolean;
}

export interface RequestGitRefsPayload {
  requestId: string;
}

export interface GitCommitRef {
  sha: string;
  subject: string;
  /** Fecha ISO 8601 del commit. */
  date: string;
}

export interface GitRefsPayload {
  requestId: string;
  /** Rama actual (null en HEAD separado). */
  current: string | null;
  branches: string[];
  /** Últimos commits de la rama actual, del más reciente al más antiguo. */
  commits: GitCommitRef[];
  /** Mensaje si el workspace no es un repo git o git no está instalado. */
  error?: string;
}

/**
 * Diff entre dos refs (`base..head`) o, con `head: null`, entre `base` y el árbol de trabajo.
 * Los refs son nombres de rama, tags o SHAs: la extensión rechaza cualquier cosa que parezca una opción.
 */
export interface RequestGitDiffPayload {
  requestId: string;
  base: string;
  head: string | null;
}

export interface GitFileChange {
  /** Ruta relativa al workspace (POSIX). */
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** Ruta anterior en un renombrado. */
  previousPath?: string;
}

export interface GitDiffPayload {
  requestId: string;
  base: string;
  head: string | null;
  files: GitFileChange[];
  error?: string;
}

interface Envelope<A extends string, P> {
  protocol: ProtocolVersion;
  action: A;
  payload: P;
}

export type NavigateToCodeMessage = Envelope<"NAVIGATE_TO_CODE", NavigateToCodePayload>;
export type ClearHighlightsMessage = Envelope<"CLEAR_HIGHLIGHTS", ClearHighlightsPayload>;
export type RequestProjectMapMessage = Envelope<"REQUEST_PROJECT_MAP", RequestProjectMapPayload>;
export type IdeStateChangedMessage = Envelope<"IDE_STATE_CHANGED", IdeStateChangedPayload>;
export type ProjectMapMessage = Envelope<"PROJECT_MAP", ProjectMapPayload>;
export type ProjectMapErrorMessage = Envelope<"PROJECT_MAP_ERROR", ProjectMapErrorPayload>;
export type SourceFilesChangedMessage = Envelope<"SOURCE_FILES_CHANGED", SourceFilesChangedPayload>;
export type RequestGitRefsMessage = Envelope<"REQUEST_GIT_REFS", RequestGitRefsPayload>;
export type GitRefsMessage = Envelope<"GIT_REFS", GitRefsPayload>;
export type RequestGitDiffMessage = Envelope<"REQUEST_GIT_DIFF", RequestGitDiffPayload>;
export type GitDiffMessage = Envelope<"GIT_DIFF", GitDiffPayload>;
export type RequestLocalServicesMessage = Envelope<"REQUEST_LOCAL_SERVICES", RequestLocalServicesPayload>;
export type LocalServicesDiscoveredMessage = Envelope<"LOCAL_SERVICES_DISCOVERED", LocalServicesDiscoveredPayload>;

export type CanvasToIdeMessage =
  | NavigateToCodeMessage
  | ClearHighlightsMessage
  | RequestProjectMapMessage
  | RequestLocalServicesMessage
  | RequestGitRefsMessage
  | RequestGitDiffMessage;
export type IdeToCanvasMessage =
  | IdeStateChangedMessage
  | ProjectMapMessage
  | ProjectMapErrorMessage
  | SourceFilesChangedMessage
  | LocalServicesDiscoveredMessage
  | GitRefsMessage
  | GitDiffMessage;
export type TeacherMessage = CanvasToIdeMessage | IdeToCanvasMessage;

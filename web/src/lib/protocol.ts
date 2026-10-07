import type {
  ClearHighlightsMessage,
  IdeStateChangedPayload,
  GitCommitRef,
  GitDiffPayload,
  GitFileChange,
  GitRefsPayload,
  IdeToCanvasMessage,
  LocalService,
  LocalServiceKind,
  LocalServicesDiscoveredPayload,
  NavigateToCodeMessage,
  NavigateToCodePayload,
  ProjectMapErrorPayload,
  ProjectMapPayload,
  ProtocolVersion,
  RequestGitDiffMessage,
  RequestGitRefsMessage,
  RequestLocalServicesMessage,
  RequestProjectMapMessage,
  SourceFilesChangedPayload,
} from "@core/protocol";
import type { ModuleRole } from "@core/graph";
import { parseProjectMap } from "./projectMap";

export const PROTOCOL: ProtocolVersion = "TEACHER_CANVAS_v1";

export interface NavigateOptions {
  highlightColor?: string;
  focusEditor?: boolean;
}

export function buildNavigate(
  filePath: string,
  startLine: number,
  endLine: number,
  opts?: NavigateOptions,
): NavigateToCodeMessage {
  const payload: NavigateToCodePayload = {
    filePath,
    range: { startLine, endLine },
  };

  if (opts?.highlightColor !== undefined) {
    payload.highlightColor = opts.highlightColor;
  }
  if (opts?.focusEditor !== undefined) {
    payload.focusEditor = opts.focusEditor;
  }

  return {
    protocol: PROTOCOL,
    action: "NAVIGATE_TO_CODE",
    payload,
  };
}

export function buildClear(): ClearHighlightsMessage {
  return {
    protocol: PROTOCOL,
    action: "CLEAR_HIGHLIGHTS",
    payload: {},
  };
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildRequestProjectMap(requestId: string): RequestProjectMapMessage | null {
  if (!REQUEST_ID.test(requestId)) return null;
  return {
    protocol: PROTOCOL,
    action: "REQUEST_PROJECT_MAP",
    payload: { requestId },
  };
}

export function buildRequestLocalServices(requestId: string): RequestLocalServicesMessage | null {
  if (!REQUEST_ID.test(requestId)) return null;
  return { protocol: PROTOCOL, action: "REQUEST_LOCAL_SERVICES", payload: { requestId } };
}

/** Rama, tag o SHA: lo mismo que acepta la extensión (nada que parezca una opción de git). */
const GIT_REF = /^(?!-)[A-Za-z0-9._/@~^{}-]{1,200}$/;

export function isGitRef(value: unknown): value is string {
  return typeof value === "string" && GIT_REF.test(value) && !value.includes("..") && !value.includes("@{");
}

export function buildRequestGitRefs(requestId: string): RequestGitRefsMessage | null {
  if (!REQUEST_ID.test(requestId)) return null;
  return { protocol: PROTOCOL, action: "REQUEST_GIT_REFS", payload: { requestId } };
}

export function buildRequestGitDiff(requestId: string, base: string, head: string | null): RequestGitDiffMessage | null {
  if (!REQUEST_ID.test(requestId) || !isGitRef(base) || (head !== null && !isGitRef(head))) return null;
  return { protocol: PROTOCOL, action: "REQUEST_GIT_DIFF", payload: { requestId, base, head } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIdePayload(payload: unknown): IdeStateChangedPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const activeFile = payload.activeFile;
  const cursorLine = payload.cursorLine;
  const status = payload.status;

  if (typeof activeFile !== "string" || activeFile.length === 0) {
    return null;
  }
  if (typeof cursorLine !== "number" || !Number.isInteger(cursorLine) || cursorLine < 1) {
    return null;
  }
  if (status !== "clean" && status !== "dirty") {
    return null;
  }

  return { activeFile, cursorLine, status };
}

export function parseIdeMessage(raw: string): IdeToCanvasMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(data) || data.protocol !== PROTOCOL || typeof data.action !== "string") {
    return null;
  }

  switch (data.action) {
    case "IDE_STATE_CHANGED": {
      const payload = readIdePayload(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "IDE_STATE_CHANGED", payload };
    }
    case "PROJECT_MAP": {
      const payload = readProjectMapPayload(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "PROJECT_MAP", payload };
    }
    case "PROJECT_MAP_ERROR": {
      const payload = readProjectMapError(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "PROJECT_MAP_ERROR", payload };
    }
    case "SOURCE_FILES_CHANGED": {
      const payload = readSourceFilesChanged(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "SOURCE_FILES_CHANGED", payload };
    }
    case "GIT_REFS": {
      const payload = readGitRefs(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "GIT_REFS", payload };
    }
    case "GIT_DIFF": {
      const payload = readGitDiff(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "GIT_DIFF", payload };
    }
    case "LOCAL_SERVICES_DISCOVERED": {
      const payload = readLocalServices(data.payload);
      if (!payload) return null;
      return { protocol: PROTOCOL, action: "LOCAL_SERVICES_DISCOVERED", payload };
    }
    default:
      return null;
  }
}

function readProjectMapPayload(payload: unknown): ProjectMapPayload | null {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) {
    return null;
  }
  const map = parseProjectMap(payload.map);
  if (!map) return null;
  return { requestId: payload.requestId, map };
}

function readProjectMapError(payload: unknown): ProjectMapErrorPayload | null {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) {
    return null;
  }
  if (typeof payload.message !== "string" || payload.message.length === 0) return null;
  return { requestId: payload.requestId, message: payload.message };
}

const MAX_CHANGED_PATHS = 200;

/** Rutas relativas POSIX, sin `..` ni rutas absolutas: el canvas nunca debe confiar en otra cosa. */
function isRelativeSourcePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}

function readSourceFilesChanged(payload: unknown): SourceFilesChangedPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.changedPaths)) return null;
  const { changedPaths, changedAt } = payload;
  if (changedPaths.length === 0 || changedPaths.length > MAX_CHANGED_PATHS) return null;
  if (!changedPaths.every(isRelativeSourcePath)) return null;
  if (typeof changedAt !== "string" || Number.isNaN(Date.parse(changedAt))) return null;
  return { changedPaths: [...new Set(changedPaths)], changedAt };
}

const SERVICE_KINDS: ReadonlySet<LocalServiceKind> = new Set<LocalServiceKind>([
  "ollama",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "kafka",
  "kafka-ui",
  "schema-registry",
  "rabbitmq",
  "clickhouse",
  "elasticsearch",
  "otel-collector",
  "jaeger",
  "prometheus",
  "grpc",
  "http",
  "unknown",
]);
const SERVICE_ROLES: ReadonlySet<ModuleRole> = new Set<ModuleRole>(["ai-model", "database", "cache", "broker", "stream", "rpc", "api"]);
const MAX_SERVICES = 64;

/**
 * Un servicio local tal como lo anuncia la extensión. Se exige loopback y que la URL (si la hay) apunte
 * al mismo puerto: el lienzo la usa como base URL, así que nunca debe llevar a otro host.
 */
function readLocalService(value: unknown): LocalService | null {
  if (!isRecord(value)) return null;
  const { kind, label, host, port, source } = value;
  if (typeof kind !== "string" || !SERVICE_KINDS.has(kind as LocalServiceKind)) return null;
  if (typeof label !== "string" || label.length === 0 || label.length > 120) return null;
  if (host !== "127.0.0.1") return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (source !== "port" && source !== "docker") return null;
  const service: LocalService = { id: `${kind}:${port}`, kind: kind as LocalServiceKind, label, host, port, source };
  if (value.url !== undefined) {
    if (value.url !== `http://127.0.0.1:${port}`) return null;
    service.url = value.url;
  }
  if (typeof value.container === "string" && value.container.length <= 200) service.container = value.container;
  if (typeof value.image === "string" && value.image.length <= 200) service.image = value.image;
  if (typeof value.suggestedRole === "string" && SERVICE_ROLES.has(value.suggestedRole as ModuleRole)) {
    service.suggestedRole = value.suggestedRole as ModuleRole;
  }
  return service;
}

function readLocalServices(payload: unknown): LocalServicesDiscoveredPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.services) || payload.services.length > MAX_SERVICES) return null;
  const requestId = payload.requestId;
  if (requestId !== null && (typeof requestId !== "string" || !REQUEST_ID.test(requestId))) return null;
  if (typeof payload.scannedAt !== "string" || Number.isNaN(Date.parse(payload.scannedAt))) return null;
  if (typeof payload.dockerAvailable !== "boolean") return null;
  const services = payload.services.map(readLocalService).filter((item): item is LocalService => item !== null);
  return { requestId, services, scannedAt: payload.scannedAt, dockerAvailable: payload.dockerAvailable };
}

const MAX_GIT_FILES = 2000;
const GIT_STATUSES: ReadonlySet<GitFileChange["status"]> = new Set<GitFileChange["status"]>(["added", "modified", "deleted", "renamed"]);

function readGitError(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 300) : undefined;
}

function readGitRefs(payload: unknown): GitRefsPayload | null {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) return null;
  if (!Array.isArray(payload.branches) || !Array.isArray(payload.commits)) return null;
  const current = isGitRef(payload.current) ? payload.current : null;
  const branches = payload.branches.filter(isGitRef).slice(0, 200);
  const commits = payload.commits
    .filter(isRecord)
    .flatMap((commit): GitCommitRef[] =>
      typeof commit.sha === "string" && /^[0-9a-f]{7,64}$/.test(commit.sha) && typeof commit.subject === "string" && typeof commit.date === "string"
        ? [{ sha: commit.sha, subject: commit.subject.slice(0, 200), date: commit.date }]
        : [],
    )
    .slice(0, 100);
  const refs: GitRefsPayload = { requestId: payload.requestId, current, branches, commits };
  const error = readGitError(payload.error);
  if (error) refs.error = error;
  return refs;
}

function readGitDiff(payload: unknown): GitDiffPayload | null {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) return null;
  if (!isGitRef(payload.base) || (payload.head !== null && !isGitRef(payload.head))) return null;
  if (!Array.isArray(payload.files) || payload.files.length > MAX_GIT_FILES) return null;
  const files = payload.files.filter(isRecord).flatMap((file): GitFileChange[] => {
    if (!isRelativeSourcePath(file.path) || !GIT_STATUSES.has(file.status as GitFileChange["status"])) return [];
    const change: GitFileChange = { path: file.path, status: file.status as GitFileChange["status"] };
    if (isRelativeSourcePath(file.previousPath)) change.previousPath = file.previousPath;
    return [change];
  });
  const diff: GitDiffPayload = { requestId: payload.requestId, base: payload.base, head: payload.head as string | null, files };
  const error = readGitError(payload.error);
  if (error) diff.error = error;
  return diff;
}

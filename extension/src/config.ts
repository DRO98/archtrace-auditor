export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  warnings: readonly string[];
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function readServerConfig(
  get: <T>(key: string, defaultValue: T) => T,
): ServerConfig {
  const warnings: string[] = [];

  let host = get("archtrace.host", DEFAULT_HOST);
  if (typeof host !== "string" || !isLoopbackHost(host)) {
    warnings.push(`archtrace.host "${String(host)}" is not a loopback address; using ${DEFAULT_HOST}.`);
    host = DEFAULT_HOST;
  }

  let port = get("archtrace.port", DEFAULT_PORT);
  if (!isValidPort(port)) {
    warnings.push(`archtrace.port "${String(port)}" is not a valid port; using ${DEFAULT_PORT}.`);
    port = DEFAULT_PORT;
  }

  const origins = get<unknown>("archtrace.allowedOrigins", [...DEFAULT_ORIGINS]);
  const allowedOrigins = Array.isArray(origins)
    ? origins.filter((origin): origin is string => typeof origin === "string")
    : [...DEFAULT_ORIGINS];

  return { host, port, allowedOrigins, warnings };
}

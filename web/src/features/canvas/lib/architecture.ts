import type { CodeModule, CodeSubBlock, ModuleRole } from "@core/graph";

const ROLE_TOKENS: ReadonlyArray<{ role: ModuleRole; tokens: ReadonlySet<string> }> = [
  { role: "prompt", tokens: new Set(["prompt", "prompts", "template", "templates"]) },
  { role: "rpc", tokens: new Set(["grpc", "rpc", "proto", "protobuf", "thrift", "stub", "stubs", "servicer"]) },
  { role: "api", tokens: new Set(["api", "route", "routes", "router", "controller", "controllers", "endpoint", "endpoints", "handler", "handlers", "webhook"]) },
  { role: "pipeline", tokens: new Set(["pipeline", "workflow", "flow", "orchestrator", "chain"]) },
  { role: "ai-model", tokens: new Set(["llm", "embed", "embedding", "embeddings", "embedder", "model", "agent", "ai", "openai", "anthropic", "ollama", "ml"]) },
  { role: "stream", tokens: new Set(["flink", "spark", "beam", "streams", "streaming", "kstreams", "windowing"]) },
  { role: "broker", tokens: new Set(["kafka", "rabbit", "rabbitmq", "amqp", "pulsar", "nats", "sqs", "sns", "kinesis", "pubsub", "queue", "queues", "topic", "topics", "producer", "consumer", "broker"]) },
  { role: "cache", tokens: new Set(["cache", "caching", "redis", "memcached", "memcache"]) },
  { role: "database", tokens: new Set(["db", "database", "store", "storage", "repo", "repository", "sql", "vector", "postgres", "postgresql", "mysql", "sqlite", "mongo", "mongodb", "clickhouse", "cassandra", "dynamodb", "orm", "migrations"]) },
  { role: "transform", tokens: new Set(["chunk", "chunker", "parser", "parse", "transform", "format", "formatter", "clean", "normalize"]) },
  { role: "app", tokens: new Set(["app", "main", "bootstrap", "server", "index", "cli"]) },
  { role: "ui", tokens: new Set(["component", "components", "page", "pages", "view", "views", "ui", "layout"]) },
  { role: "service", tokens: new Set(["service", "services"]) },
  { role: "util", tokens: new Set(["util", "utils", "helper", "helpers", "lib", "common", "shared"]) },
];

export function pathTokens(filePath: string): string[] {
  const splitCamel = filePath
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return splitCamel
    .split(/[/_\-.\s]/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0);
}

export function inferRole(module: CodeModule): ModuleRole {
  return roleForPath(module.filePath);
}

/** Rol por palabras clave de la ruta; "code" si ninguna coincide. */
export function roleForPath(filePath: string): ModuleRole {
  const tokens = new Set(pathTokens(filePath));
  for (const category of ROLE_TOKENS) {
    for (const token of category.tokens) {
      if (tokens.has(token)) return category.role;
    }
  }
  return "code";
}

function simpleName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

function isPublicName(name: string): boolean {
  const simple = simpleName(name);
  if (simple.startsWith("_")) return false;
  return !(simple.startsWith("__") && simple.endsWith("__") && simple.length > 4);
}

function byStartLine(left: CodeSubBlock, right: CodeSubBlock): number {
  return left.range.startLine - right.range.startLine;
}

function clip(text: string): string {
  return text.length > 44 ? `${text.slice(0, 43)}…` : text;
}

export function deriveSubtitle(module: CodeModule): string {
  const classes = module.subBlocks.filter((block) => block.kind === "class" && isPublicName(block.name));
  for (const klass of classes) {
    const methods = module.subBlocks
      .filter((block) => block.kind === "method" && block.parentId === klass.id && isPublicName(block.name))
      .sort(byStartLine)
      .slice(0, 3)
      .map((block) => simpleName(block.name));
    if (methods.length > 0) return clip(methods.join(" · "));
  }

  const functions = module.subBlocks
    .filter((block) => block.kind === "function" && isPublicName(block.name))
    .sort(byStartLine)
    .slice(0, 3)
    .map((block) => simpleName(block.name));
  if (functions.length > 0) return clip(functions.join(" · "));

  return clip(`${module.subBlocks.length} bloques`);
}

export function humanizeLabel(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

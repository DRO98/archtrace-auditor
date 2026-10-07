import type { CodeGraph, CodeModule } from "@core/graph";

/**
 * Hechos de la arquitectura que `ARCHITECTURE.md` documenta además del diagrama: rutas de API y
 * tecnologías externas. Heurísticas sobre rutas de archivo, etiquetas y sub-bloques del grafo: no leen
 * el código fuente (el grafo no lo lleva), así que el documento las marca como detectadas.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export interface ApiRoute {
  /** "GET", "POST"… o "ANY" si el archivo no exporta un método concreto; "—" si no se puede inferir. */
  method: string;
  /** Ruta HTTP ("/api/lesson/chat") o "—" si solo se conoce el handler. */
  path: string;
  handler: string;
  moduleId: string;
  moduleLabel: string;
  filePath: string;
  line: number | null;
  /** next-app = `app/**\/route.ts` · next-pages = `pages/api/**` · handler = función de un módulo de API. */
  source: "next-app" | "next-pages" | "handler";
}

const NEXT_APP_ROUTE = /(?:^|\/)app\/(.+?)\/route\.[cm]?[jt]sx?$/;
const NEXT_ROOT_ROUTE = /(?:^|\/)app\/route\.[cm]?[jt]sx?$/;
const NEXT_PAGES_API = /(?:^|\/)pages\/(api(?:\/.+?)?)\.[cm]?[jt]sx?$/;
const HANDLER_PREFIX: readonly [RegExp, string][] = [
  [/^(get|list|read|fetch|search|find|show)_?/i, "GET"],
  [/^(post|create|add|ingest|upload|run|ask|chat|query|submit)_?/i, "POST"],
  [/^(put|update|replace|set)_?/i, "PUT"],
  [/^patch_?/i, "PATCH"],
  [/^(delete|remove|destroy)_?/i, "DELETE"],
];
const MAX_HANDLERS_PER_MODULE = 12;

function topLevelBlocks(item: CodeModule) {
  return item.subBlocks.filter((block) => !block.parentId);
}

function routeSegments(raw: string): string {
  const segments = raw.split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
  return `/${segments.join("/")}`;
}

function methodsOf(item: CodeModule): { method: string; handler: string; line: number | null }[] {
  const exported = topLevelBlocks(item).filter((block) => (HTTP_METHODS as readonly string[]).includes(block.name));
  if (exported.length === 0) return [{ method: "ANY", handler: "default", line: null }];
  return exported.map((block) => ({ method: block.name, handler: block.name, line: block.range.startLine }));
}

function isApiModule(item: CodeModule): boolean {
  if (item.role === "api") return true;
  return /(^|\/)(api|routes?|routers?|endpoints?|controllers?|handlers?|views)(\/|\.|$)/i.test(item.filePath);
}

export function detectApiRoutes(graph: CodeGraph): ApiRoute[] {
  const routes: ApiRoute[] = [];
  for (const item of graph.modules) {
    const path = item.filePath.replace(/\\/g, "/");
    const base = { moduleId: item.id, moduleLabel: item.label, filePath: item.filePath };
    const app = NEXT_APP_ROUTE.exec(path);
    const pages = NEXT_PAGES_API.exec(path);
    if (app || NEXT_ROOT_ROUTE.test(path)) {
      const route = app ? routeSegments(app[1] ?? "") : "/";
      for (const entry of methodsOf(item)) routes.push({ ...base, ...entry, path: route, source: "next-app" });
      continue;
    }
    if (pages) {
      const route = routeSegments((pages[1] ?? "api").replace(/\/index$/, ""));
      for (const entry of methodsOf(item)) routes.push({ ...base, ...entry, path: route, source: "next-pages" });
      continue;
    }
    if (!isApiModule(item)) continue;
    const handlers = topLevelBlocks(item)
      .filter((block) => block.kind === "function" && !block.name.startsWith("_"))
      .slice(0, MAX_HANDLERS_PER_MODULE);
    for (const block of handlers) {
      const verb = (HTTP_METHODS as readonly string[]).includes(block.name.toUpperCase())
        ? block.name.toUpperCase()
        : (HANDLER_PREFIX.find(([pattern]) => pattern.test(block.name))?.[1] ?? "—");
      routes.push({ ...base, method: verb, path: "—", handler: block.name, line: block.range.startLine, source: "handler" });
    }
  }
  const order = (method: string): number => {
    const index = (HTTP_METHODS as readonly string[]).indexOf(method);
    return index === -1 ? HTTP_METHODS.length : index;
  };
  const unknown = (route: ApiRoute): number => (route.path === "—" ? 1 : 0);
  return routes.sort((left, right) => unknown(left) - unknown(right) || left.path.localeCompare(right.path) || order(left.method) - order(right.method) || left.handler.localeCompare(right.handler));
}

export interface DetectedTechnology {
  name: string;
  category: string;
  /** Etiquetas de los módulos donde aparece. */
  modules: string[];
}

const TECHNOLOGIES: readonly { name: string; category: string; pattern: RegExp }[] = [
  { name: "OpenAI", category: "LLM", pattern: /\bopenai\b|\bgpt-?[34]/ },
  { name: "Anthropic Claude", category: "LLM", pattern: /\banthropic\b|\bclaude\b/ },
  { name: "Google Gemini", category: "LLM", pattern: /\bgemini\b|\bgenai\b/ },
  { name: "Ollama", category: "LLM local", pattern: /\bollama\b/ },
  { name: "vLLM", category: "LLM local", pattern: /\bvllm\b/ },
  { name: "Groq", category: "LLM", pattern: /\bgroq\b/ },
  { name: "DeepSeek", category: "LLM", pattern: /\bdeepseek\b/ },
  { name: "LangChain", category: "Orquestación", pattern: /\blangchain\b/ },
  { name: "LlamaIndex", category: "Orquestación", pattern: /\bllama_?index\b/ },
  { name: "Sentence Transformers / Hugging Face", category: "Embeddings", pattern: /sentence[-_]?transformers|hugging_?face|\bhf_/ },
  { name: "FAISS", category: "Vector store", pattern: /\bfaiss\b/ },
  { name: "Chroma", category: "Vector store", pattern: /\bchroma(db)?\b/ },
  { name: "Pinecone", category: "Vector store", pattern: /\bpinecone\b/ },
  { name: "Qdrant", category: "Vector store", pattern: /\bqdrant\b/ },
  { name: "Weaviate", category: "Vector store", pattern: /\bweaviate\b/ },
  { name: "pgvector", category: "Vector store", pattern: /\bpgvector\b/ },
  { name: "Redis", category: "Caché / colas", pattern: /\bredis\b/ },
  { name: "PostgreSQL", category: "Base de datos", pattern: /\bpostgres(ql)?\b|\bpsycopg/ },
  { name: "SQLite", category: "Base de datos", pattern: /\bsqlite\b/ },
  { name: "MongoDB", category: "Base de datos", pattern: /\bmongo(db)?\b/ },
  { name: "FastAPI", category: "Framework web", pattern: /\bfastapi\b/ },
  { name: "Flask", category: "Framework web", pattern: /\bflask\b/ },
  { name: "Django", category: "Framework web", pattern: /\bdjango\b/ },
  { name: "Express", category: "Framework web", pattern: /\bexpress\b/ },
  { name: "Next.js", category: "Framework web", pattern: /\bnext\.config\b|(^|\/)app\/(.+\/)?(route|page|layout)\.[jt]sx?\b/ },
  { name: "WebSocket", category: "Comunicación", pattern: /\bwebsockets?\b|\bws\b|\bsocket/ },
  { name: "Server-Sent Events", category: "Comunicación", pattern: /\bsse\b|event-?stream/ },
  { name: "Docker", category: "Infraestructura", pattern: /\bdocker(file)?\b|\bcompose\b/ },
  { name: "Whisper", category: "Audio", pattern: /\bwhisper\b/ },
  { name: "PDF.js / PyPDF", category: "Ingesta", pattern: /\bpdf(js|\.js|plumber)?\b|\bpypdf\b/ },
];

function haystack(item: CodeModule): string {
  return [item.filePath.replace(/\\/g, "/"), item.label, item.summary, item.subtitle, ...item.subBlocks.map((block) => block.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function detectTechnologies(graph: CodeGraph): DetectedTechnology[] {
  const found = new Map<string, DetectedTechnology>();
  for (const item of graph.modules) {
    if (item.language === "virtual") continue;
    const text = haystack(item);
    for (const tech of TECHNOLOGIES) {
      if (!tech.pattern.test(text)) continue;
      const entry = found.get(tech.name) ?? { name: tech.name, category: tech.category, modules: [] };
      if (!entry.modules.includes(item.label)) entry.modules.push(item.label);
      found.set(tech.name, entry);
    }
  }
  return [...found.values()].sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
}

/** Lenguajes del grafo con su número de módulos (los componentes añadidos en el lienzo no cuentan). */
export function languageBreakdown(graph: CodeGraph): { language: string; modules: number }[] {
  const counts = new Map<string, number>();
  for (const item of graph.modules) {
    if (item.language === "virtual") continue;
    counts.set(item.language, (counts.get(item.language) ?? 0) + 1);
  }
  return [...counts].map(([language, modules]) => ({ language, modules })).sort((left, right) => right.modules - left.modules);
}

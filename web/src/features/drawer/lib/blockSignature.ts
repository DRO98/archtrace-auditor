import type { CodeSubBlock, ModuleRole } from "@core/graph";

/**
 * Firma legible de un bloque según el lenguaje. El grafo no guarda los parámetros, así que se
 * muestran como `(…)` en vez de inventarlos.
 */
export function signatureOf(block: Pick<CodeSubBlock, "kind" | "name">, language: string): string {
  const name = block.name;
  const python = /^py(thon)?$/i.test(language);
  switch (block.kind) {
    case "class":
      return `class ${name}`;
    case "function":
      return python ? `def ${name}(…)` : `function ${name}(…)`;
    case "method":
      return python ? `def ${name}(…)` : `${name}(…)`;
    case "block":
      return name;
  }
}

export interface DataFlow {
  input: string;
  output: string;
}

function words(name: string): string[] {
  return name
    .replace(/^_+|_+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\W]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "handle", "handler", "route", "endpoint", "api"]);

type Rule = { match: (parts: string[], role: ModuleRole) => boolean; flow: DataFlow };

const has = (parts: string[], ...keys: string[]) => parts.some((part) => keys.includes(part));

const RULES: readonly Rule[] = [
  { match: (p) => has(p, "init", "constructor", "new"), flow: { input: "Argumentos", output: "Instancia" } },
  { match: (p, role) => role === "api" && has(p, ...HTTP_VERBS), flow: { input: "Request HTTP", output: "JSON Response" } },
  { match: (p) => has(p, "handle", "handler", "endpoint", "route"), flow: { input: "Petición", output: "Respuesta" } },
  { match: (p) => has(p, "embed", "embedding", "embeddings", "vectorize"), flow: { input: "Texto", output: "Vector" } },
  { match: (p) => has(p, "chunk", "chunks", "split", "tokenize"), flow: { input: "Documento", output: "Fragmentos" } },
  { match: (p) => has(p, "parse", "decode", "deserialize"), flow: { input: "Texto crudo", output: "Estructura" } },
  { match: (p) => has(p, "serialize", "encode", "dump", "dumps", "stringify"), flow: { input: "Objeto", output: "Texto / JSON" } },
  { match: (p) => has(p, "render", "draw", "view"), flow: { input: "Props / estado", output: "UI" } },
  {
    match: (p, role) => has(p, "generate", "answer", "complete", "completion", "ask", "chat") && (role === "ai-model" || role === "prompt" || role === "pipeline" || role === "service"),
    flow: { input: "Prompt", output: "Texto generado" },
  },
  { match: (p) => has(p, "save", "write", "insert", "store", "upsert", "persist", "update", "add"), flow: { input: "Datos", output: "Persistencia" } },
  { match: (p) => has(p, "fetch", "load", "read", "get", "find", "query", "search", "retrieve", "list"), flow: { input: "Consulta", output: "Datos" } },
  { match: (p) => has(p, "validate", "check", "verify", "is", "has", "can"), flow: { input: "Datos", output: "Sí / No" } },
  { match: (p) => has(p, "build", "create", "make", "format", "transform", "convert", "map"), flow: { input: "Datos", output: "Resultado transformado" } },
];

/** Dirección de datos inferida del nombre y el rol. `null` si no hay señal suficiente: mejor nada que inventar. */
export function dataFlowOf(block: Pick<CodeSubBlock, "kind" | "name">, role: ModuleRole): DataFlow | null {
  if (block.kind === "class" || block.kind === "block") return null;
  if (block.name === "__init__") return RULES[0]?.flow ?? null;
  // Los hooks de React (`useX`) no transforman datos en un sentido claro.
  if (/^use[A-Z]/.test(block.name)) return null;
  const parts = words(block.name);
  if (role === "ui" && block.kind === "function" && /^[A-Z]/.test(block.name)) {
    return { input: "Props", output: "UI (JSX)" };
  }
  return RULES.find((rule) => rule.match(parts, role))?.flow ?? null;
}

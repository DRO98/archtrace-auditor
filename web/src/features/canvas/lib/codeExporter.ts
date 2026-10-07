/**
 * "Exportar código" · plantilla RAG: traduce el pipeline RAG del lienzo a un script ejecutable (Python o
 * TypeScript) con los SDK oficiales de cada proveedor. Las plantillas de microservicios HTTP y de eventos
 * viven en `serviceExporter.ts`; `runnableExportProfile` dice si la muestra RAG encaja con el grafo.
 * Funciones puras: el modal solo junta el estado. Las claves nunca se incrustan: se leen del entorno.
 */
import type { CodeGraph } from "@core/graph";
import type { PlaygroundModuleRef, RagStageId } from "@core/playground";
import type { TraceProfileId } from "@core/trace";
import { AI_PROVIDERS, OLLAMA_DEFAULT_URL, type AiProviderId } from "@/lib/ai/catalog";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "@/lib/rag/chunker";
import { DEFAULT_DIMENSIONS } from "@/lib/rag/embedder";
import { ANSWER_SYSTEM_PROMPT, DEFAULT_TOP_K } from "@/lib/rag/pipeline";
import { resolveStageNodes } from "@/lib/rag/stageNodes";
import { isAiGraph } from "./subsystems";

export type CodeLanguage = "python" | "typescript";

/** Perfiles de tracing con muestra RAG ejecutable (HTTP y eventos usan `serviceExporter`). */
export const RUNNABLE_EXPORT_PROFILES: readonly TraceProfileId[] = ["rag"];

/** "rag" si la muestra RAG encaja con el grafo (tiene IA); null si no. */
export function runnableExportProfile(graph: Pick<CodeGraph, "modules">): TraceProfileId | null {
  return isAiGraph(graph) ? "rag" : null;
}
/** `hashing` = el embedder didáctico del lienzo (sin red ni clave); los otros llaman a un modelo real. */
export type EmbedderKind = "hashing" | "openai" | "ollama";

export const EMBEDDER_KINDS: readonly EmbedderKind[] = ["hashing", "openai", "ollama"];
export const EMBEDDER_LABELS: Readonly<Record<EmbedderKind, string>> = {
  hashing: `Bolsa de palabras hasheada (${DEFAULT_DIMENSIONS} dims, local)`,
  openai: "OpenAI text-embedding-3-small",
  ollama: "Ollama nomic-embed-text (local)",
};
const EMBED_MODELS: Readonly<Record<Exclude<EmbedderKind, "hashing">, string>> = {
  openai: "text-embedding-3-small",
  ollama: "nomic-embed-text",
};

export interface CodeExportOptions {
  provider: AiProviderId;
  model: string;
  embedder: EmbedderKind;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}

export interface StageBinding {
  stage: RagStageId;
  label: string;
  filePath: string;
}

export interface CodeExportSpec extends CodeExportOptions {
  projectName: string;
  /** Etapas del pipeline reconocidas en el lienzo, en orden de ejecución. */
  stages: StageBinding[];
  /** Conexiones activas entre módulos de etapa ("Chunker → Embedder"). */
  flow: string[];
  /** Con chunker, embedder o vector store en el lienzo se genera RAG completo; si no, solo la llamada al LLM. */
  retrieval: boolean;
}

export interface CanvasSnapshot {
  projectName: string;
  modules: readonly PlaygroundModuleRef[];
  edges: readonly { source: string; target: string }[];
}

const STAGE_ORDER: readonly RagStageId[] = ["api", "chunker", "embedder", "vector_store", "llm"];
export const STAGE_LABELS: Readonly<Record<RagStageId, string>> = {
  api: "API",
  chunker: "Chunker",
  embedder: "Embedder",
  vector_store: "Vector store",
  llm: "LLM",
};

const ENV_KEYS: Readonly<Record<AiProviderId, string | null>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  ollama: null,
};
/** Proveedores con API compatible con OpenAI: basta cambiar `base_url`. */
const OPENAI_COMPATIBLE_URLS: Partial<Record<AiProviderId, string>> = {
  openai: "",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  ollama: OLLAMA_DEFAULT_URL,
};

export function defaultEmbedder(provider: AiProviderId): EmbedderKind {
  if (provider === "openai") return "openai";
  if (provider === "ollama") return "ollama";
  return "hashing";
}

export function defaultCodeExportOptions(provider: AiProviderId, model: string): CodeExportOptions {
  return {
    provider,
    model,
    embedder: defaultEmbedder(provider),
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    topK: DEFAULT_TOP_K,
  };
}

/** Corrige valores imposibles (solapamiento ≥ ventana, top-k 0…) en vez de generar un script roto. */
export function sanitizeOptions(options: CodeExportOptions): CodeExportOptions {
  const chunkSize = Math.max(1, Math.round(Number.isFinite(options.chunkSize) ? options.chunkSize : DEFAULT_CHUNK_SIZE));
  const overlap = Math.round(Number.isFinite(options.chunkOverlap) ? options.chunkOverlap : 0);
  const topK = Math.round(Number.isFinite(options.topK) ? options.topK : DEFAULT_TOP_K);
  return {
    ...options,
    model: options.model.trim() || AI_PROVIDERS[options.provider].models[0]?.id || "",
    chunkSize,
    chunkOverlap: Math.min(Math.max(0, overlap), chunkSize - 1),
    topK: Math.max(1, topK),
  };
}

/**
 * Lee el lienzo: qué módulo hace de cada etapa y qué conexiones hay entre ellos. Solo cuentan los
 * módulos conectados (los aislados no se dibujan), salvo que el lienzo no tenga aristas.
 */
export function buildCodeExportSpec(canvas: CanvasSnapshot, options: CodeExportOptions): CodeExportSpec {
  const connected = new Set(canvas.edges.flatMap((edge) => [edge.source, edge.target]));
  const modules = connected.size > 0 ? canvas.modules.filter((item) => connected.has(item.id)) : canvas.modules;
  const byId = new Map(modules.map((item) => [item.id, item]));
  const resolved = resolveStageNodes(modules);

  const stages: StageBinding[] = [];
  const stageByModule = new Map<string, RagStageId>();
  for (const stage of STAGE_ORDER) {
    const stageModule = resolved[stage] ? byId.get(resolved[stage]) : undefined;
    if (!stageModule || stageByModule.has(stageModule.id)) continue;
    stageByModule.set(stageModule.id, stage);
    stages.push({ stage, label: stageModule.label, filePath: stageModule.filePath });
  }

  const flow = new Set<string>();
  for (const edge of canvas.edges) {
    const from = stageByModule.get(edge.source);
    const to = stageByModule.get(edge.target);
    if (from && to && from !== to) flow.add(`${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`);
  }

  return {
    ...sanitizeOptions(options),
    projectName: canvas.projectName,
    stages,
    flow: [...flow],
    retrieval: stages.some((item) => item.stage === "chunker" || item.stage === "embedder" || item.stage === "vector_store"),
  };
}

export function codeFilename(language: CodeLanguage, slug: string): string {
  return language === "python" ? `${slug.replace(/-/g, "_")}_rag.py` : `${slug}-rag.ts`;
}

export function generateCode(language: CodeLanguage, spec: CodeExportSpec, file?: string): string {
  return language === "python" ? generatePython(spec, file) : generateTypeScript(spec, file);
}

/** Literal de cadena válido en Python y en TypeScript. */
function str(value: string): string {
  return JSON.stringify(value);
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function headerLines(spec: CodeExportSpec, comment: string, install: string, run: string): string[] {
  const provider = AI_PROVIDERS[spec.provider].label;
  const lines = [
    `${oneLine(spec.projectName)} — ${spec.retrieval ? "pipeline RAG" : "llamada al LLM"} exportado desde ArchTrace.`,
    "",
    `Proveedor: ${provider} · modelo ${spec.model}`,
  ];
  if (spec.retrieval) {
    lines.push(`Chunker: ventana ${spec.chunkSize} · solapamiento ${spec.chunkOverlap} · top-k ${spec.topK}`);
    lines.push(`Embedder: ${EMBEDDER_LABELS[spec.embedder]}`);
  }
  lines.push("", "Etapas detectadas en el lienzo:");
  if (spec.stages.length === 0) lines.push("  (ninguna: se genera el pipeline por defecto)");
  for (const item of spec.stages) {
    lines.push(`  - ${STAGE_LABELS[item.stage].padEnd(12)} ← ${oneLine(item.filePath)} (${oneLine(item.label)})`);
  }
  if (spec.flow.length > 0) lines.push(`Conexiones: ${spec.flow.join(" · ")}`);
  lines.push("", `Instalar: ${install}`, `Ejecutar: ${run}`);
  for (const env of requiredEnv(spec)) lines.push(`Necesita la variable de entorno ${env}.`);
  return lines.map((line) => (line ? `${comment} ${line}` : comment));
}

function requiredEnv(spec: CodeExportSpec): string[] {
  const env = new Set<string>();
  const llmKey = ENV_KEYS[spec.provider];
  if (llmKey) env.add(llmKey);
  if (spec.retrieval && spec.embedder === "openai") env.add("OPENAI_API_KEY");
  return [...env];
}

function usesOpenAiSdk(spec: CodeExportSpec): boolean {
  return spec.provider in OPENAI_COMPATIBLE_URLS || (spec.retrieval && spec.embedder !== "hashing");
}

// ─── Python ───────────────────────────────────────────────────────────────────

function pythonPackages(spec: CodeExportSpec): string[] {
  const packages = new Set<string>();
  if (usesOpenAiSdk(spec)) packages.add("openai");
  if (spec.provider === "anthropic") packages.add("anthropic");
  if (spec.provider === "gemini") packages.add("google-genai");
  return [...packages];
}

function pythonOpenAiClient(name: string, provider: AiProviderId): string {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  const env = ENV_KEYS[provider];
  const args = [env ? `api_key=os.environ[${str(env)}]` : `api_key="ollama"`];
  if (url) args.push(`base_url=${str(url)}`);
  return `${name} = OpenAI(${args.join(", ")})`;
}

function pythonLlm(spec: CodeExportSpec): string[] {
  if (spec.provider === "anthropic") {
    return [
      "llm_client = anthropic.Anthropic(api_key=os.environ[\"ANTHROPIC_API_KEY\"])",
      "",
      "",
      "def complete(system: str, user: str) -> str:",
      "    response = llm_client.messages.create(",
      "        model=LLM_MODEL,",
      "        max_tokens=1024,",
      "        system=system,",
      "        messages=[{\"role\": \"user\", \"content\": user}],",
      "    )",
      "    return \"\".join(block.text for block in response.content if block.type == \"text\")",
    ];
  }
  if (spec.provider === "gemini") {
    return [
      "llm_client = genai.Client(api_key=os.environ[\"GEMINI_API_KEY\"])",
      "",
      "",
      "def complete(system: str, user: str) -> str:",
      "    response = llm_client.models.generate_content(",
      "        model=LLM_MODEL,",
      "        contents=user,",
      "        config=types.GenerateContentConfig(system_instruction=system),",
      "    )",
      "    return response.text or \"\"",
    ];
  }
  return [
    pythonOpenAiClient("llm_client", spec.provider),
    "",
    "",
    "def complete(system: str, user: str) -> str:",
    "    response = llm_client.chat.completions.create(",
    "        model=LLM_MODEL,",
    "        messages=[",
    "            {\"role\": \"system\", \"content\": system},",
    "            {\"role\": \"user\", \"content\": user},",
    "        ],",
    "    )",
    "    return response.choices[0].message.content or \"\"",
  ];
}

function pythonEmbedder(spec: CodeExportSpec): string[] {
  if (spec.embedder === "hashing") {
    return [
      `EMBED_DIMENSIONS = ${DEFAULT_DIMENSIONS}`,
      "",
      "",
      "def _normalize(token: str) -> str:",
      "    return \"\".join(char for char in token.lower() if char.isalnum())",
      "",
      "",
      "def _fnv1a(text: str) -> int:",
      "    value = 0x811C9DC5",
      "    for char in text:",
      "        value ^= ord(char)",
      "        value = (value * 0x01000193) & 0xFFFFFFFF",
      "    return value",
      "",
      "",
      "def embed(text: str) -> list[float]:",
      "    \"\"\"Bolsa de palabras hasheada a un ancho fijo, normalizada por el total de tokens.\"\"\"",
      "    vector = [0.0] * EMBED_DIMENSIONS",
      "    tokens = [token for token in (_normalize(raw) for raw in text.split()) if token]",
      "    for token in tokens:",
      "        vector[_fnv1a(token) % EMBED_DIMENSIONS] += 1 / len(tokens)",
      "    return vector",
      "",
      "",
      "def embed_many(texts: list[str]) -> list[list[float]]:",
      "    return [embed(text) for text in texts]",
    ];
  }
  const provider: AiProviderId = spec.embedder === "openai" ? "openai" : "ollama";
  return [
    `EMBED_MODEL = ${str(EMBED_MODELS[spec.embedder])}`,
    pythonOpenAiClient("embed_client", provider),
    "",
    "",
    "def embed_many(texts: list[str]) -> list[list[float]]:",
    "    response = embed_client.embeddings.create(model=EMBED_MODEL, input=texts)",
    "    return [item.embedding for item in response.data]",
  ];
}

export function generatePython(spec: CodeExportSpec, file = "rag.py"): string {
  const imports = ["import os", "import sys"];
  if (spec.retrieval) imports.unshift("import math");
  if (spec.retrieval) imports.push("from dataclasses import dataclass");
  if (usesOpenAiSdk(spec)) imports.push("", "from openai import OpenAI");
  if (spec.provider === "anthropic") imports.push("", "import anthropic");
  if (spec.provider === "gemini") imports.push("", "from google import genai", "from google.genai import types");

  const run = spec.retrieval ? `python ${file} documento.txt "¿Tu pregunta?"` : `python ${file} "¿Tu pregunta?"`;
  const lines = [
    ...headerLines(spec, "#", `pip install ${pythonPackages(spec).join(" ")}`, run),
    "",
    ...imports,
    "",
    `LLM_MODEL = ${str(spec.model)}`,
  ];
  if (spec.retrieval) {
    lines.push(`CHUNK_SIZE = ${spec.chunkSize}`, `CHUNK_OVERLAP = ${spec.chunkOverlap}`, `TOP_K = ${spec.topK}`);
  }
  lines.push(`SYSTEM_PROMPT = ${str(ANSWER_SYSTEM_PROMPT)}`, "");

  if (spec.retrieval) {
    lines.push(
      "",
      "# ─── Chunker ───────────────────────────────────────────────────────────────",
      "def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:",
      "    \"\"\"Ventanas de `size` caracteres que se solapan `overlap` caracteres.\"\"\"",
      "    cleaned = \" \".join(text.split())",
      "    if not cleaned:",
      "        return []",
      "    if len(cleaned) <= size:",
      "        return [cleaned]",
      "    step = size - overlap",
      "    chunks: list[str] = []",
      "    start = 0",
      "    while start < len(cleaned):",
      "        end = min(start + size, len(cleaned))",
      "        window = cleaned[start:end].strip()",
      "        if window:",
      "            chunks.append(window)",
      "        if end == len(cleaned):",
      "            break",
      "        start += step",
      "    return chunks",
      "",
      "",
      "# ─── Embedder ──────────────────────────────────────────────────────────────",
      ...pythonEmbedder(spec),
      "",
      "",
      "# ─── Vector store (en memoria, similitud coseno) ───────────────────────────",
      "@dataclass",
      "class Record:",
      "    id: str",
      "    text: str",
      "    vector: list[float]",
      "",
      "",
      "def cosine(a: list[float], b: list[float]) -> float:",
      "    dot = sum(x * y for x, y in zip(a, b))",
      "    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))",
      "    return dot / norm if norm else 0.0",
      "",
      "",
      "class VectorStore:",
      "    def __init__(self) -> None:",
      "        self.records: list[Record] = []",
      "",
      "    def add_many(self, records: list[Record]) -> None:",
      "        self.records.extend(records)",
      "",
      "    def search(self, query: list[float], k: int = TOP_K) -> list[tuple[float, Record]]:",
      "        scored = [(cosine(query, record.vector), record) for record in self.records]",
      "        scored.sort(key=lambda pair: pair[0], reverse=True)",
      "        return scored[:k]",
      "",
      "",
    );
  } else {
    lines.push("");
  }

  lines.push(
    "# ─── LLM ───────────────────────────────────────────────────────────────────",
    ...pythonLlm(spec),
    "",
    "",
  );

  if (spec.retrieval) {
    lines.push(
      "def build_prompt(question: str, hits: list[tuple[float, Record]]) -> str:",
      "    context = \"\\n\".join(f\"[{index}] {record.text}\" for index, (_, record) in enumerate(hits, 1))",
      "    return f\"Question: {question}\\nContext:\\n{context or '(sin contexto)'}\"",
      "",
      "",
      "def main() -> None:",
      "    if len(sys.argv) < 3:",
      `        sys.exit(${str(`Uso: ${run}`)})`,
      "    path, question = sys.argv[1], \" \".join(sys.argv[2:])",
      "    with open(path, encoding=\"utf-8\") as handle:",
      "        chunks = chunk_text(handle.read())",
      "    if not chunks:",
      "        sys.exit(\"El documento está vacío.\")",
      "",
      "    store = VectorStore()",
      "    vectors = embed_many(chunks)",
      "    store.add_many([Record(f\"{path}:{i}\", text, vector) for i, (text, vector) in enumerate(zip(chunks, vectors))])",
      "    hits = store.search(embed_many([question])[0])",
      "    for score, record in hits:",
      "        print(f\"  {score:.3f}  {record.id}\")",
      "",
      "    print(complete(SYSTEM_PROMPT, build_prompt(question, hits)))",
    );
  } else {
    lines.push(
      "def main() -> None:",
      "    if len(sys.argv) < 2:",
      `        sys.exit(${str(`Uso: ${run}`)})`,
      "    print(complete(SYSTEM_PROMPT, \" \".join(sys.argv[1:])))",
    );
  }
  lines.push("", "", "if __name__ == \"__main__\":", "    main()", "");
  return lines.join("\n");
}

// ─── TypeScript ───────────────────────────────────────────────────────────────

function tsPackages(spec: CodeExportSpec): string[] {
  const packages = new Set<string>();
  if (usesOpenAiSdk(spec)) packages.add("openai");
  if (spec.provider === "anthropic") packages.add("@anthropic-ai/sdk");
  if (spec.provider === "gemini") packages.add("@google/genai");
  packages.add("tsx");
  return [...packages];
}

function tsOpenAiClient(name: string, provider: AiProviderId): string {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  const env = ENV_KEYS[provider];
  const args = [env ? `apiKey: requiredEnv(${str(env)})` : `apiKey: "ollama"`];
  if (url) args.push(`baseURL: ${str(url)}`);
  return `const ${name} = new OpenAI({ ${args.join(", ")} });`;
}

function tsLlm(spec: CodeExportSpec): string[] {
  if (spec.provider === "anthropic") {
    return [
      "const llmClient = new Anthropic({ apiKey: requiredEnv(\"ANTHROPIC_API_KEY\") });",
      "",
      "async function complete(system: string, user: string): Promise<string> {",
      "  const response = await llmClient.messages.create({",
      "    model: LLM_MODEL,",
      "    max_tokens: 1024,",
      "    system,",
      "    messages: [{ role: \"user\", content: user }],",
      "  });",
      "  return response.content.map((block) => (block.type === \"text\" ? block.text : \"\")).join(\"\");",
      "}",
    ];
  }
  if (spec.provider === "gemini") {
    return [
      "const llmClient = new GoogleGenAI({ apiKey: requiredEnv(\"GEMINI_API_KEY\") });",
      "",
      "async function complete(system: string, user: string): Promise<string> {",
      "  const response = await llmClient.models.generateContent({",
      "    model: LLM_MODEL,",
      "    contents: user,",
      "    config: { systemInstruction: system },",
      "  });",
      "  return response.text ?? \"\";",
      "}",
    ];
  }
  return [
    tsOpenAiClient("llmClient", spec.provider),
    "",
    "async function complete(system: string, user: string): Promise<string> {",
    "  const response = await llmClient.chat.completions.create({",
    "    model: LLM_MODEL,",
    "    messages: [",
    "      { role: \"system\", content: system },",
    "      { role: \"user\", content: user },",
    "    ],",
    "  });",
    "  return response.choices[0]?.message.content ?? \"\";",
    "}",
  ];
}

function tsEmbedder(spec: CodeExportSpec): string[] {
  if (spec.embedder === "hashing") {
    return [
      `const EMBED_DIMENSIONS = ${DEFAULT_DIMENSIONS};`,
      "",
      "function normalizeToken(token: string): string {",
      "  return [...token.toLowerCase()].filter((char) => /[\\p{L}\\p{N}]/u.test(char)).join(\"\");",
      "}",
      "",
      "function fnv1a(text: string): number {",
      "  let hash = 0x811c9dc5;",
      "  for (let index = 0; index < text.length; index += 1) {",
      "    hash ^= text.charCodeAt(index);",
      "    hash = Math.imul(hash, 0x01000193);",
      "  }",
      "  return hash >>> 0;",
      "}",
      "",
      "/** Bolsa de palabras hasheada a un ancho fijo, normalizada por el total de tokens. */",
      "function embed(text: string): number[] {",
      "  const vector = new Array<number>(EMBED_DIMENSIONS).fill(0);",
      "  const tokens = text.split(/\\s+/).map(normalizeToken).filter(Boolean);",
      "  for (const token of tokens) vector[fnv1a(token) % EMBED_DIMENSIONS] += 1 / tokens.length;",
      "  return vector;",
      "}",
      "",
      "async function embedMany(texts: string[]): Promise<number[][]> {",
      "  return texts.map(embed);",
      "}",
    ];
  }
  const provider: AiProviderId = spec.embedder === "openai" ? "openai" : "ollama";
  return [
    `const EMBED_MODEL = ${str(EMBED_MODELS[spec.embedder])};`,
    tsOpenAiClient("embedClient", provider),
    "",
    "async function embedMany(texts: string[]): Promise<number[][]> {",
    "  const response = await embedClient.embeddings.create({ model: EMBED_MODEL, input: texts });",
    "  return response.data.map((item) => item.embedding);",
    "}",
  ];
}

export function generateTypeScript(spec: CodeExportSpec, file = "rag.ts"): string {
  const imports: string[] = [];
  if (spec.retrieval) imports.push("import { readFile } from \"node:fs/promises\";");
  if (spec.provider === "anthropic") imports.push("import Anthropic from \"@anthropic-ai/sdk\";");
  if (spec.provider === "gemini") imports.push("import { GoogleGenAI } from \"@google/genai\";");
  if (usesOpenAiSdk(spec)) imports.push("import OpenAI from \"openai\";");

  const run = spec.retrieval ? `npx tsx ${file} documento.txt "¿Tu pregunta?"` : `npx tsx ${file} "¿Tu pregunta?"`;
  const lines = [
    ...headerLines(spec, "//", `npm install ${tsPackages(spec).join(" ")}`, run),
    "",
    ...imports,
    "",
    `const LLM_MODEL = ${str(spec.model)};`,
  ];
  if (spec.retrieval) {
    lines.push(`const CHUNK_SIZE = ${spec.chunkSize};`, `const CHUNK_OVERLAP = ${spec.chunkOverlap};`, `const TOP_K = ${spec.topK};`);
  }
  lines.push(
    `const SYSTEM_PROMPT = ${str(ANSWER_SYSTEM_PROMPT)};`,
    "",
    "function requiredEnv(name: string): string {",
    "  const value = process.env[name];",
    "  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);",
    "  return value;",
    "}",
    "",
  );

  if (spec.retrieval) {
    lines.push(
      "// ─── Chunker ─────────────────────────────────────────────────────────────────",
      "/** Ventanas de `size` caracteres que se solapan `overlap` caracteres. */",
      "function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {",
      "  const cleaned = text.split(/\\s+/).filter(Boolean).join(\" \");",
      "  if (!cleaned) return [];",
      "  if (cleaned.length <= size) return [cleaned];",
      "  const step = size - overlap;",
      "  const chunks: string[] = [];",
      "  for (let start = 0; start < cleaned.length; start += step) {",
      "    const end = Math.min(start + size, cleaned.length);",
      "    const window = cleaned.slice(start, end).trim();",
      "    if (window) chunks.push(window);",
      "    if (end === cleaned.length) break;",
      "  }",
      "  return chunks;",
      "}",
      "",
      "// ─── Embedder ────────────────────────────────────────────────────────────────",
      ...tsEmbedder(spec),
      "",
      "// ─── Vector store (en memoria, similitud coseno) ─────────────────────────────",
      "interface VectorRecord {",
      "  id: string;",
      "  text: string;",
      "  vector: number[];",
      "}",
      "",
      "interface Hit {",
      "  score: number;",
      "  record: VectorRecord;",
      "}",
      "",
      "function cosine(a: number[], b: number[]): number {",
      "  let dot = 0;",
      "  let normA = 0;",
      "  let normB = 0;",
      "  for (let index = 0; index < a.length; index += 1) {",
      "    dot += a[index] * (b[index] ?? 0);",
      "    normA += a[index] * a[index];",
      "    normB += (b[index] ?? 0) * (b[index] ?? 0);",
      "  }",
      "  const norm = Math.sqrt(normA) * Math.sqrt(normB);",
      "  return norm ? dot / norm : 0;",
      "}",
      "",
      "class VectorStore {",
      "  private readonly records: VectorRecord[] = [];",
      "",
      "  addMany(records: VectorRecord[]): void {",
      "    this.records.push(...records);",
      "  }",
      "",
      "  search(query: number[], k = TOP_K): Hit[] {",
      "    return this.records",
      "      .map((record) => ({ score: cosine(query, record.vector), record }))",
      "      .sort((a, b) => b.score - a.score)",
      "      .slice(0, k);",
      "  }",
      "}",
      "",
    );
  }

  lines.push("// ─── LLM ─────────────────────────────────────────────────────────────────────", ...tsLlm(spec), "");

  if (spec.retrieval) {
    lines.push(
      "function buildPrompt(question: string, hits: Hit[]): string {",
      "  const context = hits.map((hit, index) => `[${index + 1}] ${hit.record.text}`).join(\"\\n\");",
      "  return `Question: ${question}\\nContext:\\n${context || \"(sin contexto)\"}`;",
      "}",
      "",
      "async function main(): Promise<void> {",
      "  const [path, ...words] = process.argv.slice(2);",
      `  if (!path || words.length === 0) throw new Error(${str(`Uso: ${run}`)});`,
      "  const question = words.join(\" \");",
      "  const chunks = chunkText(await readFile(path, \"utf8\"));",
      "  if (chunks.length === 0) throw new Error(\"El documento está vacío.\");",
      "",
      "  const store = new VectorStore();",
      "  const vectors = await embedMany(chunks);",
      "  store.addMany(chunks.map((text, index) => ({ id: `${path}:${index}`, text, vector: vectors[index] })));",
      "  const [queryVector] = await embedMany([question]);",
      "  const hits = store.search(queryVector);",
      "  for (const hit of hits) console.log(`  ${hit.score.toFixed(3)}  ${hit.record.id}`);",
      "",
      "  console.log(await complete(SYSTEM_PROMPT, buildPrompt(question, hits)));",
      "}",
    );
  } else {
    lines.push(
      "async function main(): Promise<void> {",
      "  const question = process.argv.slice(2).join(\" \");",
      `  if (!question) throw new Error(${str(`Uso: ${run}`)});`,
      "  console.log(await complete(SYSTEM_PROMPT, question));",
      "}",
    );
  }
  lines.push(
    "",
    "main().catch((error: unknown) => {",
    "  console.error(error instanceof Error ? error.message : error);",
    "  process.exit(1);",
    "});",
    "",
  );
  return lines.join("\n");
}

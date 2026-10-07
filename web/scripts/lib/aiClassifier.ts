import type { GroupColor, ModuleSubsystem } from "@core/graph";
import { AiError, type AiProvider } from "../../src/lib/ai/types";
import { pathTokens } from "../../src/features/canvas/lib/architecture";
import { DEFAULT_SUBSYSTEMS } from "../../src/features/canvas/lib/subsystems";

export type Layer = 0 | 1 | 2 | 3 | 4;

/** Lo único que viaja al modelo: ruta, imports y firmas (+ docstring del módulo si existe). */
export interface ModuleDigest {
  path: string;
  imports: readonly string[];
  signatures: readonly string[];
  doc?: string;
}

export interface AiClassification {
  layer: Layer;
  /** Nombre corto tal como lo devuelve el modelo ("Ingestion", "Storage"…). */
  subsystem: string;
  reasoning: string;
}

/** Equivalente JSON Schema de z.object({ layer: 0|1|2|3|4, subsystem: string, reasoning: string }), en lote. */
export const CLASSIFICATION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["modules"],
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "layer", "subsystem", "reasoning"],
        properties: {
          index: { type: "integer", description: "Número entre corchetes del módulo en la lista" },
          layer: { type: "integer", enum: [0, 1, 2, 3, 4] },
          subsystem: {
            type: "string",
            description: "Nombre corto del subsistema funcional, ej. Ingestion, RAG, Storage, API",
          },
          reasoning: { type: "string", description: "Motivo breve en 1 línea" },
        },
      },
    },
  },
};

/** Tope por llamada: mantiene la respuesta corta y acotada aunque el proyecto sea grande. */
export const MAX_BATCH = 25;
const MAX_SIGNATURES = 12;
const MAX_IMPORTS = 15;
const LINE_CAP = 140;
const DOC_CAP = 300;
const HEAD_LINES = 30;

const SYSTEM_PROMPT = `Clasificas módulos de código de un sistema (a menudo una app de IA/RAG) en capas de ejecución, de izquierda a derecha:
0 = Entrada: HTTP, API, controllers, CLI, bootstrap, main.
1 = Preproceso: chunkers, parsers, tokenizers, cleaners, loaders de documentos.
2 = Índice / Almacenamiento: embedders, vector stores, bases de datos, caches, repositorios.
3 = Orquestación: pipelines, workflows, services de coordinación, agents.
4 = Generación / Salida: servicios LLM, prompts, formatters, construcción de respuestas.
Decide por lo que el código HACE (imports y firmas), no solo por el nombre del archivo.
Para "subsystem" reutiliza uno de estos si encaja: ${DEFAULT_SUBSYSTEMS.map((item) => item.label).join(", ")}. Si no, da un nombre corto (1-3 palabras).
Devuelve una entrada por cada módulo, con su mismo index.`;

/**
 * Resumen mínimo de un archivo Python para el prompt. Solo mira las primeras líneas para
 * imports/docstring y las firmas ya detectadas por el escáner.
 */
export function digestPythonModule(path: string, source: string, blocks: ReadonlyArray<{ kind: string; startLine: number }>): ModuleDigest {
  const lines = source.split(/\r?\n/);
  const imports = lines
    .slice(0, Math.max(HEAD_LINES, 60))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("import ") || line.startsWith("from "))
    .slice(0, MAX_IMPORTS)
    .map(clipLine);
  // Clases y funciones de primer nivel antes que métodos: dicen más con menos tokens.
  const signatures = [...blocks]
    .sort((left, right) => Number(left.kind === "method") - Number(right.kind === "method") || left.startLine - right.startLine)
    .slice(0, MAX_SIGNATURES)
    .map((block) => clipLine((lines[block.startLine - 1] ?? "").trim()))
    .filter((line) => line.length > 0);
  const doc = moduleDocstring(lines.slice(0, HEAD_LINES));
  return doc ? { path, imports, signatures, doc } : { path, imports, signatures };
}

export function buildClassifierUserMessage(files: readonly ModuleDigest[]): string {
  return files
    .map((file, index) => {
      const parts = [`[${index}] ${file.path}`];
      if (file.doc) parts.push(`  doc: ${file.doc}`);
      if (file.imports.length > 0) parts.push(`  imports: ${file.imports.join(" | ")}`);
      if (file.signatures.length > 0) parts.push(`  defs: ${file.signatures.join(" | ")}`);
      return parts.join("\n");
    })
    .join("\n");
}

/**
 * Clasifica varios módulos en una sola llamada. Las entradas inválidas o ausentes se
 * omiten del resultado (el llamador decide el fallback); nunca lanza por un item suelto.
 */
export async function classifyModulesWithAI(
  files: readonly ModuleDigest[],
  provider: AiProvider,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<Map<string, AiClassification>> {
  const result = new Map<string, AiClassification>();
  if (files.length === 0) return result;
  if (files.length > MAX_BATCH) throw new AiError("bad_response", `Lote demasiado grande (${files.length} > ${MAX_BATCH}).`);

  const raw = await provider.completeJson(
    {
      system: SYSTEM_PROMPT,
      user: buildClassifierUserMessage(files),
      schema: CLASSIFICATION_JSON_SCHEMA,
      schemaName: "module_layers",
      maxTokens: 200 + files.length * 90,
    },
    signal,
  );
  for (const [index, classification] of parseClassifications(raw, files.length)) {
    const file = files[index];
    if (file) result.set(file.path, classification);
  }
  return result;
}

export async function classifyModuleWithAI(
  fileInfo: { path: string; snippet?: string },
  provider: AiProvider,
): Promise<{ layer: Layer; subsystem: string }> {
  const lines = (fileInfo.snippet ?? "").split(/\r?\n/).slice(0, HEAD_LINES);
  const signatures = lines.map((line) => line.trim()).filter((line) => /^(async\s+)?(def|class)\s/.test(line));
  const digest = digestPythonModule(fileInfo.path, lines.join("\n"), []);
  const found = (await classifyModulesWithAI([{ ...digest, signatures: signatures.map(clipLine) }], provider)).get(fileInfo.path);
  if (!found) throw new AiError("bad_response", `La IA no clasificó ${fileInfo.path}.`);
  return { layer: found.layer, subsystem: found.subsystem };
}

export function parseClassifications(raw: unknown, count: number): Map<number, AiClassification> {
  const parsed = new Map<number, AiClassification>();
  if (!isRecord(raw) || !Array.isArray(raw.modules)) return parsed;
  for (const entry of raw.modules) {
    if (!isRecord(entry)) continue;
    const { index, layer, subsystem, reasoning } = entry;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) continue;
    if (!isLayer(layer)) continue;
    if (typeof subsystem !== "string" || subsystem.trim().length === 0) continue;
    parsed.set(index, {
      layer,
      subsystem: subsystem.trim().slice(0, 40),
      reasoning: typeof reasoning === "string" ? reasoning.trim().slice(0, 200) : "",
    });
  }
  return parsed;
}

const PALETTE: readonly GroupColor[] = ["sky", "emerald", "rose", "violet", "amber", "zinc"];

/**
 * Traduce el nombre libre del modelo a un subsistema del grafo: reutiliza el catálogo por
 * defecto si comparte alguna palabra clave ("Storage" → infra, "RAG" → rag-core) y si no,
 * registra uno nuevo en `extra` con un color libre.
 */
export function resolveSubsystemName(name: string, extra: ModuleSubsystem[]): string {
  const tokens = pathTokens(name);
  for (const known of DEFAULT_SUBSYSTEMS) {
    const vocabulary = new Set([...known.tokens, ...pathTokens(`${known.id} ${known.label}`)]);
    vocabulary.delete("core");
    if (tokens.some((token) => vocabulary.has(token))) return known.id;
  }
  const id = tokens.join("-") || "misc";
  if (!extra.some((item) => item.id === id)) {
    const taken = new Set([...DEFAULT_SUBSYSTEMS, ...extra].map((item) => item.color));
    const color = PALETTE.find((item) => !taken.has(item)) ?? PALETTE[extra.length % PALETTE.length] ?? "zinc";
    extra.push({ id, label: name.trim(), color });
  }
  return id;
}

function moduleDocstring(head: readonly string[]): string | undefined {
  const text = head.join("\n").trimStart();
  const quote = text.startsWith('"""') ? '"""' : text.startsWith("'''") ? "'''" : null;
  if (!quote) return undefined;
  const end = text.indexOf(quote, 3);
  const body = (end < 0 ? text.slice(3) : text.slice(3, end)).replace(/\s+/g, " ").trim();
  return body ? body.slice(0, DOC_CAP) : undefined;
}

function clipLine(line: string): string {
  return line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 1)}…` : line;
}

function isLayer(value: unknown): value is Layer {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

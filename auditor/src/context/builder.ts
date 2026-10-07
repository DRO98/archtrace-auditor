import type { ChangeUnit, DiffSide, RuleRef, Signal } from "@core/audit";
import { approximateTokens } from "@llm/costEstimate";
import { enclosingSymbol, type FileVersions } from "../changes/units";
import type { DocSection } from "../docs/sections";
import { splitLines } from "../git/changes";
import type { Retriever } from "../retrieval/bm25";
import type { RelatedSymbols } from "../retrieval/vectorIndex";

/** Presupuesto de tokens por bloque de contexto. */
export const CONTEXT_BUDGET = { diff: 1500, enclosing: 2500, structure: 1200, docs: 1200 } as const;

/** Niveles implementados en el MVP: L0 hunk, L1 función envolvente, L2 clase + imports + firmas. L4 (docs) va siempre. */
export const CONTEXT_LEVELS = [0, 1, 2] as const;
export const MAX_LEVEL = 2;

export interface ContextInput {
  unit: ChangeUnit;
  signals: readonly Signal[];
  versions: FileVersions;
  /** Texto completo de cada versión del archivo (cacheado por quien llama). */
  readText(side: DiffSide): Promise<string | null>;
  retriever: Retriever;
  /** Reglas que ya casan por categoría (se incluyen antes que las de BM25). */
  categoryRules: readonly RuleRef[];
  sectionsById: ReadonlyMap<string, DocSection>;
  /** Símbolos parecidos de otros archivos (RAG vectorial); ausente con solo BM25. */
  related?: RelatedSymbols | null;
  taskId?: string;
}

export interface BuiltContext {
  level: number;
  text: string;
  tokens: number;
  tokensByPart: Record<string, number>;
  sectionIds: string[];
}

const SECRET_PATTERNS: RegExp[] = [
  /((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key)\w*["']?\s*[:=]\s*["'])[^"'\s]{4,}(["'])/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/** Nada con pinta de credencial sale hacia el LLM. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string, suffix?: string) =>
      typeof prefix === "string" && typeof suffix === "string" && match.startsWith(prefix) ? `${prefix}«redactado»${suffix}` : "«redactado»",
    );
  }
  return out;
}

function clip(text: string, tokens: number): string {
  const max = tokens * 4;
  return text.length <= max ? text : `${text.slice(0, max)}\n… [recortado: presupuesto de ${tokens} tokens]`;
}

function numbered(lines: readonly string[], from: number, to: number): string {
  const out: string[] = [];
  for (let line = from; line <= to; line += 1) out.push(`${String(line).padStart(5)}| ${lines[line - 1] ?? ""}`);
  return out.join("\n");
}

function diffBlock(unit: ChangeUnit): string {
  return unit.lines.map((line) => `${line.kind === "add" ? "+" : "-"}${String(line.line).padStart(5)}| ${line.text}`).join("\n");
}

/** Lado principal de la unidad: head si añade algo, si no base (solo borrados). */
function primarySide(unit: ChangeUnit): DiffSide {
  return unit.headLines ? "head" : "base";
}

/**
 * Contexto progresivo y acotado por presupuesto. Cada nivel incluye los anteriores; L4 (secciones de reglas del
 * repo: primero las que casan por categoría, luego BM25 sobre el diff) se adjunta en todos los niveles para que
 * el modelo pueda citar `rule_refs` existentes.
 */
export async function buildContext(input: ContextInput, level: number): Promise<BuiltContext> {
  const { unit } = input;
  const parts: Array<{ name: string; text: string }> = [];
  const side = primarySide(unit);

  const header = [
    `Archivo: ${unit.file}${unit.previousPath ? ` (antes ${unit.previousPath})` : ""} · estado: ${unit.status} · lenguaje: ${unit.language ?? "sin gramática"}`,
    `Símbolo: ${unit.symbol ? `${unit.symbol.kind} ${unit.symbol.qualifiedName} (L${unit.symbol.range.startLine}–L${unit.symbol.range.endLine}, ${unit.symbol.side})` : "ámbito del módulo"}`,
    `Cambio: +${unit.added} / -${unit.removed} líneas`,
    input.taskId ? `Tarea del agente: ${input.taskId}` : null,
    input.signals.length > 0
      ? `Señales deterministas: ${input.signals
          .slice(0, 12)
          .map((signal) => `${signal.category}/${signal.detector} «${signal.token}»${signal.line > 0 ? ` L${signal.line}` : ""}`)
          .join("; ")}`
      : "Señales deterministas: ninguna",
  ]
    .filter(Boolean)
    .join("\n");
  parts.push({ name: "header", text: header });
  parts.push({ name: "L0", text: `## L0 · Diff (+ añadida en head, - borrada de base)\n${clip(diffBlock(unit), CONTEXT_BUDGET.diff)}` });

  if (level >= 1) {
    const text = await input.readText(side);
    if (text !== null) {
      const lines = splitLines(text);
      const symbols = (side === "head" ? input.versions.head : input.versions.base)?.symbols ?? [];
      const changed = side === "head" ? unit.headLines! : unit.baseLines!;
      const symbol = enclosingSymbol(symbols, changed.startLine);
      const from = symbol ? symbol.range.startLine : Math.max(1, changed.startLine - 15);
      const to = symbol ? symbol.range.endLine : Math.min(lines.length, changed.endLine + 15);
      parts.push({
        name: "L1",
        text: `## L1 · ${symbol ? `Símbolo envolvente ${symbol.qualifiedName}` : "Entorno del cambio"} (versión ${side})\n${clip(numbered(lines, from, to), CONTEXT_BUDGET.enclosing)}`,
      });
    }
  }

  if (level >= 2) {
    const entry = side === "head" ? input.versions.head : input.versions.base;
    if (entry) {
      const relatedSymbols = input.related
        ? await input.related(`${unit.symbol?.qualifiedName ?? unit.file} ${unit.lines.map((line) => line.text).join(" ")}`.slice(0, 2000), unit.file, 5)
        : [];
      const parentName = unit.symbol?.qualifiedName.includes(".") ? unit.symbol.qualifiedName.split(".").slice(0, -1).join(".") : null;
      const parent = parentName ? entry.symbols.find((symbol) => symbol.qualifiedName === parentName) : undefined;
      const siblings = entry.symbols
        .filter((symbol) => symbol.qualifiedName !== unit.symbol?.qualifiedName)
        .slice(0, 40)
        .map((symbol) => `- ${symbol.kind} ${symbol.qualifiedName}: ${symbol.signature}${symbol.doc ? ` — ${symbol.doc}` : ""}`);
      const structure = [
        `Imports: ${entry.imports.slice(0, 40).join(", ") || "—"}`,
        parent ? `Clase contenedora: ${parent.signature}${parent.doc ? ` — ${parent.doc}` : ""}` : null,
        siblings.length > 0 ? `Otros símbolos del archivo:\n${siblings.join("\n")}` : null,
        relatedSymbols.length > 0 ? `Símbolos relacionados en otros archivos del repo:\n${relatedSymbols.join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      parts.push({ name: "L2", text: `## L2 · Estructura del archivo\n${clip(structure, CONTEXT_BUDGET.structure)}` });
    }
  }

  const sectionIds: string[] = [];
  const docBlocks: string[] = [];
  const pushSection = (section: DocSection | undefined) => {
    if (!section || sectionIds.includes(section.id) || sectionIds.length >= 5) return;
    sectionIds.push(section.id);
    const rules = section.rules.length > 0 ? section.rules.map((rule) => `- ${rule.text}`).join("\n") : section.text.slice(0, 600);
    docBlocks.push(`### [${section.id}] ${section.headingPath.join(" › ")}\n${rules}`);
  };
  for (const rule of input.categoryRules) pushSection(input.sectionsById.get(rule.sectionId));
  const query = `${unit.file} ${unit.symbol?.qualifiedName ?? ""} ${input.signals.map((signal) => `${signal.category} ${signal.token}`).join(" ")} ${unit.lines
    .map((line) => line.text)
    .join(" ")}`;
  for (const hit of await input.retriever.search(query.slice(0, 4000), 6)) {
    if (hit.section.rules.length > 0) pushSection(hit.section);
  }
  if (docBlocks.length > 0) {
    parts.push({ name: "L4", text: `## L4 · Reglas del repositorio (cita sus ids en rule_refs)\n${clip(docBlocks.join("\n\n"), CONTEXT_BUDGET.docs)}` });
  }

  const tokensByPart: Record<string, number> = {};
  const rendered = parts.map((part) => {
    const text = redactSecrets(part.text);
    tokensByPart[part.name] = approximateTokens(text);
    return text;
  });
  const text = rendered.join("\n\n");
  return { level, text, tokens: approximateTokens(text), tokensByPart, sectionIds };
}

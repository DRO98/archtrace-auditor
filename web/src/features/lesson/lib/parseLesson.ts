import type { Lesson, LessonCoverage, LessonModelOutput, LessonStep, LessonStepModelOutput } from "@core/lesson";
import type { MapCall, MapSymbol, ProjectMap } from "@core/projectMap";
import type { LineRange } from "@core/protocol";
import { parseLooseJson } from "@/lib/ai/json";
import type { ProjectDigest } from "./digest";

export type ValidationResult = { ok: true; value: LessonModelOutput } | { ok: false; errors: string[] };

const COVERAGES: ReadonlySet<string> = new Set(["full", "partial", "not_found"]);

export function extractJson(text: string): unknown {
  return parseLooseJson(text);
}

export function validateModelOutput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["La respuesta no es un objeto."] };

  const title = readString(raw.title, 70);
  const overview = readString(raw.overview, 400);
  const coverage = raw.coverage;
  if (!title) errors.push("title");
  if (!overview) errors.push("overview");
  if (typeof coverage !== "string" || !COVERAGES.has(coverage)) errors.push("coverage");
  if (!Array.isArray(raw.caveats) || raw.caveats.some((item) => typeof item !== "string")) errors.push("caveats");
  if (!Array.isArray(raw.steps)) errors.push("steps");

  const steps: LessonStepModelOutput[] = [];
  if (Array.isArray(raw.steps)) {
    raw.steps.forEach((step, index) => {
      const parsed = readStep(step);
      if (!parsed) errors.push(`steps[${index}]`);
      else steps.push(parsed);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (steps.length === 0 && coverage !== "not_found") {
    return { ok: false, errors: ["steps vacío con coverage distinto de not_found"] };
  }

  return {
    ok: true,
    value: {
      title: title ?? "",
      overview: overview ?? "",
      coverage: coverage as LessonCoverage,
      caveats: (raw.caveats as string[]).slice(0, 3).map((item) => clip(item, 160)),
      steps,
    },
  };
}

export interface FinalizeMeta {
  goal: string;
  provider: string;
  model: string;
}

export function finalizeLesson(
  raw: LessonModelOutput,
  digest: ProjectDigest,
  map: ProjectMap,
  meta: FinalizeMeta,
): { lesson: Lesson; warnings: string[] } | { lesson: null; warnings: string[] } {
  const warnings: string[] = [];
  const symbols = indexSymbols(map);
  const ordered = [...raw.steps].sort((left, right) => left.stepNumber - right.stepNumber);
  const kept: LessonStep[] = [];

  for (const step of ordered) {
    const symbolId = digest.handles.get(step.symbol);
    const symbol = symbolId ? symbols.get(symbolId) : undefined;
    if (!symbol || !symbolId) {
      warnings.push(`Símbolo desconocido: ${step.symbol}`);
      continue;
    }
    const snapped = snapCodeRef(step, symbol);
    const stepNumber = kept.length + 1;
    kept.push({
      id: `step-${stepNumber}`,
      stepNumber,
      title: normalizeTitle(step.title, stepNumber),
      summary: clipSentence(step.summary, 400),
      codeRef: snapped.codeRef,
      connectionReason: clip(step.connectionReason, 160),
      symbolId,
      repaired: snapped.repaired,
    });
  }

  if (kept.length === 0 && raw.coverage !== "not_found") {
    return { lesson: null, warnings: [...warnings, "Ningún paso sobrevivió a la validación."] };
  }

  return {
    warnings,
    lesson: {
      id: `lesson-${map.revision}-${Date.now().toString(36)}`,
      goal: meta.goal,
      createdAt: new Date().toISOString(),
      mapRevision: map.revision,
      provider: meta.provider,
      model: meta.model,
      title: clip(raw.title, 80),
      overview: clip(raw.overview, 400),
      coverage: raw.coverage,
      caveats: raw.caveats,
      steps: kept,
    },
  };
}

export function findCodeLikeTokens(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`[^`]+`/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[a-z]+_[a-z0-9_]+\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\(\)/g)) found.add(match[0]);
  return [...found];
}

function snapCodeRef(step: LessonStepModelOutput, symbol: MapSymbol): { codeRef: LessonStep["codeRef"]; repaired: boolean } {
  const full = symbol.range;
  const sameFile = step.codeRef.filePath === fileOf(symbol.id);
  const accepted =
    sameFile &&
    (sameRange(step.codeRef, full) ||
      symbol.calls.some((call) => lineInside(step.codeRef, call)) ||
      symbol.instantiations.some((item) => sameRange(step.codeRef, item.range)));
  if (accepted) {
    return { codeRef: { ...step.codeRef }, repaired: false };
  }
  return {
    repaired: true,
    codeRef: { filePath: fileOf(symbol.id), startLine: full.startLine, endLine: full.endLine },
  };
}

function lineInside(ref: LessonStep["codeRef"], call: MapCall): boolean {
  return ref.startLine === call.line && ref.endLine === call.line;
}

function sameRange(ref: { startLine: number; endLine: number }, range: LineRange): boolean {
  return ref.startLine === range.startLine && ref.endLine === range.endLine;
}

function fileOf(symbolId: string): string {
  const split = symbolId.indexOf("::");
  return split < 0 ? symbolId : symbolId.slice(0, split);
}

function indexSymbols(map: ProjectMap): Map<string, MapSymbol> {
  const symbols = new Map<string, MapSymbol>();
  for (const file of map.files) {
    for (const symbol of file.symbols) symbols.set(symbol.id, symbol);
  }
  return symbols;
}

function normalizeTitle(title: string, stepNumber: number): string {
  const stripped = title.replace(/^\d+\.\s*/, "").trim();
  return clip(`${stepNumber}. ${stripped}`, 80);
}

function readStep(value: unknown): LessonStepModelOutput | null {
  if (!isRecord(value)) return null;
  const title = readString(value.title, 200);
  const summary = readString(value.summary, 800);
  const symbol = readString(value.symbol, 16);
  const connectionReason = readString(value.connectionReason, 240);
  const stepNumber = value.stepNumber;
  if (!title || !summary || !symbol || !connectionReason) return null;
  if (typeof stepNumber !== "number" || !Number.isInteger(stepNumber) || stepNumber < 1) return null;
  const codeRef = readCodeRef(value.codeRef);
  if (!codeRef) return null;
  return { stepNumber, title, summary, symbol, codeRef, connectionReason };
}

function readCodeRef(value: unknown): LessonStepModelOutput["codeRef"] | null {
  if (!isRecord(value)) return null;
  const filePath = value.filePath;
  const startLine = value.startLine;
  const endLine = value.endLine;
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  if (!isLine(startLine) || !isLine(endLine) || endLine < startLine) return null;
  return { filePath, startLine, endLine };
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trim();
}

function clipSentence(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const end = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
  return end > 40 ? slice.slice(0, end + 1).trim() : slice.trim();
}

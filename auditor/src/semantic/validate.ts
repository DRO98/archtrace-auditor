import { CRITICALITIES, type ChangeUnit, type Criticality, type SemanticAssessment } from "@core/audit";
import type { TokenUsage } from "@core/playground";
import { UNKNOWN_CATEGORY, type Taxonomy } from "../rules/taxonomy";

/** Lo que devuelve el modelo (JSON Schema en `schema.ts`), sin validar. */
export interface RawAssessment {
  category?: unknown;
  criticality?: unknown;
  confidence?: unknown;
  reason?: unknown;
  evidence?: unknown;
  rule_refs?: unknown;
  needs_more_context?: unknown;
}

export interface AssessmentMeta {
  provider: string;
  model: string;
  promptVersion: string;
  contextLevel: number;
  escalations: number;
  cached: boolean;
  usage?: TokenUsage;
}

const MAX_EVIDENCE = 8;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Normaliza la salida del LLM sin fiarse de ella: categoría fuera de la taxonomía → `unknown`; evidencias que no
 * aparecen literalmente en las líneas cambiadas → descartadas (si el texto existe en otra línea se corrige el
 * número); referencias a secciones que no están en el índice → descartadas; confianza acotada a [0, 1].
 */
export function validateAssessment(
  raw: unknown,
  unit: ChangeUnit,
  taxonomy: Taxonomy,
  sectionIds: ReadonlySet<string>,
  meta: AssessmentMeta,
): SemanticAssessment {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as RawAssessment;
  const category = typeof value.category === "string" ? value.category.trim() : "";
  const invalidCategory = !taxonomy.byId.has(category);
  const criticality: Criticality = CRITICALITIES.includes(value.criticality as Criticality) ? (value.criticality as Criticality) : "unknown";
  const confidenceNumber = typeof value.confidence === "number" ? value.confidence : Number(value.confidence);
  const confidence = Number.isFinite(confidenceNumber) ? Math.min(1, Math.max(0, confidenceNumber > 1 ? confidenceNumber / 100 : confidenceNumber)) : 0;

  const evidence: Array<{ line: number; text: string }> = [];
  let droppedEvidence = 0;
  const candidates = Array.isArray(value.evidence) ? value.evidence : [];
  for (const item of candidates) {
    const record = (typeof item === "object" && item !== null ? item : {}) as { line?: unknown; text?: unknown };
    const original = typeof record.text === "string" ? record.text.replace(/^[ \t]*[+-]?[ \t]*(?:\d+[ \t]*\|[ \t]?)?/gm, "") : "";
    const text = normalize(original);
    const line = typeof record.line === "number" ? Math.trunc(record.line) : Number.NaN;
    const match = text.length >= 3 ? findLine(unit, original, line) : null;
    if (!match || evidence.length >= MAX_EVIDENCE || evidence.some((entry) => entry.line === match.line && entry.text === text)) {
      droppedEvidence += 1;
      continue;
    }
    evidence.push({ line: match.line, text });
  }

  const refs = Array.isArray(value.rule_refs) ? value.rule_refs.filter((ref): ref is string => typeof ref === "string") : [];
  const ruleRefs = [...new Set(refs.map((ref) => ref.trim()).filter((ref) => sectionIds.has(ref)))];
  const droppedRefs = (Array.isArray(value.rule_refs) ? value.rule_refs.length : 0) - ruleRefs.length;

  return {
    provider: meta.provider,
    model: meta.model,
    promptVersion: meta.promptVersion,
    category: invalidCategory ? UNKNOWN_CATEGORY : category,
    criticality,
    confidence,
    reason: typeof value.reason === "string" ? value.reason.trim().slice(0, 1200) : "",
    evidence,
    ruleRefs,
    needsMoreContext: value.needs_more_context === true,
    contextLevel: meta.contextLevel,
    escalations: meta.escalations,
    cached: meta.cached,
    ...(meta.usage ? { usage: meta.usage } : {}),
    dropped: { evidence: droppedEvidence, ruleRefs: Math.max(0, droppedRefs), invalidCategory },
  };
}

/**
 * Línea cambiada que contiene el texto citado: la del número indicado si coincide, si no la primera que lo contenga.
 * Una cita de varias líneas vale si cada línea aparece en el diff (se ancla en la primera).
 */
function findLine(unit: ChangeUnit, original: string, line: number): { line: number } | null {
  const parts = original
    .split(/\r?\n/)
    .map(normalize)
    .filter((part) => part.length > 0);
  if (parts.length === 0 || parts.every((part) => part.length < 3)) return null;
  const first = findSingle(unit, parts[0]!, line);
  if (!first) return null;
  return parts.slice(1).every((part) => findSingle(unit, part, Number.NaN) !== null) ? first : null;
}

function findSingle(unit: ChangeUnit, text: string, line: number): { line: number } | null {
  const contains = (candidate: string) => normalize(candidate).includes(text);
  const exact = unit.lines.find((entry) => entry.line === line && contains(entry.text));
  if (exact) return { line: exact.line };
  const any = unit.lines.find((entry) => contains(entry.text));
  return any ? { line: any.line } : null;
}

import {
  CRITICALITY_LABEL,
  CRITICALITY_RANK,
  maxCriticality,
  type ChangeUnit,
  type Criticality,
  type Evidence,
  type FieldOrigin,
  type Finding,
  type RuleRef,
  type SemanticAssessment,
  type Signal,
} from "@core/audit";
import { unitLocation } from "../changes/units";
import type { DocSection } from "../docs/sections";
import { isTrivial } from "../rules/detect";
import { rulesForCategory, toRuleRef } from "../rules/repoRules";
import { categoryLabel, UNKNOWN_CATEGORY, type Taxonomy } from "../rules/taxonomy";

export const CONFIDENCE_THRESHOLD = 0.5;
const MAX_EVIDENCE = 10;

export interface DecisionInput {
  unit: ChangeUnit;
  signals: Signal[];
  taxonomy: Taxonomy;
  sections: readonly DocSection[];
  /** Salida del LLM ya validada (`validateAssessment`), o null si no se consultó o falló. */
  semantic: SemanticAssessment | null;
  relatedTests?: string[];
  /** Motivo por el que no se consultó al LLM (archivo sensible, sin proveedor…), para el texto del hallazgo. */
  skippedLlmReason?: string;
}

/** Finding sin id: los ids por categoría se asignan al ordenar la auditoría completa. */
export type Decision = Omit<Finding, "id">;

interface CategoryFloor {
  category: string;
  /** Suelo vinculante: señales fuertes, elevadas por las reglas del repo. El LLM no puede bajar de aquí. */
  binding: Criticality | null;
  /** Orientativo: señales débiles (solo decide si no hay LLM). */
  weak: Criticality | null;
  signals: Signal[];
  rules: RuleRef[];
}

/**
 * Suelos por categoría. Reglas del repo que encajan con la categoría: una frase crítica eleva a CRÍTICA si hay
 * señal fuerte (ALTA si solo hay débiles); una regla normal garantiza al menos MEDIA.
 */
export function categoryFloors(signals: readonly Signal[], sections: readonly DocSection[], taxonomy: Taxonomy): CategoryFloor[] {
  const byCategory = new Map<string, Signal[]>();
  for (const signal of signals) byCategory.set(signal.category, [...(byCategory.get(signal.category) ?? []), signal]);
  const floors: CategoryFloor[] = [];
  for (const [category, list] of byCategory) {
    const trivial = taxonomy.byId.get(category)?.trivial === true;
    const rules = trivial ? [] : rulesForCategory(category, sections, taxonomy);
    const critical = rules.some((rule) => rule.critical);
    let binding: Criticality | null = null;
    let weak: Criticality | null = null;
    for (const signal of list) {
      if (signal.strength === "strong") binding = binding ? maxCriticality(binding, signal.floor) : signal.floor;
      else weak = weak ? maxCriticality(weak, signal.floor) : signal.floor;
    }
    if (rules.length > 0) {
      if (binding) binding = critical ? "critical" : maxCriticality(binding, "medium");
      if (weak) weak = critical ? maxCriticality(weak, "high") : maxCriticality(weak, "medium");
    }
    floors.push({ category, binding, weak, signals: list, rules });
  }
  const order = new Map(taxonomy.categories.map((category, index) => [category.id, index]));
  return floors.sort(
    (left, right) =>
      rank(right.binding) - rank(left.binding) ||
      rank(right.weak) - rank(left.weak) ||
      right.signals.length - left.signals.length ||
      (order.get(left.category) ?? 99) - (order.get(right.category) ?? 99),
  );
}

function rank(criticality: Criticality | null): number {
  return criticality ? CRITICALITY_RANK[criticality] : -1;
}

/**
 * Motor de decisión, puro. Combina señales deterministas, reglas del repo y (si existe) la valoración del LLM:
 * el LLM decide categoría y criticidad, pero nunca por debajo del suelo de las señales fuertes; sin evidencia
 * válida o con confianza < 0,5 el resultado es `unknown` + revisión humana (salvo que un suelo fuerte decida).
 */
export function decide(input: DecisionInput): Decision {
  const { unit, signals, taxonomy, sections, semantic } = input;
  const location = unitLocation(unit);
  const floors = categoryFloors(signals, sections, taxonomy);
  const strongest = floors.find((floor) => floor.binding !== null) ?? null;
  const bindingFloor = strongest?.binding ?? null;
  const ruleEvidence = signalEvidence(unit, signals);
  const base = {
    unitId: unit.id,
    file: unit.file,
    symbol: unit.symbol?.qualifiedName ?? null,
    side: location.side,
    lines: location.lines,
    signals,
    relatedTests: input.relatedTests ?? [],
    review: { status: "pending" as const },
  };
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  if (!semantic) {
    if (isTrivial(signals, taxonomy)) {
      const category = floors[0]!.category;
      return {
        ...base,
        category,
        criticality: "low",
        confidence: 0.9,
        reason: `Cambio de ${categoryLabel(taxonomy, category).toLowerCase()} sin señales de riesgo.`,
        evidence: [],
        rules: [],
        origin: { category: "rule", criticality: "rule", reason: "rule" },
        humanReviewRequired: false,
        contextLevel: -1,
      };
    }
    if (strongest) {
      const rules = strongest.rules;
      const criticality = strongest.binding!;
      return {
        ...base,
        category: strongest.category,
        criticality,
        confidence: rules.length > 0 ? 0.85 : 0.75,
        reason: ruleReason(strongest, taxonomy, criticality, input.skippedLlmReason),
        evidence: ruleEvidence,
        rules,
        origin: { category: "rule", criticality: "rule", reason: "rule" },
        humanReviewRequired: criticality === "critical" || rules.some((rule) => rule.critical),
        contextLevel: -1,
      };
    }
    const weakest = floors.find((floor) => floor.weak !== null && taxonomy.byId.get(floor.category)?.trivial !== true);
    if (weakest) {
      const criticality = weakest.weak!;
      return {
        ...base,
        category: weakest.category,
        criticality,
        confidence: 0.55,
        reason: ruleReason(weakest, taxonomy, criticality, input.skippedLlmReason),
        evidence: ruleEvidence,
        rules: weakest.rules,
        origin: { category: "rule", criticality: "rule", reason: "rule" },
        humanReviewRequired: weakest.rules.some((rule) => rule.critical),
        contextLevel: -1,
      };
    }
    const code = unit.language !== null;
    return {
      ...base,
      category: code ? "business_logic" : UNKNOWN_CATEGORY,
      criticality: "unknown",
      confidence: 0.3,
      reason: `Sin señales deterministas; hace falta análisis semántico o revisión humana.${input.skippedLlmReason ? ` ${input.skippedLlmReason}` : ""}`,
      evidence: [],
      rules: code ? rulesForCategory("business_logic", sections, taxonomy) : [],
      origin: { category: code ? "rule" : "none", criticality: "none", reason: "rule" },
      humanReviewRequired: true,
      contextLevel: -1,
    };
  }

  // Con LLM: la valoración semántica manda dentro de los límites de las reglas.
  const llmEvidence: Evidence[] = semantic.evidence.map((item) => ({
    file: unit.file,
    line: item.line,
    side: unit.lines.find((line) => line.line === item.line && line.kind === "del") && !unit.lines.some((line) => line.line === item.line && line.kind === "add") ? "base" : "head",
    text: item.text,
    source: "llm",
  }));
  const hasEvidence = llmEvidence.length > 0 || ruleEvidence.length > 0;
  const confident = semantic.confidence >= CONFIDENCE_THRESHOLD && semantic.criticality !== "unknown";
  const llmCategory = semantic.category;

  let criticality: Criticality;
  let category: string;
  let originCriticality: FieldOrigin;
  let originCategory: FieldOrigin;
  let humanReviewRequired = false;

  if (!confident || !hasEvidence) {
    humanReviewRequired = true;
    if (bindingFloor && strongest) {
      criticality = bindingFloor;
      category = strongest.category;
      originCriticality = "rule";
      originCategory = llmCategory === category ? "both" : "rule";
    } else {
      criticality = "unknown";
      category = llmCategory;
      originCriticality = "none";
      originCategory = llmCategory === UNKNOWN_CATEGORY ? "none" : "llm";
    }
  } else {
    const llmCriticality = semantic.criticality;
    if (bindingFloor && strongest && CRITICALITY_RANK[bindingFloor] > CRITICALITY_RANK[llmCriticality]) {
      criticality = bindingFloor;
      category = strongest.category;
      originCriticality = "rule";
      originCategory = llmCategory === category ? "both" : "rule";
    } else {
      criticality = llmCriticality;
      originCriticality = bindingFloor === llmCriticality ? "both" : "llm";
      if (llmCategory === UNKNOWN_CATEGORY && floors[0]) {
        category = floors[0].category;
        originCategory = "rule";
      } else {
        category = llmCategory;
        originCategory = floors.some((floor) => floor.category === llmCategory) ? "both" : "llm";
      }
    }
    if (category === UNKNOWN_CATEGORY) humanReviewRequired = true;
  }

  const rules = mergeRules(
    floors.find((floor) => floor.category === category)?.rules ?? rulesForCategory(category, sections, taxonomy),
    semantic.ruleRefs.map((id) => sectionById.get(id)).filter((section): section is DocSection => section !== undefined),
  );
  if (rules.some((rule) => rule.critical)) humanReviewRequired = true;
  if (criticality === "critical") humanReviewRequired = true;

  const floorNote =
    originCriticality === "rule" && confident
      ? ` Criticidad elevada a ${CRITICALITY_LABEL[criticality]} por señales deterministas (${strongest?.signals.map((signal) => `\`${signal.token}\``).slice(0, 3).join(", ")}).`
      : "";
  const lowConfidence = !confident ? ` Confianza del modelo ${semantic.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}: requiere revisión humana.` : "";
  const noEvidence = !hasEvidence ? " Sin evidencia verificable en el diff." : "";
  const reasonText = semantic.reason || (strongest ? ruleReason(strongest, taxonomy, criticality) : "Sin motivo del modelo.");

  return {
    ...base,
    category,
    criticality,
    confidence: semantic.confidence,
    reason: `${reasonText}${floorNote}${lowConfidence}${noEvidence}`.trim(),
    evidence: dedupeEvidence([...llmEvidence, ...ruleEvidence]),
    rules,
    semantic,
    origin: { category: originCategory, criticality: originCriticality, reason: semantic.reason ? "llm" : "rule" },
    humanReviewRequired,
    contextLevel: semantic.contextLevel,
  };
}

function signalEvidence(unit: ChangeUnit, signals: readonly Signal[]): Evidence[] {
  return dedupeEvidence(
    signals
      .filter((signal) => signal.side !== "path")
      .map((signal) => ({ file: unit.file, line: signal.line, side: signal.side === "base" ? "base" : "head", text: signal.text, source: "rule" as const })),
  );
}

function dedupeEvidence(items: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const item of items) {
    const key = `${item.side}:${item.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_EVIDENCE) break;
  }
  return out;
}

function mergeRules(byCategory: readonly RuleRef[], cited: readonly DocSection[]): RuleRef[] {
  const out = [...byCategory];
  for (const section of cited) {
    if (out.some((rule) => rule.sectionId === section.id)) continue;
    out.push(toRuleRef(section, null, "llm"));
  }
  return out;
}

function ruleReason(floor: CategoryFloor, taxonomy: Taxonomy, criticality: Criticality, skipped?: string): string {
  const tokens = [...new Set(floor.signals.map((signal) => (signal.line > 0 ? `\`${signal.token}\` (L${signal.line})` : `ruta \`${signal.text}\``)))].slice(0, 4);
  const rule = floor.rules[0];
  const ruleText = rule ? ` Regla del repo (${rule.sectionId}): «${rule.excerpt}»` : "";
  return `${categoryLabel(taxonomy, floor.category)}: ${tokens.join(", ")} → ${CRITICALITY_LABEL[criticality]} por reglas deterministas.${ruleText}${skipped ? ` ${skipped}` : ""}`;
}

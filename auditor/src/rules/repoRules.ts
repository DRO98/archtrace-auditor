import type { RuleRef } from "@core/audit";
import { fold, type DocRule, type DocSection } from "../docs/sections";
import type { Taxonomy } from "./taxonomy";

const MAX_REFS = 3;

/** Palabra clave al inicio de palabra (`permiso` casa con `permisos`); las cortas (≤ 3) exigen palabra completa. */
function keywordPattern(keyword: string): RegExp {
  const escaped = fold(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return keyword.length <= 3 ? new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`) : new RegExp(`(^|[^a-z0-9_])${escaped}`);
}

const patternCache = new Map<string, RegExp[]>();

function categoryPatterns(taxonomy: Taxonomy, category: string): RegExp[] {
  const key = `${taxonomy.version}:${category}`;
  let patterns = patternCache.get(key);
  if (!patterns) {
    patterns = (taxonomy.byId.get(category)?.keywords ?? []).map(keywordPattern);
    patternCache.set(key, patterns);
  }
  return patterns;
}

function hits(patterns: readonly RegExp[], text: string): number {
  const folded = fold(text);
  return patterns.reduce((count, pattern) => count + (pattern.test(folded) ? 1 : 0), 0);
}

/**
 * Reglas del repo que aplican a una categoría: secciones con frases de regla cuyo título (peso 3) o cuyas frases
 * contienen palabras clave de la categoría. De cada sección se cita la mejor frase (crítica y pertinente primero).
 */
export function rulesForCategory(category: string, sections: readonly DocSection[], taxonomy: Taxonomy): RuleRef[] {
  const patterns = categoryPatterns(taxonomy, category);
  if (patterns.length === 0) return [];
  const scored: Array<{ score: number; ref: RuleRef }> = [];
  for (const section of sections) {
    if (section.rules.length === 0) continue;
    const headingHits = hits(patterns, section.headingPath[section.headingPath.length - 1] ?? "");
    const ranked = section.rules
      .map((rule) => ({ rule, hits: hits(patterns, rule.text) }))
      .filter((entry) => headingHits > 0 || entry.hits > 0)
      .sort((left, right) => Number(right.rule.critical) - Number(left.rule.critical) || right.hits - left.hits || left.rule.line - right.rule.line);
    const best = ranked[0];
    if (!best) continue;
    const score = headingHits * 3 + ranked.reduce((total, entry) => total + entry.hits, 0);
    scored.push({ score, ref: toRuleRef(section, best.rule, "category") });
  }
  return scored
    .sort((left, right) => right.score - left.score || left.ref.sectionId.localeCompare(right.ref.sectionId))
    .slice(0, MAX_REFS)
    .map((entry) => entry.ref);
}

export function toRuleRef(section: DocSection, rule: DocRule | null, matchedBy: RuleRef["matchedBy"]): RuleRef {
  const chosen = rule ?? section.rules.find((candidate) => candidate.critical) ?? section.rules[0] ?? null;
  return {
    sectionId: section.id,
    file: section.file,
    headingPath: section.headingPath,
    lines: section.lines,
    excerpt: chosen?.text ?? section.text.slice(0, 240),
    matchedBy,
    critical: chosen?.critical ?? false,
  };
}

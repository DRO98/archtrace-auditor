import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChangeUnit, DiffLine } from "@core/audit";
import { sectionize } from "../docs/sections";
import { detectSignals } from "../rules/detect";
import { loadTaxonomy } from "../rules/taxonomy";
import { validateAssessment } from "../semantic/validate";
import { decide } from "./decide";

const taxonomy = loadTaxonomy(null);
const sections = sectionize(
  "CLAUDE.md",
  "# Reglas\n\n## Autorización\n\n- Todo cambio en permisos (`has_perm`, 403) es crítico y requiere revisión humana.\n\n## Pagos\n\n- Los importes deben guardarse en céntimos (enteros).\n",
);
const sectionIds = new Set(sections.map((section) => section.id));

function unit(file: string, added: string[], removed: string[] = [], language: string | null = "python"): ChangeUnit {
  const lines: DiffLine[] = [
    ...removed.map((text, index) => ({ kind: "del" as const, line: 10 + index, text })),
    ...added.map((text, index) => ({ kind: "add" as const, line: 10 + index, text })),
  ];
  return {
    id: "u1",
    file,
    status: "modified",
    language,
    symbol: null,
    headLines: added.length ? { startLine: 10, endLine: 9 + added.length } : null,
    baseLines: removed.length ? { startLine: 10, endLine: 9 + removed.length } : null,
    added: added.length,
    removed: removed.length,
    lines,
    hunkHeaders: ["@@"],
  };
}

const meta = { provider: "fake", model: "fake-1", promptVersion: "audit-v1", contextLevel: 0, escalations: 0, cached: false };

describe("decide sin LLM", () => {
  it("has_perm + 403 → CRÍTICA de autorización citando la regla de CLAUDE.md", () => {
    const change = unit("players/views.py", ["    if not request.user.has_perm('players.delete_player'):", "        return HttpResponseForbidden()"]);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.category, "authorization");
    assert.equal(decision.criticality, "critical");
    assert.equal(decision.rules[0]?.sectionId, "CLAUDE.md#autorizacion");
    assert.equal(decision.humanReviewRequired, true);
    assert.deepEqual(decision.origin, { category: "rule", criticality: "rule", reason: "rule" });
  });

  it("quitar un has_perm también es crítico (señal en línea borrada)", () => {
    const change = unit("players/views.py", [], ["    if not request.user.has_perm('players.delete_player'):"]);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.criticality, "critical");
    assert.equal(decision.side, "base");
  });

  it("amount = int(amount) en pagos → MEDIA (o menos)", () => {
    const change = unit("payments/service.py", ["    amount = int(amount)"], ["    amount = amount"]);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.category, "payments");
    assert.ok(["medium", "low"].includes(decision.criticality), decision.criticality);
  });

  it("CSS → BAJA, trivial", () => {
    const change = unit("static/site.css", [".btn { color: red; }", "width: 403px;"], [], null);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.category, "ui_style");
    assert.equal(decision.criticality, "low");
    assert.equal(decision.contextLevel, -1);
  });

  it("código sin señales → unknown + revisión humana", () => {
    const change = unit("app/utils.py", ["    return x * 2"]);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.criticality, "unknown");
    assert.equal(decision.humanReviewRequired, true);
  });

  it("en tests no se ejecutan detectores de línea", () => {
    const change = unit("tests/test_views.py", ["    assert user.has_perm('x')"]);
    const decision = decide({ unit: change, signals: detectSignals(change, taxonomy), taxonomy, sections, semantic: null });
    assert.equal(decision.category, "tests");
    assert.equal(decision.criticality, "low");
  });
});

describe("decide con LLM validado", () => {
  const change = unit("players/views.py", ["    if not request.user.has_perm('players.delete_player'):", "        return HttpResponseForbidden()"]);
  const signals = detectSignals(change, taxonomy);

  it("descarta evidencias inventadas y refs inexistentes; categoría fuera de taxonomía → unknown", () => {
    const semantic = validateAssessment(
      {
        category: "hacking",
        criticality: "low",
        confidence: 0.9,
        reason: "Nada relevante.",
        evidence: [
          { line: 10, text: "request.user.has_perm('players.delete_player')" },
          { line: 3, text: "os.system('rm -rf /')" },
          { line: 99, text: "- 11 | return HttpResponseForbidden()" },
        ],
        rule_refs: ["CLAUDE.md#autorizacion", "SECURITY.md#inventada"],
        needs_more_context: false,
      },
      change,
      taxonomy,
      sectionIds,
      meta,
    );
    assert.equal(semantic.category, "unknown");
    assert.equal(semantic.dropped.invalidCategory, true);
    assert.deepEqual(semantic.evidence.map((item) => item.line), [10, 11]);
    assert.equal(semantic.dropped.evidence, 1);
    assert.deepEqual(semantic.ruleRefs, ["CLAUDE.md#autorizacion"]);
    assert.equal(semantic.dropped.ruleRefs, 1);

    // El LLM dice BAJA, pero has_perm es señal fuerte + regla crítica: no puede bajar del suelo.
    const decision = decide({ unit: change, signals, taxonomy, sections, semantic });
    assert.equal(decision.criticality, "critical");
    assert.equal(decision.category, "authorization");
    assert.equal(decision.origin.criticality, "rule");
    assert.ok(decision.evidence.some((item) => item.source === "llm"));
  });

  it("confianza < 0,5 sin señales fuertes → unknown + revisión humana", () => {
    const plain = unit("app/utils.py", ["    return x * 2"]);
    const semantic = validateAssessment(
      { category: "business_logic", criticality: "medium", confidence: 0.3, reason: "Dudoso.", evidence: [{ line: 10, text: "return x * 2" }], rule_refs: [], needs_more_context: false },
      plain,
      taxonomy,
      sectionIds,
      meta,
    );
    const decision = decide({ unit: plain, signals: detectSignals(plain, taxonomy), taxonomy, sections, semantic });
    assert.equal(decision.criticality, "unknown");
    assert.equal(decision.humanReviewRequired, true);
  });

  it("el LLM puede subir la criticidad por encima del suelo", () => {
    const plain = unit("app/utils.py", ["    return x * 2"]);
    const semantic = validateAssessment(
      { category: "business_logic", criticality: "high", confidence: 0.8, reason: "Cambia el cálculo.", evidence: [{ line: 10, text: "return x * 2" }], rule_refs: [], needs_more_context: false },
      plain,
      taxonomy,
      sectionIds,
      meta,
    );
    const decision = decide({ unit: plain, signals: [], taxonomy, sections, semantic });
    assert.equal(decision.criticality, "high");
    assert.deepEqual(decision.origin, { category: "llm", criticality: "llm", reason: "llm" });
  });
});

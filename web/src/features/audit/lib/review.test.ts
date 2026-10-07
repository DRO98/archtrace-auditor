import assert from "node:assert/strict";
import test from "node:test";
import type { Finding } from "@core/audit";
import { decorationsFor, keyToAction, monacoLanguage, reviewQueue, stepIndex } from "./review";

function finding(id: string, criticality: Finding["criticality"], confidence: number, status: Finding["review"]["status"] = "pending"): Finding {
  return {
    id,
    unitId: id,
    file: `${id}.py`,
    symbol: null,
    side: "head",
    lines: { startLine: 3, endLine: 5 },
    category: "authorization",
    criticality,
    confidence,
    reason: "r",
    signals: [],
    evidence: [{ file: `${id}.py`, line: 4, side: "head", text: "has_perm", source: "rule" }],
    rules: [],
    origin: { category: "rule", criticality: "rule", reason: "rule" },
    humanReviewRequired: false,
    contextLevel: -1,
    relatedTests: [],
    review: { status },
  };
}

test("la cola ordena por criticidad (desconocida tras alta) y confianza, y filtra", () => {
  const findings = [finding("L", "low", 0.9), finding("U", "unknown", 0.3), finding("C2", "critical", 0.6), finding("C1", "critical", 0.9), finding("H", "high", 0.8, "accepted")];
  assert.deepEqual(reviewQueue(findings).map((item) => item.id), ["C1", "C2", "H", "U", "L"]);
  assert.deepEqual(reviewQueue(findings, "pending").map((item) => item.id), ["C1", "C2", "U", "L"]);
  assert.deepEqual(reviewQueue(findings, "critical").map((item) => item.id), ["C1", "C2"]);
});

test("navegación acotada y atajos de teclado", () => {
  assert.equal(stepIndex(0, -1, 3), 0);
  assert.equal(stepIndex(2, 1, 3), 2);
  assert.equal(stepIndex(0, 1, 0), -1);
  assert.deepEqual(keyToAction("j"), { kind: "move", delta: 1 });
  assert.deepEqual(keyToAction("f"), { kind: "status", status: "false_positive" });
  assert.equal(keyToAction("x"), null);
});

test("decoraciones: rango del hallazgo + glifo en cada evidencia", () => {
  const decorations = decorationsFor(finding("C1", "critical", 0.9));
  assert.equal(decorations.length, 2);
  assert.equal(decorations[0]!.className, "audit-range audit-range-critical");
  assert.equal(decorations[1]!.glyphClassName, "audit-glyph audit-glyph-critical");
  assert.equal(decorations[1]!.startLine, 4);
});

test("lenguaje de Monaco por extensión", () => {
  assert.equal(monacoLanguage("players/views.py"), "python");
  assert.equal(monacoLanguage("web/Dockerfile"), "dockerfile");
  assert.equal(monacoLanguage("x.unknown"), "plaintext");
});

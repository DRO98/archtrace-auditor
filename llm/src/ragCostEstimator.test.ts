import assert from "node:assert/strict";
import test from "node:test";
import { RAG_COST_MODELS, estimateRagCost, formatUsd } from "./ragCostEstimator";

test("estimateRagCost escala por peticiones y separa entrada/salida", () => {
  const estimate = estimateRagCost({ promptTokens: 1_000, completionTokens: 500 }, { input: 2.5, output: 10 }, 10_000);
  assert.equal(estimate.inputUsd, 25);
  assert.equal(estimate.outputUsd, 50);
  assert.equal(estimate.totalUsd, 75);
  assert.equal(estimate.perRequestUsd, 0.0075);
});

test("estimateRagCost tolera entradas inválidas", () => {
  assert.equal(estimateRagCost({ promptTokens: -5, completionTokens: 0 }, { input: 1, output: 1 }, Number.NaN).totalUsd, 0);
});

test("el catálogo cubre los tres proveedores pedidos", () => {
  assert.deepEqual([...new Set(RAG_COST_MODELS.map((model) => model.provider))].sort(), ["Anthropic", "Groq", "OpenAI"]);
  assert.equal(formatUsd(75), "$75.00");
  assert.equal(formatUsd(0), "$0");
});

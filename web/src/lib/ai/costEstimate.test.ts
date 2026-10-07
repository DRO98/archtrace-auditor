import assert from "node:assert/strict";
import test from "node:test";
import { catalogPrice, estimateCost, isTokenPrice, priceKey, resolvePrice } from "./costEstimate";

test("catalogPrice acepta variantes con fecha y elige el prefijo más largo", () => {
  assert.deepEqual(catalogPrice("openai", "gpt-4o-mini-2024-07-18"), { input: 0.15, output: 0.6 });
  assert.deepEqual(catalogPrice("openai", "gpt-4o-2024-08-06"), { input: 2.5, output: 10 });
  assert.deepEqual(catalogPrice("gemini", "models/gemini-2.5-flash"), { input: 0.3, output: 2.5 });
  assert.equal(catalogPrice("openai", "gpt-4oops"), null);
});

test("resolvePrice: el precio manual manda, Ollama es local y lo desconocido no tiene tarifa", () => {
  const overrides = { [priceKey("groq", "nuevo-modelo")]: { input: 1, output: 2 } };
  assert.deepEqual(resolvePrice("groq", "nuevo-modelo", overrides), { price: { input: 1, output: 2 }, source: "custom" });
  assert.equal(resolvePrice("ollama", "llama3").source, "local");
  assert.deepEqual(resolvePrice("deepseek", "desconocido"), { price: null, source: "unknown" });
  assert.equal(estimateCost("groq", "nuevo-modelo", { promptTokens: 1_000_000, completionTokens: 500_000, totalTokens: 0 }, overrides), 2);
});

test("isTokenPrice rechaza negativos, NaN y cadenas", () => {
  assert.equal(isTokenPrice({ input: 0.1, output: 0 }), true);
  assert.equal(isTokenPrice({ input: -1, output: 0 }), false);
  assert.equal(isTokenPrice({ input: Number.NaN, output: 1 }), false);
  assert.equal(isTokenPrice({ input: "1", output: 1 }), false);
});
